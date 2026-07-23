import { useState, useEffect, useMemo } from 'react'
import { api } from '../api'
import { toast } from '../toast'
import TeamCrestFlag from './TeamCrestFlag'

function parseUtcMatchDate(value) {
  if (!value) return null
  return new Date(value.endsWith('Z') ? value : `${value}Z`)
}

function fmtCountdown(deadline) {
  const d = parseUtcMatchDate(deadline)
  if (!d) return null
  const diffMs = d.getTime() - Date.now()
  if (diffMs <= 0) return null
  const totalMin = Math.floor(diffMs / 60000)
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const minutes = totalMin % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}min`
  return `${minutes}min`
}

// Sub-seção "🏆 Bônus" (passo 14) — palpite de ordem final 1º-20º do returno.
// Visível pra qualquer membro (não só o dono) quando classification_bonus.enabled.
export default function GroupClassificationBonus({ groupId, token, brTeams, myEntry }) {
  const [loading, setLoading] = useState(true)
  const [deadline, setDeadline] = useState(null)
  const [locked, setLocked] = useState(false)
  const [hasBet, setHasBet] = useState(false)
  const [order, setOrder] = useState([])
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)

  const teamById = useMemo(() => Object.fromEntries(brTeams.map(t => [t.team_id, t])), [brTeams])

  useEffect(() => {
    api.get(`/user-groups/${groupId}/classification-bet`, token)
      .then(res => {
        setDeadline(res.deadline)
        setLocked(res.locked)
        setHasBet(res.has_bet)
        if (res.team_ids?.length) {
          setOrder(res.team_ids)
        } else if (brTeams.length) {
          // Sugestão de ponto de partida: ordem da tabela atual (ordenável depois).
          setOrder([...brTeams].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)).map(t => t.team_id))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [groupId, token, brTeams])

  useEffect(() => {
    if (!deadline || locked) return
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [deadline, locked])

  function move(idx, dir) {
    setOrder(o => {
      const next = [...o]
      const j = idx + dir
      if (j < 0 || j >= next.length) return o
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      await api.post(`/user-groups/${groupId}/classification-bet`, { team_ids: order }, token)
      setHasBet(true)
      toast.success('Palpite de classificação salvo')
    } catch (e) {
      toast.error(e.message || 'Erro ao salvar palpite')
    } finally {
      setSaving(false)
    }
  }

  // Sem sinal explícito de "competição encerrada" nesses endpoints — classification_hits
  // só é != 0 pra alguém no grupo quando o backend já apurou (competitions.status='finished',
  // ver _classification_hits). Heurística segura: se qualquer membro tem hits>0, já fechou.
  const finished = (myEntry?.classification_hits ?? 0) > 0

  const countdown = fmtCountdown(deadline)
  void tick // força re-render do countdown a cada 30s

  if (loading) return null

  return (
    <div className="card mt-4 fade-in-1" style={{ padding: 'var(--s4)', borderLeft: '3px solid #e8a030' }}>
      <div className="group-manager-card__kicker" style={{ marginBottom: 2 }}>Mecânica 1</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-1)', marginBottom: 'var(--s2)' }}>🏆 Bônus de Classificação</div>

      {finished ? (
        <>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', marginBottom: 'var(--s3)' }}>
            Campeonato encerrado — você acertou{' '}
            <strong style={{ color: 'var(--win)' }}>{myEntry.classification_hits} posiç{myEntry.classification_hits === 1 ? 'ão' : 'ões'}</strong> exata{myEntry.classification_hits === 1 ? '' : 's'}.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
            {order.map((teamId, i) => {
              const finalTeam = [...brTeams].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))[i]
              const hit = finalTeam && finalTeam.team_id === teamId
              const myTeam = teamById[teamId]
              return (
                <div key={teamId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, background: hit ? 'color-mix(in srgb, var(--win) 12%, transparent)' : 'var(--bg-overlay)' }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', width: 22 }}>{i + 1}º</span>
                  {myTeam?.flag_url && <TeamCrestFlag src={myTeam.flag_url} alt={myTeam.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-1)', flex: 1 }}>{myTeam?.name ?? teamId}</span>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>real: {finalTeam?.name ?? '?'}</span>
                  <span>{hit ? '✅' : '❌'}</span>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', marginBottom: 'var(--s2)' }}>
            Palpite a ordem final (1º ao 20º) do returno do Brasileirão. {locked ? 'Prazo encerrado.' : countdown ? `Faltam ${countdown} pro prazo.` : ''}
          </p>
          {locked && (
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)', marginBottom: 'var(--s3)' }}>
              🔒 Prazo encerrado — {hasBet ? 'seu palpite ficou salvo e travado.' : 'você não salvou palpite a tempo.'}
            </p>
          )}
          {order.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto', marginBottom: 'var(--s3)' }}>
              {order.map((teamId, i) => {
                const t = teamById[teamId]
                return (
                  <div key={teamId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 8, background: 'var(--bg-overlay)' }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', width: 22 }}>{i + 1}º</span>
                    {t?.flag_url && <TeamCrestFlag src={t.flag_url} alt={t.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-1)', flex: 1 }}>{t?.name ?? teamId}</span>
                    {!locked && (
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="group-manager-card__icon-btn" style={{ width: 26, height: 26 }} aria-label="Mover pra cima">▲</button>
                        <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} className="group-manager-card__icon-btn" style={{ width: 26, height: 26 }} aria-label="Mover pra baixo">▼</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {!locked && (
            <button type="button" className="btn btn-primary btn-sm" disabled={saving || order.length === 0} onClick={save}>
              {saving ? 'Salvando…' : hasBet ? 'Atualizar palpite' : 'Salvar palpite'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
