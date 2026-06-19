import { useState, useEffect } from 'react'

const BASE_URL = 'https://predicts.info'

const FEATURES = [
  { icon: '🎯', text: 'Aposte nos resultados e ganhe pontos' },
  { icon: '📊', text: 'Simule placares com estatísticas reais' },
  { icon: '🏅', text: 'Dispute o ranking com amigos e grupos privados' },
  { icon: '⚡', text: 'Acompanhe ao vivo e compare seus palpites' },
]

const SHARE_TARGETS = [
  {
    id: 'bolao',
    label: 'Plataforma',
    icon: '🎯',
    url: BASE_URL,
    waText: `🎯 *Predicts — Simulador de Bolão*\n\nFaça seus palpites, acumule pontos e dispute o ranking com amigos!\n\n🔗 ${BASE_URL}`,
    nativeTitle: 'Predicts — Simulador de Bolão',
    nativeText: 'Faça seus palpites, acumule pontos e dispute o ranking com amigos!',
  },
  {
    id: 'ranking',
    label: 'Ranking',
    icon: '🏅',
    url: `${BASE_URL}/ranking`,
    waText: `🏅 *Ranking do Bolão — Predicts*\n\nVeja quem está liderando! Participe e suba no ranking.\n\n🔗 ${BASE_URL}/ranking`,
    nativeTitle: 'Ranking — Predicts',
    nativeText: 'Veja quem está liderando! Participe e suba no ranking.',
  },
]

export default function ShareModal({ onClose }) {
  const [copied, setCopied] = useState(false)
  const [target, setTarget] = useState('bolao')

  const active = SHARE_TARGETS.find(t => t.id === target)

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  function copy() {
    navigator.clipboard.writeText(active.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(active.waText)}`, '_blank')
  }

  function shareNative() {
    if (!navigator.share) return
    navigator.share({ title: active.nativeTitle, text: active.nativeText, url: active.url }).catch(() => {})
  }

  const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 120ms ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: 20,
          width: '100%',
          maxWidth: 420,
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
          animation: 'slideUp 180ms cubic-bezier(.22,.9,.36,1)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Hero — fundo sólido escuro para garantir legibilidade */}
        <div style={{
          background: '#0a3d3b',
          padding: '28px 24px 20px',
          position: 'relative',
          textAlign: 'center',
        }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: 12, right: 12,
              background: 'rgba(255,255,255,0.12)', border: 'none',
              borderRadius: '50%', width: 30, height: 30,
              cursor: 'pointer', color: '#fff', fontSize: 16, lineHeight: '30px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>

          <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 10 }}>🎯</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#ffffff', letterSpacing: '0.08em' }}>
            PREDICTS
          </div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: '#8ecfcc', marginTop: 4, letterSpacing: '0.04em' }}>
            Simulador de bolão · Convide para jogar
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 20px 24px' }}>

          {/* Target tabs */}
          <div style={{
            display: 'flex', gap: 6, marginBottom: 18,
            background: 'var(--bg-overlay)', borderRadius: 10, padding: 3,
          }}>
            {SHARE_TARGETS.map(t => (
              <button
                key={t.id}
                onClick={() => { setTarget(t.id); setCopied(false) }}
                style={{
                  flex: 1, padding: '7px 6px', borderRadius: 8, border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  background: target === t.id ? 'var(--surface)' : 'transparent',
                  color: target === t.id ? 'var(--accent)' : 'var(--text-3)',
                  boxShadow: target === t.id ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                  transition: 'all .15s',
                }}
              >
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {/* Features (plataforma) */}
          {target === 'bolao' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {FEATURES.map(f => (
                <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 15, width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: 'var(--accent-dim)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {f.icon}
                  </span>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
                    {f.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Ranking description */}
          {target === 'ranking' && (
            <div style={{
              marginBottom: 18, padding: '12px 14px',
              background: 'var(--accent-dim)', borderRadius: 10,
              fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>🏅 O que será compartilhado</div>
              Link direto para o ranking público com pontuação geral, % de aproveitamento e placares exatos de todos os participantes.
            </div>
          )}

          {/* Copy link */}
          <div style={{
            display: 'flex', gap: 8, marginBottom: 10,
            background: 'var(--bg-overlay)', borderRadius: 10,
            padding: '8px 12px', alignItems: 'center',
          }}>
            <span style={{
              fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)',
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {active.url}
            </span>
            <button
              onClick={copy}
              style={{
                fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '5px 12px', borderRadius: 7, border: 'none',
                cursor: 'pointer', flexShrink: 0,
                background: copied ? 'var(--win)' : 'var(--accent)',
                color: '#fff',
                transition: 'background 200ms',
              }}
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>

          {/* Share buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={shareWhatsApp}
              style={{
                flex: 1, padding: '11px', borderRadius: 10, border: 'none',
                cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
                background: '#25D366', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                transition: 'opacity .15s',
              }}
              onMouseOver={e => e.currentTarget.style.opacity = '.85'}
              onMouseOut={e => e.currentTarget.style.opacity = '1'}
            >
              <WhatsAppIcon /> WhatsApp
            </button>

            {hasNativeShare ? (
              <button
                onClick={shareNative}
                style={{
                  flex: 1, padding: '11px', borderRadius: 10,
                  border: '1px solid var(--border)', cursor: 'pointer',
                  fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
                  background: 'transparent', color: 'var(--text-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  transition: 'background .15s',
                }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >
                <ShareIcon /> Mais opções
              </button>
            ) : (
              <button
                onClick={() => window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(active.waText)}`, '_blank')}
                style={{
                  flex: 1, padding: '11px', borderRadius: 10,
                  border: '1px solid var(--border)', cursor: 'pointer',
                  fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
                  background: 'transparent', color: 'var(--text-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  transition: 'background .15s',
                }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}
              >
                𝕏 Postar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  )
}
