/**
 * AppPopups — Central de Popups do Predicts.info
 *
 * Fila única: todas as condições são avaliadas de uma vez (700ms após mount,
 * sem timers concorrentes) e resolvidas em POPUP_ORDER. Só queue[0] é
 * renderizado — nunca dois popups sobrepostos. Fechar um avança pro próximo
 * pendente (fluxo de navegação), sem popup "roubando" a vez de outro.
 *
 * Ordem: version → competition → champion → invite → push → whatsapp
 * (onboarding virou página: visitante novo é redirecionado pra /bem-vindo)
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import { invalidateChampionCache } from './MyChampionCard'
import ShareCompetitionButton from './ShareCompetitionButton'
import { useCountdown, CountdownDisplay } from '../hooks/useCountdown.jsx'

// ── Dismiss keys (localStorage) ───────────────────────────────────────────────
const SEEN_VERSION_KEY   = 'predicts_seen_version'
const CHAMP_DISMISS_KEY  = 'predicts_champ_popup_dismissed'   // data YYYY-MM-DD
const PUSH_DISMISS_KEY   = 'predicts_push_prompt_dismissed'   // timestamp
const INVITE_DISMISS_KEY = 'predicts_invite_popup_last'       // timestamp (30 min)

const CHAMP_DEADLINE = new Date('2026-06-26T12:00:00Z')

function todayKey() { return new Date().toISOString().slice(0, 10) }
function isDismissed(key) {
  const v = localStorage.getItem(key)
  return v ? Date.now() < parseInt(v, 10) : false
}
function dismiss(key, days) {
  localStorage.setItem(key, String(Date.now() + days * 86400000))
}

// ── Shared: ModalShell (centro da tela) ───────────────────────────────────────
function ModalShell({ onClose, children, maxWidth = 460, zIndex = 'var(--z-modal)' }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  return createPortal(
    <div onClick={onClose} className="pop-backdrop" style={{ zIndex }}>
      <div onClick={e => e.stopPropagation()} className="pop-card fade-in-1" style={{ maxWidth }}>
        <button onClick={onClose} aria-label="Fechar" className="pop-close">✕</button>
        {children}
      </div>
    </div>,
    document.body
  )
}

// ── Shared: BottomSheet (mobile-friendly) ─────────────────────────────────────
function BottomSheet({ onClose, children, zIndex = 'var(--z-sheet)' }) {
  return createPortal(
    <div onClick={onClose} className="pop-backdrop pop-backdrop--sheet" style={{ zIndex }}>
      <div onClick={e => e.stopPropagation()} className="pop-sheet fade-in-1">
        <button onClick={onClose} aria-label="Fechar" className="pop-close">✕</button>
        {/* drag handle */}
        <div className="pop-sheet__handle" />
        {children}
      </div>
    </div>,
    document.body
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. POPUP: VERSÃO
// ═════════════════════════════════════════════════════════════════════════════
function VersionPopup({ version, onClose }) {
  return (
    <ModalShell onClose={onClose}>
      <div style={{ padding: '28px 24px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🚀</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>
          NOVIDADES · v{version.version}
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-1)', margin: '6px 0 10px' }}>
          {version.title}
        </h2>
        {version.description && (
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', margin: '0 0 16px', lineHeight: 1.5 }}>
            {version.description}
          </p>
        )}
        {!!(version.changes?.length) && (
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

// ═════════════════════════════════════════════════════════════════════════════
// 2. POPUP: CAMPEÃO & VICE
// ═════════════════════════════════════════════════════════════════════════════
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
  const [step, setStep] = useState('champion')
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

  const myChampId    = myPick?.champion?.team_id
  const myRunnerUpId = myPick?.runner_up?.team_id
  const champStatMap = Object.fromEntries((stats.champion || []).map(s => [s.team_id, s]))
  const ruStatMap    = Object.fromEntries((stats.runner_up || []).map(s => [s.team_id, s]))
  const champHalf    = myChampId ? halfMap[myChampId] : null
  const blockedForRu = (() => {
    if (!champHalf) return new Set(myChampId ? [myChampId] : [])
    const s = new Set(Object.entries(halfMap).filter(([, h]) => h === champHalf).map(([id]) => Number(id)))
    if (myChampId) s.add(myChampId)
    return s
  })()

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

  const done   = myChampId && myRunnerUpId
  const accent = step === 'champion' ? 'var(--accent)' : '#d4af37'

  return (
    <ModalShell onClose={onClose} maxWidth={520}>
      <div style={{ padding: '24px 22px 22px' }}>
        <div style={{ fontSize: 34, marginBottom: 4 }}>🏆</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-1)', margin: '0 0 4px' }}>
          Palpite de Campeão & Vice
        </h2>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Acerte o campeão (+100 pts) e o vice (+50 pts).
        </p>
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
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginBottom: 3 }}>{label}</div>
              {p ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <img src={p.flag} alt={p.code} style={{ width: 26, height: 18, objectFit: 'cover', borderRadius: 2 }} />
                  <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13 }}>{p.code}</span>
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

// ═════════════════════════════════════════════════════════════════════════════
// 3. POPUP: INSTALAR APP (novo)
// ═════════════════════════════════════════════════════════════════════════════
const INSTALL_STEPS = {
  android: [
    { n: '1', text: 'Abra predicts.info no', highlight: 'Chrome', sub: 'Navegador padrão Android' },
    { n: '2', text: 'Toque no menu', highlight: '⋮', sub: 'Três pontinhos no canto superior direito' },
    { n: '3', text: 'Toque em', highlight: '"Instalar app"', sub: 'Ou "Adicionar à tela inicial"' },
    { n: '4', text: 'Confirme e', highlight: 'abra o ícone', sub: 'Aparece na sua tela inicial' },
  ],
  ios: [
    { n: '1', text: 'Abra predicts.info no', highlight: 'Safari', sub: 'Não funciona no Chrome ou Firefox' },
    { n: '2', text: 'Toque em', highlight: 'Compartilhar ⎙', sub: 'Ícone na barra inferior do Safari' },
    { n: '3', text: 'Toque em', highlight: '"Adicionar à Tela de Início"', sub: 'Role a lista para encontrar a opção' },
    { n: '4', text: 'Toque em', highlight: '"Adicionar"', sub: 'O ícone aparece na sua tela inicial' },
  ],
}

export function InstallAppPopup({ onClose }) {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const [platform, setPlatform] = useState(isIOS ? 'ios' : 'android')
  const steps = INSTALL_STEPS[platform]

  return (
    <ModalShell onClose={onClose} maxWidth={460} zIndex="var(--z-install)">
      <div style={{ padding: '0 0 6px' }}>

        {/* Hero banner */}
        <div style={{
          background: 'linear-gradient(135deg, var(--accent) 0%, #0a5856 100%)',
          padding: '28px 24px 22px', textAlign: 'center', borderRadius: '12px 12px 0 0',
        }}>
          <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 10 }}>📲</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Instale o Predicts no celular
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>
            Grátis · Acesso rápido · Notificações de jogos
          </div>
          {/* Benefit pills */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            {['⚡ Abre em 1 toque', '🔔 Alertas de jogo', '📵 Funciona offline'].map(b => (
              <span key={b} style={{
                background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 100, padding: '3px 10px', fontSize: 11, color: '#fff', fontWeight: 600,
              }}>{b}</span>
            ))}
          </div>
        </div>

        <div style={{ padding: '20px 22px 18px' }}>
          {/* Platform toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[
              { id: 'android', emoji: '🤖', label: 'Android', sub: 'via Chrome' },
              { id: 'ios',     emoji: '🍎', label: 'iPhone / iPad', sub: 'via Safari' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                style={{
                  flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', transition: 'all 150ms',
                  border: platform === p.id ? '2px solid var(--accent)' : '2px solid var(--border)',
                  background: platform === p.id ? 'rgba(15,122,120,0.08)' : 'var(--bg-overlay)',
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 3 }}>{p.emoji}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: platform === p.id ? 'var(--accent)' : 'var(--text-2)' }}>
                  {p.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 1 }}>{p.sub}</div>
              </button>
            ))}
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {steps.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--bg-overlay)', borderRadius: 10, padding: '10px 14px',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--accent)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 900,
                }}>{s.n}</div>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.3 }}>
                    {s.text} <strong style={{ color: 'var(--text-1)' }}>{s.highlight}</strong>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{s.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 800,
              letterSpacing: '-0.01em', marginBottom: 8,
            }}
          >
            ✓ Já instalei — fechar
          </button>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 10,
              border: 'none', background: 'transparent',
              color: 'var(--text-4)', cursor: 'pointer', fontSize: 12,
            }}
          >
            Agora não
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. POPUP: ATIVAR NOTIFICAÇÕES PUSH
// ═════════════════════════════════════════════════════════════════════════════
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
        p256dh: key  ? btoa(String.fromCharCode(...new Uint8Array(key)))  : '',
        auth:   auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
      }, token)
      setStatus('done')
      setTimeout(onClose, 1800)
    } catch (e) {
      console.error('push subscribe', e)
      setStatus('error')
    }
  }

  return (
    <BottomSheet onClose={onClose} zIndex="var(--z-sheet)">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
        <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>🔔</span>
        <div>
          <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)', marginBottom: 4 }}>
            Ativar notificações
          </div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Resultados de apostas · Lembretes de jogos · Ranking atualizado — mesmo com o app fechado.
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
          Permissão negada. Acesse Configurações do site para desbloquear.
        </div>
      )}
      {status === 'error' && (
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)', marginBottom: 10 }}>
          Erro ao ativar. Tente em Perfil → Notificações.
        </div>
      )}

      {(status === 'idle' || status === 'loading') && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={enable}
            disabled={status === 'loading'}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
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
              padding: '11px 16px', borderRadius: 9, border: '1px solid var(--border)',
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
            width: '100%', padding: '11px 0', borderRadius: 9, border: '1px solid var(--border)',
            background: 'var(--bg-overlay)', color: 'var(--text-3)', cursor: 'pointer',
            fontFamily: 'var(--font-cond)', fontSize: 13,
          }}
        >
          Fechar
        </button>
      )}
    </BottomSheet>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. POPUP: NOVA COMPETIÇÃO / FASE
// ═════════════════════════════════════════════════════════════════════════════
export function CompetitionPopup({ competition, onClose, showRankingLink = false }) {
  const { user } = useAuth()
  const countdown = useCountdown(competition.start_date)
  const isFuture  = countdown && !countdown.started
  const startDate = competition.start_date
    ? new Date(competition.start_date + (competition.start_date.endsWith('Z') ? '' : 'Z'))
    : null
  const fmtDate   = startDate
    ? startDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long' })
    : null

  const refParam   = user?.id ? `?ref=${user.id}` : ''
  const inviteUrl  = `https://predicts.info${refParam}`
  const shareText  = `⚡ Nova fase do Predicts.info!\n\n${competition.name} — pontuação zerada, todos partem do mesmo ponto.\n\n🏆 Vem competir: ${inviteUrl}`
  const waHref     = `https://wa.me/?text=${encodeURIComponent(shareText)}`
  const tgHref     = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(`⚡ ${competition.name} — nova competição no Predicts!`)}`

  function copyLink() {
    navigator.clipboard?.writeText(inviteUrl).catch(() => {})
  }

  return (
    <ModalShell onClose={onClose} maxWidth={460} zIndex="var(--z-popup-top)">
      <div style={{ padding: '0 0 4px' }}>
        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(232,196,74,0.18) 0%, rgba(15,122,120,0.10) 100%)',
          borderRadius: '14px 14px 0 0', padding: '28px 24px 22px', textAlign: 'center',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>⚡</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: '#e8c44a', letterSpacing: '0.12em', marginBottom: 6 }}>
            {isFuture ? 'EM BREVE' : 'COMEÇA AGORA'}
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--text-1)', margin: '0 0 8px', letterSpacing: '0.03em', lineHeight: 1.1 }}>
            {competition.name}
          </h2>
          {competition.description && (
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13.5, color: 'var(--text-3)', margin: 0, lineHeight: 1.55 }}>
              {competition.description}
            </p>
          )}
          {isFuture && countdown
            ? <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                <CountdownDisplay timeLeft={countdown} />
              </div>
            : fmtDate && (
              <div style={{ marginTop: 10, fontFamily: 'var(--font-cond)', fontSize: 12, color: '#e8c44a', fontWeight: 700 }}>
                📅 {isFuture ? `Começa em ${fmtDate}` : `Iniciou em ${fmtDate}`}
              </div>
            )
          }
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Destaque zero-a-zero */}
          <div style={{
            display: 'flex', gap: 10, marginBottom: 18,
            background: 'rgba(15,122,120,0.07)', border: '1px solid rgba(15,122,120,0.2)',
            borderRadius: 12, padding: '14px 16px',
          }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>🆕</span>
            <div>
              <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)', marginBottom: 3 }}>
                Novo começo, campo igual para todos
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Pontuação zerada nesta fase. Quem entrar agora compete em igualdade com quem jogou desde o início.
              </div>
            </div>
          </div>

          {/* Promo text */}
          {competition.promo_text && (
            <div style={{
              fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)',
              fontStyle: 'italic', textAlign: 'center', marginBottom: 18,
              padding: '10px 14px', background: 'var(--bg-overlay)', borderRadius: 10,
            }}>
              "{competition.promo_text}"
            </div>
          )}

          {/* Convite */}
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 10 }}>
            📣 Chame seus amigos — compartilhe o link:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <a
              href={waHref} target="_blank" rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '11px 0', borderRadius: 10, textDecoration: 'none',
                background: '#25D366', color: '#fff',
                fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
              }}
            >
              WhatsApp
            </a>
            <a
              href={tgHref} target="_blank" rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '11px 0', borderRadius: 10, textDecoration: 'none',
                background: '#0088cc', color: '#fff',
                fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
              }}
            >
              Telegram
            </a>
          </div>
          <div style={{ marginBottom: 10 }}>
            <ShareCompetitionButton competition={competition} />
          </div>

          <button
            onClick={copyLink}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: '1px solid var(--border)',
              background: 'var(--bg-overlay)', color: 'var(--text-2)', cursor: 'pointer',
              fontFamily: 'var(--font-cond)', fontSize: 13, marginBottom: 14,
            }}
          >
            📋 Copiar link{user?.id ? ' com meu convite' : ' predicts.info'}
          </button>

          {showRankingLink && (
            <Link
              to="/ranking"
              onClick={onClose}
              style={{
                display: 'block', width: '100%', padding: '12px 0', borderRadius: 10,
                border: 'none', cursor: 'pointer', textAlign: 'center', textDecoration: 'none',
                background: 'var(--accent)', color: '#fff',
                fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700, marginBottom: 8,
              }}
            >
              ⚡ Ver ranking da fase →
            </Link>
          )}
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 10, cursor: 'pointer',
              border: showRankingLink ? '1px solid var(--border)' : 'none',
              background: showRankingLink ? 'var(--bg-overlay)' : 'var(--accent)',
              color: showRankingLink ? 'var(--text-3)' : '#fff',
              fontFamily: 'var(--font-cond)', fontSize: showRankingLink ? 13 : 15, fontWeight: 700,
            }}
          >
            {showRankingLink ? 'Fechar' : (isFuture ? 'Entendi! Vou me preparar ⚡' : 'Bora competir! ⚡')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. POPUP: CONVITE PARA GRUPO
// ═════════════════════════════════════════════════════════════════════════════
function InvitePopup({ invites, token, onClose }) {
  const [responding, setResponding] = useState({})
  const [localInvites, setLocalInvites] = useState(invites)

  async function respond(inviteId, action) {
    setResponding(r => ({ ...r, [inviteId]: action }))
    try {
      await api.post(`/user-groups/invites/${inviteId}/${action}`, {}, token)
      setLocalInvites(prev => prev.filter(i => i.id !== inviteId))
    } catch {}
    setResponding(r => { const n = {...r}; delete n[inviteId]; return n })
  }

  if (localInvites.length === 0) { onClose(); return null }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a90e8', marginBottom: 6 }}>
        👥 Convite{localInvites.length > 1 ? 's' : ''} para Bolão
      </div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-1)', margin: '0 0 14px', lineHeight: 1.1 }}>
        Você foi convidado!
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {localInvites.map(invite => (
          <div key={invite.id} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)', marginBottom: 3 }}>
              {invite.group_name}
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
              Convite de {invite.inviter_name || 'um membro'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => respond(invite.id, 'accept')}
                disabled={!!responding[invite.id]}
                style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, opacity: responding[invite.id] ? 0.6 : 1 }}
              >
                {responding[invite.id] === 'accept' ? '...' : '✓ Aceitar'}
              </button>
              <button
                onClick={() => respond(invite.id, 'reject')}
                disabled={!!responding[invite.id]}
                style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg-overlay)', color: 'var(--text-2)', fontFamily: 'var(--font-cond)', fontSize: 13, opacity: responding[invite.id] ? 0.6 : 1 }}
              >
                {responding[invite.id] === 'reject' ? '...' : '✕ Recusar'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link
          to="/meus-grupos"
          onClick={onClose}
          style={{ flex: 1, padding: '11px 0', borderRadius: 9, background: '#4a90e820', color: '#4a90e8', border: '1px solid #4a90e840', textAlign: 'center', textDecoration: 'none', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700 }}
        >
          Ver Meus Grupos →
        </Link>
        <button
          onClick={onClose}
          style={{ padding: '11px 18px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-overlay)', color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13 }}
        >
          Depois
        </button>
      </div>
    </BottomSheet>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// POPUP: OPT-IN WHATSAPP
// ═════════════════════════════════════════════════════════════════════════════
function WhatsAppOptInPopup({ user, token, onDone }) {
  const [phone, setPhone] = useState(user?.phone || '')
  const [saving, setSaving] = useState(null) // 'in' | 'out' | null
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [waLink, setWaLink] = useState(null)
  const { setUser } = useAuth()

  useEffect(() => {
    let mounted = true
    api.get('/whatsapp/contact').then(r => {
      if (mounted && r?.available) setWaLink(r.wa_link)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  async function activate() {
    if (!phone.trim()) { setErr('Digita seu celular com DDD pra ativar'); return }
    setErr(''); setSaving('in')
    try {
      const updated = await api.patch('/auth/profile', { phone: phone.trim(), whatsapp_opt_in: true }, token)
      setUser(updated)
      setSaving(null)
      setDone(true)
    } catch (e) { setErr(e.message || 'Erro ao salvar'); setSaving(null) }
  }

  async function dismiss() {
    setSaving('out')
    try {
      const updated = await api.patch('/auth/profile', { whatsapp_prompt_dismissed: true }, token)
      setUser(updated)
    } catch {}
    onDone()
  }

  if (done) {
    return (
      <ModalShell onClose={onDone}>
        <div style={{ padding: '28px 24px 24px', textAlign: 'center' }}>
          <div
            className="pulse-accent"
            style={{
              width: 56, height: 56, borderRadius: 14, marginBottom: 14, marginLeft: 'auto', marginRight: 'auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28,
              background: 'linear-gradient(135deg, var(--accent-glow) 0%, var(--accent-dim) 100%)',
              border: '1.5px solid var(--accent)',
            }}
          >
            ✅
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text-1)', margin: '0 0 10px' }}>
            WhatsApp ativado!
          </h2>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Te mandamos uma mensagem de boas-vindas com o passo a passo. Abre o WhatsApp e manda um "oi" pra começar.
          </p>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{
                display: 'block', width: '100%', textAlign: 'center', textDecoration: 'none',
                fontFamily: 'var(--font-display)', fontWeight: 900, letterSpacing: '0.06em',
              }}
            >
              💬 Abrir WhatsApp agora
            </a>
          )}
          <button
            onClick={onDone}
            style={{ marginTop: 'var(--s3)', width: '100%', background: 'none', border: 'none', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 12, cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            Fechar
          </button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={dismiss}>
      <div style={{ padding: '28px 24px 24px' }}>
        <div
          className="pulse-accent"
          style={{
            width: 56, height: 56, borderRadius: 14, marginBottom: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
            background: 'linear-gradient(135deg, var(--accent-glow) 0%, var(--accent-dim) 100%)',
            border: '1.5px solid var(--accent)',
          }}
        >
          📲
        </div>
        <span className="section-title" style={{ margin: '0 0 8px', border: 'none', padding: 0, color: 'var(--accent)' }}>
          Novo
        </span>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--text-1)', margin: '0 0 10px' }}>
          Aposte direto pelo WhatsApp
        </h2>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', margin: '0 0 18px', lineHeight: 1.5 }}>
          Manda <strong style={{ color: 'var(--text-1)' }}>"Brasil 2x1 Argentina"</strong> no WhatsApp, confirma com <strong style={{ color: 'var(--text-1)' }}>"SIM"</strong> e o palpite entra automático. Sem abrir o app.
        </p>
        <input
          type="tel"
          className="form-input"
          placeholder="(11) 99999-9999"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        {err && <p style={{ color: 'var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 12, margin: '0 0 10px' }}>{err}</p>}
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontFamily: 'var(--font-display)', fontWeight: 900, letterSpacing: '0.06em' }}
          onClick={activate}
          disabled={saving === 'in'}
        >
          {saving === 'in' ? 'Ativando…' : '✅ Ativar agora'}
        </button>
        <button
          onClick={dismiss}
          disabled={saving === 'out'}
          style={{ marginTop: 'var(--s3)', width: '100%', background: 'none', border: 'none', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 12, cursor: 'pointer', letterSpacing: '0.06em' }}
        >
          Agora não
        </button>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 12, textAlign: 'center' }}>
          Dá pra ativar/desativar depois em Meu Perfil.
        </p>
      </div>
    </ModalShell>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// ORQUESTRADOR — fila única. Um popup por vez, próximo só entra quando o
// anterior é fechado (fluxo de navegação, sem sobreposição/empilhamento).
// Ordem: version → competition → champion → invite → push → whatsapp
// ═════════════════════════════════════════════════════════════════════════════
const POPUP_ORDER = ['version', 'competition', 'champion', 'invite', 'push', 'whatsapp']
const ONBOARDED_KEY = 'predicts-onboarded'

export default function AppPopups() {
  const { token, user } = useAuth()
  const [queue, setQueue] = useState([])
  const [versionData, setVersionData] = useState(null)
  const [competitionData, setCompetitionData] = useState(null)
  const [pendingInvites, setPendingInvites] = useState([])
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // ── Onboarding: visitante novo entrando pela home vai pra página /bem-vindo
  // (deep links — /partida/X, /bolao/token etc. — não são sequestrados)
  useEffect(() => {
    if (!localStorage.getItem(ONBOARDED_KEY) && (pathname === '/' || pathname === '/dashboard')) {
      navigate('/bem-vindo', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Monta a fila inteira de uma vez (sem timers concorrentes) ────────────
  useEffect(() => {
    let mounted = true

    async function build() {
      const eligible = []

      try {
        const v = await api.get('/version/latest')
        if (v?.version && localStorage.getItem(SEEN_VERSION_KEY) !== v.version) {
          if (mounted) setVersionData(v)
          eligible.push('version')
        }
      } catch {}

      try {
        const c = await api.get('/competition/active')
        if (c?.id && !localStorage.getItem(`predicts_comp_seen_${c.id}`)) {
          if (mounted) setCompetitionData(c)
          eligible.push('competition')
        }
      } catch {}

      if (token) {
        if (CHAMP_DEADLINE - Date.now() > 0 && localStorage.getItem(CHAMP_DISMISS_KEY) !== todayKey()) {
          try {
            const pick = await api.get('/champion/pick', token)
            if (!pick?.champion || !pick?.runner_up) eligible.push('champion')
          } catch { eligible.push('champion') }
        }

        const lastInvite = parseInt(localStorage.getItem(INVITE_DISMISS_KEY) || '0', 10)
        if (Date.now() - lastInvite >= 30 * 60 * 1000) {
          try {
            const res = await api.get('/user-groups', token)
            const inv = res?.pending_invites ?? []
            if (inv.length > 0) {
              if (mounted) setPendingInvites(inv)
              eligible.push('invite')
            }
          } catch {}
        }

        if (
          'serviceWorker' in navigator && 'PushManager' in window &&
          typeof Notification !== 'undefined' &&
          Notification.permission !== 'denied' && Notification.permission !== 'granted' &&
          !isDismissed(PUSH_DISMISS_KEY)
        ) {
          try {
            const reg = await navigator.serviceWorker.getRegistration()
            const sub = await reg?.pushManager?.getSubscription()
            if (!sub) eligible.push('push')
          } catch {}
        }

        if (user && !user.whatsapp_opt_in && !user.whatsapp_prompted_at) eligible.push('whatsapp')
      }

      if (!mounted) return
      setQueue(POPUP_ORDER.filter(id => eligible.includes(id)))
    }

    const t = setTimeout(build, 700)
    return () => { mounted = false; clearTimeout(t) }
  }, [token])

  const active = queue[0] || null
  function advance() { setQueue(q => q.slice(1)) }

  // ── Handlers de fechamento (bookkeeping + avança a fila) ───────────────────
  function closeVersion() {
    if (versionData?.version) localStorage.setItem(SEEN_VERSION_KEY, versionData.version)
    advance()
  }

  function closeChampion() {
    localStorage.setItem(CHAMP_DISMISS_KEY, todayKey())
    advance()
  }

  function closePush() {
    dismiss(PUSH_DISMISS_KEY, 7)
    advance()
  }

  function closeCompetition() {
    if (competitionData?.id) localStorage.setItem(`predicts_comp_seen_${competitionData.id}`, '1')
    advance()
  }

  function closeInvite() {
    localStorage.setItem(INVITE_DISMISS_KEY, String(Date.now()))
    advance()
  }

  function closeWhatsapp() {
    advance()
  }

  // ── Render — só a fila[0], nunca dois de uma vez ──────────────────────────
  // Na página de boas-vindas nenhum popup entra na frente — o conteúdo é ela.
  if (pathname === '/bem-vindo') return null
  if (active === 'version' && versionData) return <VersionPopup version={versionData} onClose={closeVersion} />
  if (active === 'competition' && competitionData) return <CompetitionPopup competition={competitionData} onClose={closeCompetition} />
  if (active === 'champion')               return <ChampionPopup token={token} onClose={closeChampion} />
  if (active === 'invite' && pendingInvites.length > 0) return <InvitePopup invites={pendingInvites} token={token} onClose={closeInvite} />
  if (active === 'push')                   return <PushPromptPopup token={token} onClose={closePush} />
  if (active === 'whatsapp')               return <WhatsAppOptInPopup user={user} token={token} onDone={closeWhatsapp} />
  return null
}
