import { useState } from 'react'

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt'

function buildImageUrl(competitionId) {
  const prompt = encodeURIComponent(
    'FIFA World Cup 2026 knockout elimination phase, epic dramatic stadium night, ' +
    'golden glowing trophy center stage, fireworks exploding, massive crowd cheering, ' +
    'neon electric atmosphere, champions confetti, cinematic ultra wide, ' +
    'professional sports poster design, deep navy and gold color palette, ' +
    'photorealistic 8k, Instagram story format'
  )
  return `${POLLINATIONS_BASE}/${prompt}?width=1080&height=1920&nologo=true&seed=${1000 + (competitionId || 1)}&model=flux`
}

async function fetchImageAsFile(url, filename) {
  const res  = await fetch(url)
  const blob = await res.blob()
  return new File([blob], filename, { type: blob.type || 'image/jpeg' })
}

export default function ShareCompetitionButton({ competition, size = 'md' }) {
  const [state, setState] = useState('idle') // idle | loading | done | error | download

  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  async function handleShare() {
    setState('loading')
    const imageUrl = buildImageUrl(competition?.id)
    const shareText = `⚡ ${competition?.name || 'Fase Eliminatória — Copa 2026'}\n\nNova competição no Predicts! Pontuação zerada — todos no mesmo ponto.\n\nFaça seus palpites: https://predicts.info`
    const shareTitle = `⚡ ${competition?.name || 'Fase Eliminatória'} — Predicts.info`

    try {
      const file = await fetchImageAsFile(imageUrl, 'predicts-fase-eliminatoria.jpg')

      if (canShare && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle, text: shareText })
        setState('done')
        setTimeout(() => setState('idle'), 3000)
      } else if (canShare) {
        // share sem arquivo (texto + url)
        await navigator.share({ title: shareTitle, text: shareText, url: 'https://predicts.info' })
        setState('done')
        setTimeout(() => setState('idle'), 3000)
      } else {
        // desktop fallback: download da imagem
        const a = document.createElement('a')
        a.href = URL.createObjectURL(file)
        a.download = 'predicts-fase-eliminatoria.jpg'
        a.click()
        URL.revokeObjectURL(a.href)
        setState('download')
        setTimeout(() => setState('idle'), 4000)
      }
    } catch (e) {
      if (e?.name === 'AbortError') { setState('idle'); return }
      // fallback: abre imagem direto para salvar
      window.open(imageUrl, '_blank')
      setState('idle')
    }
  }

  const pad  = size === 'sm' ? '9px 14px' : '13px 0'
  const fs   = size === 'sm' ? 13 : 15
  const GOLD = '#e8c44a'

  const label = state === 'loading' ? '⏳ Gerando imagem…'
    : state === 'done'     ? '✓ Compartilhado!'
    : state === 'download' ? '✓ Imagem salva — abra no IG!'
    : '📸 Compartilhar no Instagram'

  return (
    <button
      onClick={handleShare}
      disabled={state === 'loading'}
      style={{
        width: '100%', padding: pad, borderRadius: 10, border: `1.5px solid ${GOLD}`,
        background: state === 'done' || state === 'download'
          ? 'rgba(232,196,74,0.15)'
          : 'linear-gradient(135deg,rgba(232,196,74,0.18) 0%,rgba(232,196,74,0.06) 100%)',
        color: state === 'done' || state === 'download' ? GOLD : GOLD,
        fontFamily: 'var(--font-cond)', fontSize: fs, fontWeight: 700,
        cursor: state === 'loading' ? 'not-allowed' : 'pointer',
        opacity: state === 'loading' ? 0.7 : 1,
        transition: 'all .2s',
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </button>
  )
}
