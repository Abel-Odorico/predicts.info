/**
 * AppPopups — Central de Popups do Predicts.info
 *
 * Registro de popups (ordem de prioridade):
 * ┌─────────────────┬──────────┬──────────────────────────────────────────┐
 * │ ID              │ Delay    │ Condição                                 │
 * ├─────────────────┼──────────┼──────────────────────────────────────────┤
 * │ version         │ 0.8s     │ Nova versão não vista                    │
 * │ champion        │ 0.8s     │ Logado + prazo aberto + pick incompleto  │
 * │ install_app     │ 20s      │ Não está em modo standalone (PWA)        │
 * │ push_prompt     │ 12s      │ Logado + PWA + sem subscription push     │
 * └─────────────────┴──────────┴──────────────────────────────────────────┘
 *
 * Regra: só um popup por vez. Ao fechar, orquestrador passa para o próximo
 * da fila que ainda não foi exibido nessa sessão.
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
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
function ModalShell({ onClose, children, maxWidth = 460, zIndex = 9500 }) {
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
        position: 'fixed', inset: 0, zIndex,
        background: 'rgba(3,8,14,0.75)', backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in-1"
        style={{
          width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
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

// ── Shared: BottomSheet (mobile-friendly) ─────────────────────────────────────
function BottomSheet({ onClose, children, zIndex = 9400 }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex,
        background: 'rgba(3,8,14,0.72)', backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: '0 0 env(safe-area-inset-bottom, 16px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in-1"
        style={{
          width: '100%', maxWidth: 440,
          background: 'var(--bg-surface)', border: '1.5px solid var(--border)',
          borderRadius: '16px 16px 0 0', padding: '20px 20px 24px',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
        }}
      >
        {/* drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />
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
    { icon: '🌐', text: 'Abra predicts.info no Chrome (Android)' },
    { icon: '⋮',  text: 'Toque no menu ⋮ no canto superior direito' },
    { icon: '📲', text: 'Selecione "Instalar app" ou "Adicionar à tela inicial"' },
    { icon: '✅', text: 'Confirme — o ícone aparece na sua tela inicial' },
    { icon: '🔔', text: 'Abra o app e aceite as notificações para não perder nada' },
  ],
  ios: [
    { icon: '🧭', text: 'Abra predicts.info no Safari (não Chrome nem Firefox)' },
    { icon: '⎙',  text: 'Toque em Compartilhar ⎙ na barra inferior do Safari' },
    { icon: '📲', text: 'Role para baixo e toque "Adicionar à Tela de Início"' },
    { icon: '✅', text: 'Toque "Adicionar" — o ícone aparece na sua tela inicial' },
    { icon: '🔔', text: 'Abra o app instalado e aceite as notificações' },
  ],
}

export function InstallAppPopup({ onClose }) {
  const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isAndroid = /android/i.test(navigator.userAgent)
  const [platform, setPlatform] = useState(isIOS ? 'ios' : 'android')

  const steps = INSTALL_STEPS[platform]

  return (
    <ModalShell onClose={onClose} maxWidth={480} zIndex={9300}>
      <div style={{ padding: '28px 24px 22px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>📲</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-1)', margin: '0 0 6px', letterSpacing: '0.03em' }}>
            Instale o app grátis
          </h2>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
            Acesso rápido, notificações de jogos e resultados, funciona offline.
          </p>
        </div>

        {/* Platform tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: 'var(--bg-overlay)', borderRadius: 10, padding: 4 }}>
          {[
            { id: 'android', label: '🤖 Android', sub: 'Chrome' },
            { id: 'ios',     label: '🍎 iPhone / iPad', sub: 'Safari' },
          ].map(p => (
            <button
              key={p.id}
              onClick={() => setPlatform(p.id)}
              style={{
                flex: 1, padding: '8px 6px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: platform === p.id ? 'var(--bg-card)' : 'transparent',
                boxShadow: platform === p.id ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                transition: 'all 150ms',
              }}
            >
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: platform === p.id ? 'var(--text-1)' : 'var(--text-4)' }}>
                {p.label}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: platform === p.id ? 'var(--accent)' : 'var(--text-4)', marginTop: 1 }}>
                {p.sub}
              </div>
            </button>
          ))}
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: 10,
                background: i === steps.length - 1 ? 'rgba(15,122,120,0.12)' : 'var(--bg-surface)',
                border: `1.5px solid ${i === steps.length - 1 ? 'rgba(15,122,120,0.3)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: s.icon === '⋮' || s.icon === '⎙' ? 18 : 16,
                fontFamily: 'monospace', fontWeight: 700,
                color: i === steps.length - 1 ? 'var(--accent)' : 'var(--text-2)',
              }}>
                {s.icon}
              </div>
              <div style={{ paddingTop: 6 }}>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.4 }}>
                  {s.text}
                </div>
                {i === 1 && platform === 'ios' && (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>
                    Se não aparecer, role a lista de opções para baixo
                  </div>
                )}
                {i === 1 && platform === 'android' && (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>
                    Nos três pontinhos no topo — pode aparecer como "Instalar app"
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Notification tip */}
        <div style={{
          background: 'rgba(15,122,120,0.07)', border: '1px solid rgba(15,122,120,0.2)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 18,
        }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>
            🔔 Por que ativar notificações?
          </div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Resultado das suas apostas em tempo real · Lembrete antes do jogo começar · Sua posição no ranking atualizada
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: 'var(--accent)', color: '#fff',
              fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
            }}
          >
            Já instalei! ✓
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '11px 18px', borderRadius: 9, border: '1px solid var(--border)',
              background: 'var(--bg-overlay)', color: 'var(--text-3)', cursor: 'pointer',
              fontFamily: 'var(--font-cond)', fontSize: 13,
            }}
          >
            Depois
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
    <BottomSheet onClose={onClose} zIndex={9400}>
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
    <ModalShell onClose={onClose} maxWidth={460} zIndex={9600}>
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
// ORQUESTRADOR — controla qual popup aparece e em que ordem
// ═════════════════════════════════════════════════════════════════════════════
export default function AppPopups() {
  const { token } = useAuth()
  const [active, setActive] = useState(null)
  const [versionData, setVersionData] = useState(null)
  const [competitionData, setCompetitionData] = useState(null)
  const [pendingInvites, setPendingInvites] = useState([])

  // ── 0: Competition popup (3s, uma vez por competition.id) ────────────────
  useEffect(() => {
    let mounted = true
    const t = setTimeout(async () => {
      try {
        const c = await api.get('/competition/active')
        if (!mounted || !c?.id) return
        const key = `predicts_comp_seen_${c.id}`
        if (localStorage.getItem(key)) return
        setCompetitionData(c)
        setActive(prev => prev === null ? 'competition' : prev)
      } catch {}
    }, 3000)
    return () => { mounted = false; clearTimeout(t) }
  }, [])

  // ── 1 & 2: Version → Champion (800ms, logado) ─────────────────────────────
  useEffect(() => {
    let mounted = true
    async function decide() {
      try {
        const v = await api.get('/version/latest')
        if (mounted && v?.version && localStorage.getItem(SEEN_VERSION_KEY) !== v.version) {
          localStorage.setItem(SEEN_VERSION_KEY, v.version)  // marca como visto imediatamente
          setVersionData(v); setActive('version'); return
        }
      } catch {}
      if (!token) return
      if (CHAMP_DEADLINE - Date.now() <= 0) return
      if (localStorage.getItem(CHAMP_DISMISS_KEY) === todayKey()) return
      try {
        const pick = await api.get('/champion/pick', token)
        if (mounted && (!pick?.champion || !pick?.runner_up)) setActive('champion')
      } catch { if (mounted) setActive('champion') }
    }
    const t = setTimeout(decide, 800)
    return () => { mounted = false; clearTimeout(t) }
  }, [token])

  // ── 2.5: Invite popup (7s, logado, convites pendentes, 30min dismiss) ───
  useEffect(() => {
    if (!token) return
    const last = parseInt(localStorage.getItem(INVITE_DISMISS_KEY) || '0', 10)
    if (Date.now() - last < 30 * 60 * 1000) return
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/user-groups', token)
        const inv = res?.pending_invites ?? []
        if (inv.length > 0) {
          setPendingInvites(inv)
          setActive(prev => prev === null ? 'invite' : prev)
        }
      } catch {}
    }, 7000)
    return () => clearTimeout(t)
  }, [token])

  // ── 3: Push prompt (12s, logado, PWA, sem subscription) ──────────────────
  useEffect(() => {
    if (!token) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'denied' || Notification.permission === 'granted') return
    if (isDismissed(PUSH_DISMISS_KEY)) return
    const t = setTimeout(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = await reg?.pushManager?.getSubscription()
        if (!sub) setActive(prev => prev === null ? 'push' : prev)
      } catch {}
    }, 12000)
    return () => clearTimeout(t)
  }, [token])

  // ── Handlers de fechamento ─────────────────────────────────────────────────
  function closeVersion() {
    if (versionData?.version) localStorage.setItem(SEEN_VERSION_KEY, versionData.version)
    setActive(null)
    setTimeout(() => {
      if (!token || CHAMP_DEADLINE - Date.now() <= 0) return
      if (localStorage.getItem(CHAMP_DISMISS_KEY) === todayKey()) return
      api.get('/champion/pick', token)
        .then(p => { if (!p?.champion || !p?.runner_up) setActive('champion') })
        .catch(() => setActive('champion'))
    }, 400)
  }

  function closeChampion() {
    localStorage.setItem(CHAMP_DISMISS_KEY, todayKey())
    setActive(null)
  }

  function closePush() {
    dismiss(PUSH_DISMISS_KEY, 7)
    setActive(null)
  }

  function closeCompetition() {
    if (competitionData?.id) localStorage.setItem(`predicts_comp_seen_${competitionData.id}`, '1')
    setActive(null)
  }

  function closeInvite() {
    localStorage.setItem(INVITE_DISMISS_KEY, String(Date.now()))
    setActive(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (active === 'competition' && competitionData) return <CompetitionPopup competition={competitionData} onClose={closeCompetition} />
  if (active === 'version' && versionData) return <VersionPopup version={versionData} onClose={closeVersion} />
  if (active === 'champion')               return <ChampionPopup token={token} onClose={closeChampion} />
  if (active === 'invite' && pendingInvites.length > 0) return <InvitePopup invites={pendingInvites} token={token} onClose={closeInvite} />
  if (active === 'push')                   return <PushPromptPopup token={token} onClose={closePush} />
  return null
}
