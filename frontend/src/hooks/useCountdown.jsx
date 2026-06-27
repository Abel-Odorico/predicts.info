import { useState, useEffect } from 'react'

export function useCountdown(targetDate) {
  const [timeLeft, setTimeLeft] = useState(null)

  useEffect(() => {
    if (!targetDate) return
    const target = new Date(
      targetDate.endsWith('Z') ? targetDate : targetDate + 'Z'
    ).getTime()

    function calc() {
      const diff = target - Date.now()
      if (diff <= 0) { setTimeLeft({ started: true }); return }
      const s = Math.floor(diff / 1000)
      setTimeLeft({
        started: false,
        days:  Math.floor(s / 86400),
        hours: Math.floor((s % 86400) / 3600),
        mins:  Math.floor((s % 3600) / 60),
        secs:  s % 60,
      })
    }

    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [targetDate])

  return timeLeft
}

export function CountdownDisplay({ timeLeft, style = {} }) {
  if (!timeLeft || timeLeft.started) return null
  const { days, hours, mins, secs } = timeLeft
  const pad = n => String(n).padStart(2, '0')

  const parts = days > 0
    ? [`${days}d`, `${pad(hours)}h`, `${pad(mins)}m`]
    : [`${pad(hours)}h`, `${pad(mins)}m`, `${pad(secs)}s`]

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', ...style }}>
      {parts.map((p, i) => (
        <span key={i} style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
          color: '#e8c44a', background: 'rgba(232,196,74,0.12)',
          borderRadius: 5, padding: '2px 6px', letterSpacing: '0.04em',
        }}>{p}</span>
      ))}
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
        para começar
      </span>
    </div>
  )
}
