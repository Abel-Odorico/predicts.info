import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import { invalidateChampionCache } from './MyChampionCard'

const CHAMP_DEADLINE = new Date('2026-06-26T12:00:00Z')
const SEEN_VERSION_KEY = 'predicts_seen_version'
const CHAMP_DISMISS_KEY = 'predicts_champ_popup_dismissed'  // guarda a data (YYYY-MM-DD)
const PUSH_DISMISS_KEY  = 'predicts_push_prompt_dismissed'  // timestamp dismiss 7 dias

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

/* ───────────────────────── Modal shell ───────────────────────── */
function ModalShell({ onClose, children, maxWidth = 460 }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(3,8,14,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in-1"
        style={{
          width: '100%', maxWidth, maxHeight: '88vh', overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose} aria-label="Fechar"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--bg-overlay)', color: 'var(--text-2)', fontSize: 16, lineHeight: 1,
          }}
        >×</button>
        {children}
      </div>
    </div>,
    document.body
  )
}

/* ───────────────────────── Version popup ───────────────────────── */
function VersionPopup({ version, onClose }) {
  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: '28px 24px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🚀</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>
          NOVIDADES · v{version.version}
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-1)', margin: '6px 0 10px', letterSpacing: '0.02em' }}>
          {version.title}
        </h2>
        {version.description && (
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', margin: '0 0 16px', lineHeight: 1.5 }}>
            {version.description}
          </p>
        )}
        {!!(version.changes && version.changes.length) && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {version.changes.map((c, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.4 }}>
                <span style={{ color: 'var(--win)', flexShrink: 0 }}>＋</span>{c}
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/changelog" onClick={onClose} className="btn btn-ghost btn-sm" style={{ flex: 1, textAlign: 'center' }}>
            Ver changelog
          </Link>
          <button onClick={onClose} className="btn btn-primary btn-sm" style={{ flex: 1 }}>
            Entendi!
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

/* ───────────────────────── Champion popup (pick inline) ───────────────────────── */
function MiniTeamGrid({ teams, myId, blockedSet, statMap, halfMap, onPick, saving, accent }) {
  const [q, setQ] = useState('')
  const filtered = teams.filter(t =>
    !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.code.toLowerCase().includes(q.toLowerCase())
  )
  return (
    <>
      <input
        className="form-input"
        placeholder="🔍 Buscar seleção…"
        value={q}
        onChange={e => setQ(e.target.value)}
        style={{ marginBottom: 8, fontFamily: 'var(--font-cond)', fontSize: 13 }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6, maxHeight: 188, overflowY: 'auto', paddingRight: 2 }}>
        {filtered.map(t => {
          const mine = myId === t.id
          const blocked = blockedSet?.has(t.id)
          const stat = statMap[t.id]
          const half = halfMap?.[t.id]
          return (
            <button
              key={t.id}
              onClick={() => !blocked && !saving && onPick(t)}
              disabled={blocked || saving}
              title={blocked ? 'Mesmo lado do chaveamento — não podem chegar juntos à final' : undefined}
              style={{
                position: 'relative',
                background: mine ? `${accent}22` : blocked ? 'var(--bg-overlay)' : 'var(--bg-surface)',
                border: `2px solid ${mine ? accent : 'var(--border)'}`,
                borderRadius: 9, padding: '8px 4px', cursor: blocked ? 'not-allowed' : 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                opacity: blocked ? 0.4 : 1, transition: 'border-color .15s, background .15s',
              }}
            >
              {half && <span className={`half-badge half-badge--${half}`} style={{ position: 'absolute', top: 3, right: 3 }}>{half}</span>}
              <img src={t.flag_url} alt={t.code} style={{ width: 32, height: 23, objectFit: 'cover', borderRadius: 2 }} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--text-1)' }}>{t.code}</span>
              {stat && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: accent }}>{stat.pct}%</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}

function ChampionPopup({ token, onClose }) {
  const [teams, setTeams] = useState([])
  const [stats, setStats] = useState({ champion: [], runner_up: [] })
  const [halfMap, setHalfMap] = useState({})
  const [myPick, setMyPick] = useState(null)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState('champion')   // 'champion' | 'runner_up'
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      const [teamsData, statsData, sidesData, pick] = await Promise.all([
        api.get('/teams'),
        api.get('/champion/picks/stats').catch(() => ({ champion: [], runner_up: [] })),
        api.get('/tournament/bracket-sides').catch(() => ({ half_a: [], half_b: [] })),
        api.get('/champion/pick', token).catch(() => null),
      ])
      setTeams(teamsData)
      setStats(statsData)
      const m = {}
      for (const t of (sidesData.half_a || [])) m[t.id] = 'A'
      for (const t of (sidesData.half_b || [])) m[t.id] = 'B'
      setHalfMap(m)
      setMyPick(pick)
      if (pick?.champion && !pick?.runner_up) setStep('runner_up')
    })()
  }, [token])

  const myChampId = myPick?.champion?.team_id
  const myRunnerUpId = myPick?.runner_up?.team_id
  const champStatMap = useMemo(() => Object.fromEntries((stats.champion || []).map(s => [s.team_id, s])), [stats])
  const ruStatMap = useMemo(() => Object.fromEntries((stats.runner_up || []).map(s => [s.team_id, s])), [stats])

  // Vice não pode ser do mesmo lado do campeão (se encontrariam antes da final)
  const champHalf = myChampId ? halfMap[myChampId] : null
  const blockedForRu = useMemo(() => {
    if (!champHalf) return new Set(myChampId ? [myChampId] : [])
    const s = new Set(Object.entries(halfMap).filter(([, h]) => h === champHalf).map(([id]) => Number(id)))
    if (myChampId) s.add(myChampId)
    return s
  }, [champHalf, halfMap, myChampId])

  async function pick(team, type) {
    setSaving(true); setMsg('')
    try {
      const body = type === 'champion' ? { team_id: team.id } : { runner_up_team_id: team.id }
      const res = await api.post('/champion/pick', body, token)
      setMyPick(res)
      invalidateChampionCache()
      if (type === 'champion') setStep('runner_up')
      else setMsg('✓ Palpites salvos!')
    } catch (e) {
      setMsg(e?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const done = myChampId && myRunnerUpId
  const accent = step === 'champion' ? 'var(--accent)' : '#d4af37'

  return (
    <ModalShell onClose={onClose} maxWidth={520}>
      <div style={{ padding: '24px 22px 22px' }}>
        <div style={{ fontSize: 34, marginBottom: 4 }}>🏆</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-1)', margin: '0 0 4px' }}>
          Palpite de Campeão & Vice
        </h2>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', margin: '0 0 14px' }}>
          Acerte o campeão (+100 pts) e o vice (+50 pts). Escolha direto aqui 👇
        </p>

        {/* Resumo */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[
            { label: '🏆 Campeão', pick: myPick?.champion, color: 'var(--accent)', s: 'champion' },
            { label: '🥈 Vice', pick: myPick?.runner_up, color: '#d4af37', s: 'runner_up' },
          ].map(({ label, pick: p, color, s }) => (
            <button
              key={label} onClick={() => setStep(s)}
              style={{
                flex: 1, textAlign: 'left', cursor: 'pointer',
                background: p ? `${color}12` : 'var(--bg-surface)',
                border: `2px solid ${step === s ? color : p ? color : 'var(--border)'}`,
                borderRadius: 10, padding: '9px 11px',
              }}
            >
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
              {p ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <img src={p.flag} alt={p.code} style={{ width: 26, height: 18, objectFit: 'cover', borderRadius: 2 }} />
                  <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{p.code}</span>
                </div>
              ) : (
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic' }}>escolher</span>
              )}
            </button>
          ))}
        </div>

        {!done && (
          <>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: accent, marginBottom: 8, letterSpacing: '0.04em' }}>
              {step === 'champion' ? 'ESCOLHA O CAMPEÃO' : 'ESCOLHA O VICE-CAMPEÃO'}
            </div>
            <MiniTeamGrid
              teams={teams}
              myId={step === 'champion' ? myChampId : myRunnerUpId}
              blockedSet={step === 'runner_up' ? blockedForRu : null}
              statMap={step === 'champion' ? champStatMap : ruStatMap}
              halfMap={halfMap}
              onPick={t => pick(t, step)}
              saving={saving}
              accent={accent}
            />
          </>
        )}

        {msg && (
          <div style={{ marginTop: 12, fontFamily: 'var(--font-cond)', fontSize: 13, color: done ? 'var(--win)' : 'var(--lose)' }}>{msg}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Link to="/campeao" onClick={onClose} className="btn btn-ghost btn-sm" style={{ flex: 1, textAlign: 'center' }}>
            Página completa
          </Link>
          <button onClick={onClose} className="btn btn-primary btn-sm" style={{ flex: 1 }}>
            {done ? 'Pronto!' : 'Depois'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

/* ───────────────────────── Push prompt ───────────────────────── */
function _urlB64ToUint8(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function PushPromptPopup({ token, onClose }) {
  const [status, setStatus] = useState('idle') // idle | loading | done | denied | error

  async function enable() {
    setStatus('loading')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setStatus('denied'); return }

      // Busca VAPID key
      const { publicKey } = await api.get('/push/vapid-key')
      if (!publicKey) { setStatus('error'); return }

      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: _urlB64ToUint8(publicKey),
        })
      }
      const key  = sub.getKey('p256dh')
      const auth = sub.getKey('auth')
      await api.post('/push/subscribe', {
        endpoint: sub.endpoint,
        p256dh:  key  ? btoa(String.fromCharCode(...new Uint8Array(key)))  : '',
        auth:    auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
      }, token)
      setStatus('done')
      setTimeout(onClose, 1800)
    } catch (e) {
      console.error('push subscribe', e)
      setStatus('error')
    }
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9400,
        background: 'rgba(3,8,14,0.72)', backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 0 24px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in-1"
        style={{
          width: '100%', maxWidth: 420,
          background: 'var(--bg-card)', border: '1.5px solid var(--border)',
          borderRadius: 16, padding: '20px 20px 18px',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
          margin: '0 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
          <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>🔔</span>
          <div>
            <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)', marginBottom: 4 }}>
              Ativar notificações
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
              Receba alertas de resultados de apostas, lembretes de jogos e atualizações do ranking — mesmo com o app fechado.
            </div>
          </div>
        </div>

        {status === 'done' && (
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--win)', padding: '8px 0' }}>
            ✓ Notificações ativadas!
          </div>
        )}
        {status === 'denied' && (
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)', marginBottom: 10 }}>
            Permissão negada. Acesse as configurações do navegador para desbloquear.
          </div>
        )}
        {status === 'error' && (
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)', marginBottom: 10 }}>
            Erro ao ativar. Tente pelo Perfil → Notificações.
          </div>
        )}

        {(status === 'idle' || status === 'loading') && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={enable}
              disabled={status === 'loading'}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
                background: 'var(--accent)', color: '#fff',
                fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
                opacity: status === 'loading' ? 0.7 : 1,
              }}
            >
              {status === 'loading' ? 'Ativando…' : 'Ativar notificações'}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 16px', borderRadius: 9, border: '1px solid var(--border)',
                background: 'var(--bg-overlay)', color: 'var(--text-3)', cursor: 'pointer',
                fontFamily: 'var(--font-cond)', fontSize: 13,
              }}
            >
              Agora não
            </button>
          </div>
        )}

        {(status === 'denied' || status === 'error') && (
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 9, border: '1px solid var(--border)',
              background: 'var(--bg-overlay)', color: 'var(--text-3)', cursor: 'pointer',
              fontFamily: 'var(--font-cond)', fontSize: 13,
            }}
          >
            Fechar
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}

