import { useState } from 'react'
import { createPortal } from 'react-dom'

const STEPS = [
  {
    icon: '🏆',
    title: 'Bem-vindo ao Predicts!',
    body: 'O simulador estatístico da Copa do Mundo 2026. Faça seus palpites e dispute com amigos.',
    cta: 'Próximo',
  },
  {
    icon: '🎯',
    title: 'Como funciona',
    body: 'Aposte no placar de cada jogo antes de começar. Placar exato = 10 pts. Resultado correto = 5 pts.',
    cta: 'Próximo',
  },
  {
    icon: '👥',
    title: 'Bolões Privados',
    body: 'Crie ou entre em um grupo privado para disputar com seus amigos e ver um ranking separado.',
    cta: 'Começar!',
  },
]

export default function Onboarding({ onClose }) {
  const [step, setStep] = useState(0)
  const [animDir, setAnimDir] = useState('in')

  function next() {
    if (step < STEPS.length - 1) {
      setAnimDir('out')
      setTimeout(() => { setStep(s => s + 1); setAnimDir('in') }, 200)
    } else {
      onClose()
    }
  }

  const s = STEPS[step]

  return createPortal(
    <div className="onboarding-overlay" onClick={onClose}>
      <div className="onboarding-card" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
        <button
          onClick={onClose}
          aria-label="Fechar"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2,
            width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--bg-overlay)', color: 'var(--text-2)', fontSize: 16, lineHeight: 1,
          }}
        >×</button>
        <div className={`onboarding-step onboarding-step--${animDir}`}>
          <div className="onboarding-step__icon">{s.icon}</div>
          <div className="onboarding-step__title">{s.title}</div>
          <div className="onboarding-step__body">{s.body}</div>
        </div>
        <div className="onboarding-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`onboarding-dot${i === step ? ' onboarding-dot--active' : ''}`} />
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: '100%', fontFamily: 'var(--font-display)', fontWeight: 900, letterSpacing: '0.08em' }} onClick={next}>
          {s.cta}
        </button>
        {step < STEPS.length - 1 && (
          <button
            onClick={onClose}
            style={{ marginTop: 'var(--s3)', width: '100%', background: 'none', border: 'none', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 12, cursor: 'pointer', letterSpacing: '0.06em' }}
          >
            Pular
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
