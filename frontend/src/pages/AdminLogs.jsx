import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

function fmt(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

const TABS = [
  { id: null,          label: 'Tudo' },
  { id: 'error',        label: '🔴 Erros' },
  { id: 'checkpoint',   label: '🔵 Checkpoints' },
]

export default function AdminLogs() {
  const { token } = useAuth()
  const [rows, setRows] = useState([])
  const [kind, setKind] = useState('error')
  const [loading, setLoading] = useState(true)
  const [auto, setAuto] = useState(false)
  const [openRow, setOpenRow] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    const qs = kind ? `?kind=${kind}&limit=300` : '?limit=300'
    api.get(`/admin/client-diag${qs}`, token).then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }, [kind, token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [auto, load])

  return (
    <div className="adm-shell">
      <div className="adm-header">
        <div className="adm-header__left">
          <div className="adm-header__title">🪵 LOGS</div>
          <div className="adm-header__sub">predicts.info · erros e checkpoints reportados pelo navegador do usuário</div>
        </div>
        <div className="adm-header__actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setAuto(a => !a)}>{auto ? '⏸ Auto-refresh' : '▶ Auto-refresh'}</button>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>{loading ? '…' : '↻ Atualizar'}</button>
          <a href="/admin" className="btn btn-ghost btn-sm">🛠 Painel Admin</a>
          <a href="/admin/sistema" className="btn btn-ghost btn-sm">🧬 Sistema</a>
        </div>
      </div>

      <div className="adm-pane fade-in-1">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          {TABS.map(t => (
            <button key={t.label} className={kind === t.id ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setKind(t.id)}>{t.label}</button>
          ))}
        </div>

        <p style={{ color: 'var(--text-4)', fontSize: 12.5, marginBottom: 14 }}>
          Captura global de erro JS + promise rejeitada (qualquer página) e checkpoints de progresso em /apostas e /brasileirao
          (mount → dados carregados → lista renderizada) — usado pra achar travas silenciosas no Safari iOS, onde um crash
          nativo mata a aba antes de qualquer erro aparecer. Guarda os últimos ~3000 eventos, sem tabela dedicada.
        </p>

        {rows.length === 0 && !loading && (
          <div className="bet-empty" style={{ color: 'var(--text-3)' }}>Nenhum evento ainda.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r, i) => {
            const isErr = r.kind === 'error'
            const isOpen = openRow === i
            return (
              <div key={i} className="adm-card" style={{ padding: '10px 14px', cursor: 'pointer', borderColor: isErr ? 'var(--lose)' : 'var(--border)' }} onClick={() => setOpenRow(isOpen ? null : i)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                  <span>{isErr ? '🔴' : '🔵'}</span>
                  <span style={{ color: 'var(--text-4)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmt(r.at)}</span>
                  <span style={{ fontWeight: 700 }}>{r.event || r.message || '—'}</span>
                  <span style={{ color: 'var(--text-4)', fontSize: 11 }}>{r.path}</span>
                </div>
                {isOpen && (
                  <pre style={{ marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                    {JSON.stringify(r, null, 2)}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
