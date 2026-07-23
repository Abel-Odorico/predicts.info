import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import CollapsibleSection from './CollapsibleSection'
import MedalIcon from './MedalIcon'

// Ranking recortado por período — Rodada / Turno / Mês. O ranking do
// CAMPEONATO inteiro já é a lista principal da página, não duplicado aqui.
export default function GroupPeriodRanking({ groupId, token, currentRodada }) {
  const [scope, setScope] = useState('rodada') // rodada | turno | mes
  const [rodada, setRodada] = useState(currentRodada || 1)
  const [turno, setTurno] = useState(currentRodada && currentRodada >= 20 ? 2 : 1)
  const [monthOffset, setMonthOffset] = useState(0) // 0 = mês atual, -1 = mês anterior...
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (currentRodada) setRodada(currentRodada) }, [currentRodada])

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ scope })
    if (scope === 'rodada') params.set('rodada', rodada)
    if (scope === 'turno') params.set('turno', turno)
    if (scope === 'mes') {
      const now = new Date()
      const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
      params.set('year', d.getFullYear())
      params.set('month', d.getMonth() + 1)
    }
    api.get(`/user-groups/${groupId}/ranking-period?${params}`, token)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [groupId, token, scope, rodada, turno, monthOffset])

  useEffect(() => { load() }, [load])

  const teaser = data ? `${data.label} · líder: ${data.ranking[0]?.name ?? '—'}` : 'Rodada, turno ou mês'

  return (
    <CollapsibleSection kicker="Visões" title="📊 Ranking por Período" teaser={teaser} accent="var(--accent)">
      <div className="phase-nav" style={{ marginBottom: 'var(--s3)' }}>
        <button type="button" className={`phase-nav__tab ${scope === 'rodada' ? 'active' : ''}`} onClick={() => setScope('rodada')}>📅 Rodada</button>
        <button type="button" className={`phase-nav__tab ${scope === 'turno' ? 'active' : ''}`} onClick={() => setScope('turno')}>🔄 Turno</button>
        <button type="button" className={`phase-nav__tab ${scope === 'mes' ? 'active' : ''}`} onClick={() => setScope('mes')}>🗓️ Mês</button>
      </div>

      {/* ── Navegação do período ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 'var(--s3)' }}>
        {scope === 'rodada' && (
          <>
            <button type="button" className="group-manager-card__icon-btn" disabled={rodada <= 1} onClick={() => setRodada(r => r - 1)} aria-label="Rodada anterior">‹</button>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)', minWidth: 90, textAlign: 'center' }}>Rodada {rodada}</span>
            <button type="button" className="group-manager-card__icon-btn" disabled={rodada >= 38} onClick={() => setRodada(r => r + 1)} aria-label="Próxima rodada">›</button>
          </>
        )}
        {scope === 'turno' && (
          <div className="phase-nav">
            <button type="button" className={`phase-nav__tab ${turno === 1 ? 'active' : ''}`} onClick={() => setTurno(1)}>1º Turno</button>
            <button type="button" className={`phase-nav__tab ${turno === 2 ? 'active' : ''}`} onClick={() => setTurno(2)}>2º Turno (Returno)</button>
          </div>
        )}
        {scope === 'mes' && (
          <>
            <button type="button" className="group-manager-card__icon-btn" onClick={() => setMonthOffset(o => o - 1)} aria-label="Mês anterior">‹</button>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)', minWidth: 90, textAlign: 'center' }}>{data?.label ?? '—'}</span>
            <button type="button" className="group-manager-card__icon-btn" disabled={monthOffset >= 0} onClick={() => setMonthOffset(o => Math.min(0, o + 1))} aria-label="Próximo mês">›</button>
          </>
        )}
      </div>

      {loading && <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>Carregando…</p>}

      {!loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.ranking.map(r => (
            <div key={r.user_id} style={{
              padding: '8px 10px', borderRadius: 8,
              background: r.is_me ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-overlay)',
              border: r.position <= 3 ? '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' : '1px solid transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {r.position <= 3
                  ? <MedalIcon rank={r.position} size={18} />
                  : <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', width: 18, textAlign: 'center' }}>{r.position}º</span>}
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: r.is_me ? 700 : 400, color: 'var(--text-1)', flex: 1 }}>{r.name}</span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{r.pts} pts</span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, paddingLeft: 28, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                <span>🎯 {r.exact} exato{r.exact === 1 ? '' : 's'}</span>
                <span>✅ {r.correct} certo{r.correct === 1 ? '' : 's'}</span>
                <span>📈 {r.aproveitamento}% aproveit.</span>
                <span>📝 {r.bets}/{data.possible} palpite{data.possible === 1 ? '' : 's'}</span>
              </div>
            </div>
          ))}
          {data.ranking.every(r => r.bets === 0) && (
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s2)' }}>
              Ninguém apostou nesse período ainda.
            </span>
          )}
        </div>
      )}
    </CollapsibleSection>
  )
}
