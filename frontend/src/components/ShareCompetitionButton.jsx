import { useState } from 'react'

// Gera imagem 1080×1920 com identidade Predicts via Canvas
function buildShareImage(competition) {
  return new Promise(resolve => {
    const W = 1080, H = 1920
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')

    // ── Background gradient ─────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, W, H)
    bg.addColorStop(0,   '#040d18')
    bg.addColorStop(0.5, '#071525')
    bg.addColorStop(1,   '#040d18')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ── Grid lines (sutil) ──────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(15,122,120,0.07)'
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    // ── Glows circulares ────────────────────────────────────────────────────
    const glow1 = ctx.createRadialGradient(W/2, H*0.38, 0, W/2, H*0.38, 520)
    glow1.addColorStop(0,   'rgba(15,122,120,0.28)')
    glow1.addColorStop(0.5, 'rgba(15,122,120,0.08)')
    glow1.addColorStop(1,   'transparent')
    ctx.fillStyle = glow1; ctx.fillRect(0, 0, W, H)

    const glow2 = ctx.createRadialGradient(W/2, H*0.38, 0, W/2, H*0.38, 200)
    glow2.addColorStop(0,   'rgba(232,196,74,0.18)')
    glow2.addColorStop(1,   'transparent')
    ctx.fillStyle = glow2; ctx.fillRect(0, 0, W, H)

    // ── Linha teal horizontal superior ─────────────────────────────────────
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0)
    lineGrad.addColorStop(0,    'transparent')
    lineGrad.addColorStop(0.2,  '#0f7a78')
    lineGrad.addColorStop(0.8,  '#0f7a78')
    lineGrad.addColorStop(1,    'transparent')
    ctx.strokeStyle = lineGrad; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(0, 200); ctx.lineTo(W, 200); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, 204); ctx.lineTo(W, 204); ctx.stroke()

    // ── ⚡ Troféu central estilizado ────────────────────────────────────────
    ctx.save()
    ctx.translate(W/2, H*0.38)
    // círculo externo âmbar
    ctx.beginPath()
    ctx.arc(0, 0, 210, 0, Math.PI*2)
    ctx.strokeStyle = 'rgba(232,196,74,0.25)'
    ctx.lineWidth = 2; ctx.stroke()
    // círculo interno teal
    ctx.beginPath()
    ctx.arc(0, 0, 170, 0, Math.PI*2)
    ctx.strokeStyle = 'rgba(15,122,120,0.35)'
    ctx.lineWidth = 1.5; ctx.stroke()
    // ⚡ emoji grande
    ctx.font = '240px serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('⚡', 0, 10)
    ctx.restore()

    // ── PREDICTS ─────────────────────────────────────────────────────────
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    // sombra glow
    ctx.shadowColor = '#0f7a78'
    ctx.shadowBlur  = 40
    ctx.fillStyle   = '#ffffff'
    ctx.font        = `bold 148px 'Arial Black', Arial, sans-serif`
    ctx.letterSpacing = '16px'
    ctx.fillText('PREDICTS', W/2, H*0.62)
    ctx.shadowBlur = 0

    // ── .info ──────────────────────────────────────────────────────────────
    ctx.fillStyle = '#0f7a78'
    ctx.font      = `bold 64px 'Arial Black', Arial, sans-serif`
    ctx.fillText('.info', W/2 + 92, H*0.62)

    // ── Linha âmbar separadora ─────────────────────────────────────────────
    const sep = ctx.createLinearGradient(0, 0, W, 0)
    sep.addColorStop(0,   'transparent')
    sep.addColorStop(0.25, '#e8c44a')
    sep.addColorStop(0.75, '#e8c44a')
    sep.addColorStop(1,   'transparent')
    ctx.strokeStyle = sep; ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(W*0.15, H*0.655); ctx.lineTo(W*0.85, H*0.655)
    ctx.stroke()

    // ── Nome da competição ─────────────────────────────────────────────────
    const compName = (competition?.name || 'Fase Eliminatória — Copa 2026').toUpperCase()
    ctx.fillStyle = '#e8c44a'
    ctx.font      = `bold 58px 'Arial Black', Arial, sans-serif`
    // quebra de linha se muito longo
    const words = compName.split(' ')
    let line1 = '', line2 = ''
    let mid = Math.ceil(words.length / 2)
    line1 = words.slice(0, mid).join(' ')
    line2 = words.slice(mid).join(' ')
    if (compName.length <= 28) { line1 = compName; line2 = '' }
    ctx.fillText(line1, W/2, H*0.705)
    if (line2) ctx.fillText(line2, W/2, H*0.755)

    // ── Tagline ────────────────────────────────────────────────────────────
    const tagY = line2 ? H*0.81 : H*0.775
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font      = `500 42px Arial, sans-serif`
    ctx.fillText('Pontuação zerada — todos no mesmo ponto', W/2, tagY)

    // ── Convidar ───────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font      = `400 38px Arial, sans-serif`
    ctx.fillText('Faça seus palpites e dispute o ranking!', W/2, tagY + 64)

    // ── Linha teal inferior ────────────────────────────────────────────────
    ctx.strokeStyle = lineGrad; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(0, H - 196); ctx.lineTo(W, H - 196); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, H - 200); ctx.lineTo(W, H - 200); ctx.stroke()

    // ── URL ────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#0f7a78'
    ctx.font      = `bold 52px 'Arial Black', Arial, sans-serif`
    ctx.fillText('predicts.info', W/2, H - 116)

    // ── Copa 2026 ──────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.2)'
    ctx.font      = `400 36px Arial, sans-serif`
    ctx.fillText('Copa do Mundo FIFA 2026', W/2, H - 64)

    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.93)
  })
}

