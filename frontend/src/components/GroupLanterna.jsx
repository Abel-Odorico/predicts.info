import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { toast } from '../toast'
import CollapsibleSection from './CollapsibleSection'

// Seção "🔴 Lanterna" (passo 16) — histórico por rodada + fundo acumulado + split.
export default function GroupLanterna({ groupId, token, amOwner }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(null)

  const load = useCallback(() => {
    api.get(`/user-groups/${groupId}/lanterna`, token)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [groupId, token])

  useEffect(() => { load() }, [load])

  async function togglePix(lanternaId, userId, current) {
    const key = `${lanternaId}-${userId}-pix`
    setSavingKey(key)
    try {
      const res = await api.patch(`/user-groups/${groupId}/lanterna/${lanternaId}`, { user_id: userId, pix_paid: !current }, token)
      setData(d => ({
        ...d,
        history: d.history.map(h => h.id !== lanternaId ? h : {
          ...h,
          users: h.users.map(u => u.user_id !== userId ? u : { ...u, pix_paid: res.pix_paid?.[String(userId)] ?? !current }),
        }),
      }))
      load() // refetch pra fund_total/paid_count recalculados no servidor refletirem sem reload manual
      toast.success('Atualizado')
    } catch (e) { toast.error(e.message || 'Erro ao salvar') }
    finally { setSavingKey(null) }
  }

  async function toggleVideo(lanternaId, userId, current) {
    const key = `${lanternaId}-${userId}-video`
    setSavingKey(key)
    try {
      const res = await api.patch(`/user-groups/${groupId}/lanterna/${lanternaId}`, { user_id: userId, video_confirmed: !current }, token)
      setData(d => ({
        ...d,
        history: d.history.map(h => h.id !== lanternaId ? h : {
          ...h,
          users: h.users.map(u => u.user_id !== userId ? u : { ...u, video_confirmed: res.video_confirmed?.[String(userId)] ?? !current }),
        }),
      }))
      toast.success('Atualizado')
    } catch (e) { toast.error(e.message || 'Erro ao salvar') }
    finally { setSavingKey(null) }
  }

  if (loading || !data) return null

  const history = [...(data.history ?? [])].sort((a, b) => b.match_number - a.match_number)
  const teaser = `R$ ${(data.fund_total ?? 0).toFixed(2)} no fundo · ${history.length} rodada${history.length === 1 ? '' : 's'}`

  return (
    <CollapsibleSection kicker="Mecânica 3" title="🔴 Lanterna da Rodada" teaser={teaser} accent="var(--lose)">
      {/* ── Fundo acumulado + split ── */}
      <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-overlay)', minWidth: 120 }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Fundo acumulado</div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 700, color: 'var(--win)' }}>R$ {(data.fund_total ?? 0).toFixed(2)}</div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>{data.paid_count ?? 0} pix pago{(data.paid_count ?? 0) === 1 ? '' : 's'} · R$ {(data.pix_value ?? 0).toFixed(2)} cada</div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            {data.is_final ? '🏁 Split final' : '📊 Projeção do split'} ({(data.fund_split ?? []).join('/')}%)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(data.projection ?? []).map(p => (
              <div key={p.position} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 12 }}>
                <span style={{ width: 20, color: 'var(--text-3)' }}>{p.position}º</span>
                <span style={{ flex: 1, color: 'var(--text-1)', fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: 'var(--text-3)' }}>{p.pct}%</span>
                <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, color: 'var(--win)' }}>R$ {(p.amount ?? 0).toFixed(2)}</span>
              </div>
            ))}
            {(data.projection ?? []).length === 0 && (
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>Sem ranking suficiente ainda.</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Histórico por rodada ── */}
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
        Histórico ({history.length} rodada{history.length === 1 ? '' : 's'})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
        {history.map(h => (
          <div key={h.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-overlay)' }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>Rodada {h.match_number}</div>
            {h.users.map(u => (
              <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', flex: 1, minWidth: 100 }}>{u.name}</span>
                {amOwner ? (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!u.pix_paid} disabled={savingKey === `${h.id}-${u.user_id}-pix`} onChange={() => togglePix(h.id, u.user_id, !!u.pix_paid)} />
                      PIX pago
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!u.video_confirmed} disabled={savingKey === `${h.id}-${u.user_id}-video`} onChange={() => toggleVideo(h.id, u.user_id, !!u.video_confirmed)} />
                      Vídeo
                    </label>
                  </>
                ) : (
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                    {u.pix_paid ? '✅ PIX' : '⏳ PIX'} · {u.video_confirmed ? '✅ Vídeo' : '⏳ Vídeo'}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        {history.length === 0 && (
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>Nenhuma rodada fechada ainda.</span>
        )}
      </div>
    </CollapsibleSection>
  )
}
