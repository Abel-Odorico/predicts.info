import { useId } from 'react'

const GRADIENTS = {
  1: { from: '#f5c542', to: '#b8860b', ribbon: '#c9412f' },
  2: { from: '#d9dde3', to: '#8a919c', ribbon: '#3d6fb0' },
  3: { from: '#d9945a', to: '#8c5a2b', ribbon: '#3d6fb0' },
}

// Medalha metálica em SVG: fita + disco com gradiente por rank + brilho sutil.
// `useId` garante ids de gradiente únicos por instância (evita colisão ao
// renderizar várias medalhas na mesma tela — pódio, mini top-3, lista).
export default function MedalIcon({ rank = 1, size = 24, showNumber = false, className }) {
  const uid = useId()
  const g = GRADIENTS[rank] || GRADIENTS[3]
  const gradId = `medal-grad-${rank}-${uid}`
  const shineId = `medal-shine-${rank}-${uid}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      role="img"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={g.from} />
          <stop offset="100%" stopColor={g.to} />
        </linearGradient>
        <radialGradient id={shineId} cx="35%" cy="30%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Fita */}
      <path d="M8 2 L11.2 11 L8.6 12.6 L5 3.4 Z" fill={g.ribbon} />
      <path d="M16 2 L12.8 11 L15.4 12.6 L19 3.4 Z" fill={g.ribbon} />

      {/* Disco */}
      <circle cx="12" cy="14.5" r="7.5" fill={`url(#${gradId})`} stroke={g.to} strokeWidth="0.6" />
      <circle cx="12" cy="14.5" r="7.5" fill={`url(#${shineId})`} />
      <circle cx="12" cy="14.5" r="5.6" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.6" />

      {showNumber && (
        <text
          x="12"
          y="17.3"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          fill="#ffffff"
          fillOpacity="0.92"
          style={{ fontFamily: 'var(--font-data)' }}
        >
          {rank}
        </text>
      )}
    </svg>
  )
}