/* ───────────────────────── Orchestrator ───────────────────────── */
export default function AppPopups() {
  const { token } = useAuth()
  const [active, setActive] = useState(null)   // 'version' | 'champion' | 'push' | null
  const [versionData, setVersionData] = useState(null)

  useEffect(() => {
    let mounted = true
    async function decide() {
      // 1) Versão nova ainda não vista
      try {
        const v = await api.get('/version/latest')
        if (mounted && v?.version && localStorage.getItem(SEEN_VERSION_KEY) !== v.version) {
          setVersionData(v)
          setActive('version')
          return
        }
      } catch {}
      // 2) Campeão (só logado, prazo aberto, palpite incompleto, não dispensado hoje)
      await maybeChampion()
    }

    async function maybeChampion() {
      if (!token) return
      if (CHAMP_DEADLINE - Date.now() <= 0) return
      if (localStorage.getItem(CHAMP_DISMISS_KEY) === todayKey()) return
      try {
        const pick = await api.get('/champion/pick', token)
        if (mounted && (!pick?.champion || !pick?.runner_up)) setActive('champion')
      } catch {
        if (mounted) setActive('champion')
      }
    }

    const t = setTimeout(decide, 700)
    return () => { mounted = false; clearTimeout(t) }
  }, [token])

  // Push prompt: logado + suportado + não dispensado + não subscrito ainda
  useEffect(() => {
    if (!token) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return
    if (Notification.permission === 'granted') return  // já tem permissão, sw cuida

    const dismissed = localStorage.getItem(PUSH_DISMISS_KEY)
    if (dismissed && Date.now() < parseInt(dismissed, 10)) return

    const t = setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager?.getSubscription()
        if (!sub) setActive(prev => prev === null ? 'push' : prev)
      } catch {}
    }, 12000)
    return () => clearTimeout(t)
  }, [token])

  function closeVersion() {
    if (versionData?.version) localStorage.setItem(SEEN_VERSION_KEY, versionData.version)
    setActive(null)
    setTimeout(() => {
      if (!token) return
      if (CHAMP_DEADLINE - Date.now() <= 0) return
      if (localStorage.getItem(CHAMP_DISMISS_KEY) === todayKey()) return
      api.get('/champion/pick', token)
        .then(p => { if (!p?.champion || !p?.runner_up) setActive('champion') })
        .catch(() => setActive('champion'))
    }, 350)
  }

  function closeChampion() {
    localStorage.setItem(CHAMP_DISMISS_KEY, todayKey())
    setActive(null)
  }

  function closePush() {
    localStorage.setItem(PUSH_DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000))
    setActive(null)
  }

  if (active === 'version' && versionData) return <VersionPopup version={versionData} onClose={closeVersion} />
  if (active === 'champion') return <ChampionPopup token={token} onClose={closeChampion} />
  if (active === 'push') return <PushPromptPopup token={token} onClose={closePush} />
  return null
}
