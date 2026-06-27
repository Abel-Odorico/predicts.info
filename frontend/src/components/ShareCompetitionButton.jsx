import { useState } from 'react'

const TEAL  = '#0f7a78'
const AMBER = '#e8c44a'
const NAVY  = '#040d18'
const WHITE = '#ffffff'
const MARGIN = 80  // margem lateral segura

function buildShareImage(competition) {
  return new Promise(resolve => {
    const W = 1080, H = 1920
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')

    // ── Background ──────────────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0,   '#020a12')
    bg.addColorStop(0.4, '#071525')
    bg.addColorStop(1,   '#020a12')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // ── Grid sutil ──────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(15,122,120,0.06)'
    ctx.lineWidth = 1
    for (let x = 0; x <= W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y <= H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    // ── Glow teal central ───────────────────────────────────────────────────
    const CX = W / 2, CY = H * 0.35
    const g1 = ctx.createRadialGradient(CX, CY, 0, CX, CY, 500)
    g1.addColorStop(0,   'rgba(15,122,120,0.30)')
    g1.addColorStop(0.6, 'rgba(15,122,120,0.07)')
    g1.addColorStop(1,   'transparent')
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H)

    // ── Glow âmbar menor ────────────────────────────────────────────────────
    const g2 = ctx.createRadialGradient(CX, CY, 0, CX, CY, 180)
    g2.addColorStop(0,   'rgba(232,196,74,0.20)')
    g2.addColorStop(1,   'transparent')
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H)

    // ── Linhas teal superior ────────────────────────────────────────────────
    const hLine = ctx.createLinearGradient(0, 0, W, 0)
    hLine.addColorStop(0,    'transparent')
    hLine.addColorStop(0.15, TEAL)
    hLine.addColorStop(0.85, TEAL)
    hLine.addColorStop(1,    'transparent')
    ctx.strokeStyle = hLine
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(0, 190); ctx.lineTo(W, 190); ctx.stroke()
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.4
    ctx.beginPath(); ctx.moveTo(0, 195); ctx.lineTo(W, 195); ctx.stroke()
    ctx.globalAlpha = 1

    // ── Texto topo: COPA DO MUNDO 2026 ──────────────────────────────────────
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.font = `500 36px Arial, sans-serif`
    ctx.fillText('COPA DO MUNDO FIFA 2026', W / 2, 140)

    // ── Círculos decorativos ─────────────────────────────────────────────────
    ctx.save()
    ctx.translate(CX, CY)
    ctx.beginPath(); ctx.arc(0, 0, 230, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(232,196,74,0.20)`; ctx.lineWidth = 2; ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 0, 185, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(15,122,120,0.30)`; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 0, 140, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(232,196,74,0.12)`; ctx.lineWidth = 1; ctx.stroke()

    // ⚡ emoji
    ctx.font = '220px Arial, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('⚡', 0, 8)
    ctx.restore()

    // ── PREDICTS em linha separada de .info ─────────────────────────────────
    const PRED_Y = H * 0.59
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'

    // sombra
    ctx.shadowColor = TEAL
    ctx.shadowBlur  = 50
    ctx.fillStyle   = WHITE
    ctx.font        = `900 150px Arial Black, Arial, sans-serif`
    ctx.fillText('PREDICTS', W / 2, PRED_Y)
    ctx.shadowBlur = 0

    // .info — linha separada, menor, centralizada
    ctx.fillStyle = TEAL
    ctx.font      = `700 70px Arial Black, Arial, sans-serif`
    ctx.fillText('.info', W / 2, PRED_Y + 88)

    // ── Separador âmbar ──────────────────────────────────────────────────────
    const SEP_Y = PRED_Y + 130
    const sep = ctx.createLinearGradient(0, 0, W, 0)
    sep.addColorStop(0,    'transparent')
    sep.addColorStop(0.20, AMBER)
    sep.addColorStop(0.80, AMBER)
    sep.addColorStop(1,    'transparent')
    ctx.strokeStyle = sep
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(0, SEP_Y); ctx.lineTo(W, SEP_Y); ctx.stroke()
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, SEP_Y + 5); ctx.lineTo(W, SEP_Y + 5); ctx.stroke()
    ctx.globalAlpha = 1

    // ── Nome da competição ────────────────────────────────────────────────────
    const compName = (competition?.name || 'Fase Eliminatória — Copa 2026').toUpperCase()
    ctx.fillStyle = AMBER
    ctx.font      = `700 62px Arial Black, Arial, sans-serif`
    ctx.textAlign = 'center'

    // quebra segura
    const maxW = W - MARGIN * 2
    const words = compName.split(' ')
    const lines = []
    let cur = ''
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur); cur = w
      } else { cur = test }
    }
    if (cur) lines.push(cur)

    const LINE_H = 78
    const blockH  = lines.length * LINE_H
    let compY     = SEP_Y + 60 + LINE_H / 2
    for (const line of lines) {
      ctx.fillText(line, W / 2, compY)
      compY += LINE_H
    }

    // ── Taglines ─────────────────────────────────────────────────────────────
    const TAG_Y = SEP_Y + 60 + blockH + 50
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.font      = `400 40px Arial, sans-serif`
    ctx.fillText('Pontuação zerada — todos partem do mesmo ponto.', W / 2, TAG_Y)
    ctx.fillStyle = 'rgba(255,255,255,0.42)'
    ctx.font      = `400 36px Arial, sans-serif`
    ctx.fillText('Entre agora e dispute o ranking!', W / 2, TAG_Y + 58)

    // ── Linhas teal inferior ─────────────────────────────────────────────────
    ctx.strokeStyle = hLine
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(0, H - 180); ctx.lineTo(W, H - 180); ctx.stroke()
    ctx.globalAlpha = 0.4
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, H - 175); ctx.lineTo(W, H - 175); ctx.stroke()
    ctx.globalAlpha = 1

    // ── URL ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = TEAL
    ctx.font      = `700 56px Arial Black, Arial, sans-serif`
    ctx.fillText('predicts.info', W / 2, H - 108)

    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.font      = `400 34px Arial, sans-serif`
    ctx.fillText('Simulador Estatístico · Bolão · Ranking ao vivo', W / 2, H - 58)

    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.93)
  })
}

export default function ShareCompetitionButton({ competition, size = 'md' }) {
  const [state, setState] = useState('idle')
  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  async function handleShare() {
    setState('loading')
    const shareText  = `⚡ ${competition?.name || 'Fase Eliminatória — Copa 2026'}\n\nNova fase! Pontuação zerada — todos partem do mesmo ponto.\n\nFaça seus palpites: https://predicts.info`
    const shareTitle = `⚡ ${competition?.name || 'Fase Eliminatória'} — Predicts.info`

    try {
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
    : state === 'download' ? '✓ Imagem salva — poste no IG!'
    : state === 'error'    ? '⚠ Tente novamente'
    : '📸 Compartilhar no Instagram'

  return (
    <button
      onClick={handleShare}
      disabled={state === 'loading'}
      style={{
        width: '100%', padding: pad, borderRadius: 10,
        border: `1.5px solid ${AMBER}`,
        background: state === 'done' || state === 'download'
          ? 'rgba(232,196,74,0.15)'
          : 'linear-gradient(135deg,rgba(232,196,74,0.18) 0%,rgba(232,196,74,0.06) 100%)',
        color: AMBER, fontFamily: 'var(--font-cond)', fontSize: fs, fontWeight: 700,
        cursor: state === 'loading' ? 'not-allowed' : 'pointer',
        opacity: state === 'loading' ? 0.75 : 1,
        transition: 'all .2s', letterSpacing: '0.02em',
      }}
    >
      {label}
    </button>
  )
}