export default function ShareCompetitionButton({ competition, size = 'md' }) {
  const [state, setState] = useState('idle')

  const canShare = typeof navigator !== 'undefined' && !!navigator.share
  const GOLD = '#e8c44a'

  async function handleShare() {
    setState('loading')
    const shareText  = `⚡ ${competition?.name || 'Fase Eliminatória — Copa 2026'}\n\nNova competição no Predicts! Pontuação zerada — todos no mesmo ponto.\n\nFaça seus palpites: https://predicts.info`
    const shareTitle = `⚡ ${competition?.name || 'Fase Eliminatória'} — Predicts.info`

    try {
      // delay proposital para manter sensação de "gerando"
      const [blob] = await Promise.all([
        buildShareImage(competition),
        new Promise(r => setTimeout(r, 1400)),
      ])
      const file = new File([blob], 'predicts-copa-2026.jpg', { type: 'image/jpeg' })

      if (canShare && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle, text: shareText })
        setState('done')
      } else if (canShare) {
        await navigator.share({ title: shareTitle, text: shareText, url: 'https://predicts.info' })
        setState('done')
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'predicts-copa-2026.jpg'
        a.click()
        URL.revokeObjectURL(a.href)
        setState('download')
      }
    } catch (e) {
      if (e?.name !== 'AbortError') setState('error')
      else setState('idle')
      return
    }
    setTimeout(() => setState('idle'), 3000)
  }

  const pad = size === 'sm' ? '9px 14px' : '13px 0'
  const fs  = size === 'sm' ? 13 : 15

  const label = state === 'loading'  ? '⚡ Criando arte…'
    : state === 'done'     ? '✓ Compartilhado!'
    : state === 'download' ? '✓ Imagem salva — abra no IG!'
    : state === 'error'    ? '⚠ Erro — tente novamente'
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
        color: GOLD, fontFamily: 'var(--font-cond)', fontSize: fs, fontWeight: 700,
        cursor: state === 'loading' ? 'not-allowed' : 'pointer',
        opacity: state === 'loading' ? 0.75 : 1,
        transition: 'all .2s', letterSpacing: '0.02em',
      }}
    >
      {label}
    </button>
  )
}
