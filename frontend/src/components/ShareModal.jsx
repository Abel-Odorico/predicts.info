import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { api } from '../api'

const BASE_URL = 'https://predicts.info'

const SHARE_TARGETS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '⚽',
    url: `${BASE_URL}/dashboard`,
    waText: `⚽ *Predicts — Bolão Copa 2026*\n\nFaça seus palpites, acumule pontos e dispute o ranking com amigos!\n\n🔗 ${BASE_URL}/dashboard`,
    nativeTitle: 'Predicts — Bolão Copa 2026',
    nativeText: 'Faça seus palpites, acumule pontos e dispute o ranking!',
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

async function drawRankingCanvas(ranking, title) {
  const W = 520, ROW = 52, HEADER = 128, FOOTER = 50
  const top = ranking.slice(0, 10)
  const H = HEADER + top.length * ROW + FOOTER
  const canvas = document.createElement('canvas')
  canvas.width = W * 2
  canvas.height = H * 2
  const ctx = canvas.getContext('2d')
  ctx.scale(2, 2)
  ctx.fillStyle = '#0d1b2a'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#0a3d3b'; ctx.fillRect(0, 0, W, HEADER)
  ctx.fillStyle = '#0f7a78'; ctx.fillRect(0, 0, W, 4)
  ctx.font = 'bold 30px Arial, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'
  ctx.fillText('PREDICTS', W / 2, 48)
  ctx.font = '13px Arial, sans-serif'; ctx.fillStyle = '#8ecfcc'
  ctx.fillText('Bolão Copa 2026 · predicts.info', W / 2, 70)
  ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(40, 82, W - 80, 1)
  ctx.font = 'bold 14px Arial, sans-serif'; ctx.fillStyle = '#0f7a78'
  ctx.fillText(title.toUpperCase(), W / 2, 110)
  top.forEach((r, i) => {
    const y = HEADER + i * ROW
    const barColor = i === 0 ? '#d4af37' : i === 1 ? '#9e9e9e' : i === 2 ? '#0f7a78' : null
    if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(0, y, W, ROW) }
    if (i === 0) { ctx.fillStyle = 'rgba(212,175,55,0.07)'; ctx.fillRect(0, y, W, ROW) }
    if (barColor) { ctx.fillStyle = barColor; ctx.fillRect(0, y, 4, ROW) }
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, y + ROW - 1, W, 1)
    ctx.textAlign = 'center'
    const posLabel = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1)
    ctx.font = i < 3 ? 'bold 18px Arial, sans-serif' : 'bold 13px Arial, sans-serif'
    ctx.fillStyle = barColor || '#6b7280'
    ctx.fillText(posLabel, 30, y + ROW / 2 + 6)
    ctx.font = i < 3 ? 'bold 14px Arial, sans-serif' : '13px Arial, sans-serif'
    ctx.fillStyle = i < 3 ? '#f1f5f9' : '#cbd5e1'; ctx.textAlign = 'left'
    let name = r.name
    while (ctx.measureText(name).width > 320 && name.length > 3) name = name.slice(0, -1)
    if (name !== r.name) name += '…'
    ctx.fillText(name, 62, y + ROW / 2 + 5)
    ctx.textAlign = 'right'
    ctx.font = i < 3 ? 'bold 18px Arial, sans-serif' : 'bold 15px Arial, sans-serif'
    ctx.fillStyle = '#0f7a78'
    ctx.fillText(`${r.total_points} pts`, W - 18, y + ROW / 2 + 6)
  })
  const footerY = HEADER + top.length * ROW
  ctx.fillStyle = '#060f18'; ctx.fillRect(0, footerY, W, FOOTER)
  ctx.fillStyle = '#0f7a78'; ctx.fillRect(0, footerY, W, 1)
  ctx.font = '12px Arial, sans-serif'; ctx.fillStyle = '#4a6070'; ctx.textAlign = 'center'
  const now = new Date()
  ctx.fillText(`predicts.info · ${now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}`, W / 2, footerY + FOOTER / 2 + 4)
  return canvas.toDataURL('image/png')
}

function openExternal(url) {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export default function ShareModal({ onClose, token }) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  const [target, setTarget] = useState('dashboard')
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [qrExpanded, setQrExpanded] = useState(false)

  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [waLink, setWaLink] = useState('')

  const [groups, setGroups] = useState([])
  const [imgSource, setImgSource] = useState('geral')
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [imgDataUrl, setImgDataUrl] = useState(null)
  const [generatingImg, setGeneratingImg] = useState(false)
  const [imgError, setImgError] = useState('')

  const active = SHARE_TARGETS.find(t => t.id === target)

  // Absorve ghost click: o mesmo toque que abriu o modal propagaria e fecharia o backdrop.
  // Com backdropReady=false o handler para o evento sem fechar o modal.
  const [backdropReady, setBackdropReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setBackdropReady(true), 350)
    return () => clearTimeout(t)
  }, [])

  // Lock scroll — run once only
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Keyboard handler — stable ref for onClose
  useEffect(() => {
    function handler(e) {
      if (e.key !== 'Escape') return
      if (qrExpanded) setQrExpanded(false)
      else onCloseRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [qrExpanded])

  useEffect(() => {
    setQrDataUrl(null)
    QRCode.toDataURL(active.url, { width: 180, margin: 2, color: { dark: '#0a3d3b', light: '#ffffff' } })
      .then(setQrDataUrl).catch(() => {})
  }, [active.url])

  useEffect(() => {
    if (!token) return
    // GET /user-groups retorna { groups, pending_invites, ... } — extrair o array
    api.get('/user-groups', token)
      .then(res => setGroups(Array.isArray(res) ? res : (res?.groups || [])))
      .catch(() => {})
  }, [token])

  function copy() {
    navigator.clipboard.writeText(active.url).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  function shareNative() {
    if (!navigator.share) return
    navigator.share({ title: active.nativeTitle, text: active.nativeText, url: active.url }).catch(() => {})
  }

  function generateWhatsAppLink() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) { setPhoneError('Número inválido — use DDI + DDD + número, ex: 5511999998888'); return }
    setPhoneError('')
    // wa.me funciona em todo lugar: mobile redireciona p/ app, desktop p/ WhatsApp Web.
    // (whatsapp:// só abre se houver app registrado — falha silenciosa no desktop sem app)
    setWaLink(`https://wa.me/${digits}?text=${encodeURIComponent(active.waText)}`)
  }

  async function generateImage() {
    setGeneratingImg(true); setImgDataUrl(null); setImgError('')
    try {
      let ranking, title
      if (imgSource === 'group' && selectedGroup) {
        const res = await api.get(`/user-groups/${selectedGroup.id}/ranking`, token)
        ranking = res.ranking || []; title = res.group_name || selectedGroup.name
      } else {
        ranking = await api.get('/ranking'); title = 'Ranking Geral'
      }
      if (!ranking.length) { setImgError('Sem dados de ranking ainda.'); return }
      setImgDataUrl(await drawRankingCanvas(ranking, title))
    } catch (e) {
      setImgError(e.message || 'Erro ao gerar imagem')
    } finally {
      setGeneratingImg(false)
    }
  }

  function downloadImage() {
    const a = document.createElement('a')
    a.href = imgDataUrl
    a.download = 'ranking-predicts.png'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  async function shareImageNative() {
    try {
      const res = await fetch(imgDataUrl)
      const blob = await res.blob()
      const file = new File([blob], 'ranking-predicts.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Ranking Predicts' })
        return
      }
    } catch {}
    downloadImage()
  }

  const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div
      onClick={backdropReady ? onClose : e => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px', animation: 'fadeIn 120ms ease',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 20, width: '100%', maxWidth: 440,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
          animation: 'slideUp 180ms cubic-bezier(.22,.9,.36,1)',
          border: '1px solid var(--border)',
          overscrollBehavior: 'contain',
        }}
      >
        {/* Hero */}
        <div style={{ background: '#0a3d3b', padding: '28px 24px 20px', position: 'relative', textAlign: 'center', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >×</button>
          <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 10 }}>🎯</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#ffffff', letterSpacing: '0.08em' }}>PREDICTS</div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: '#8ecfcc', marginTop: 4, letterSpacing: '0.04em' }}>Bolão Copa 2026 · Convide para jogar</div>
        </div>

        <div style={{ padding: '20px 20px 24px' }}>

          {/* QR expandido inline */}
          {qrExpanded ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 0 32px rgba(15,122,120,0.4)', border: '2px solid var(--accent)' }}>
                {qrDataUrl && <img src={qrDataUrl} alt="QR Code" style={{ width: 220, height: 220, display: 'block' }} />}
              </div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>{active.url}</div>
              <button
                type="button"
                onClick={() => setQrExpanded(false)}
                style={{ padding: '7px 24px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, background: 'transparent', color: 'var(--text-2)', letterSpacing: '0.06em' }}
              >
                Fechar QR
              </button>
            </div>
          ) : (
            <>
              {/* Target tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: 'var(--bg-overlay)', borderRadius: 10, padding: 3 }}>
                {SHARE_TARGETS.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTarget(t.id); setCopied(false); setWaLink('') }}
                    style={{
                      flex: 1, padding: '7px 6px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700,
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

              {/* QR + Link */}
              <div style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => qrDataUrl && setQrExpanded(true)}
                  title="Clique para expandir QR"
                  style={{
                    flexShrink: 0, width: 92, height: 92, borderRadius: 12, overflow: 'hidden',
                    background: '#fff', border: '2px solid var(--accent)',
                    boxShadow: '0 4px 12px rgba(15,122,120,0.25)',
                    cursor: qrDataUrl ? 'zoom-in' : 'default', padding: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'transform .15s, box-shadow .15s',
                  }}
                  onMouseOver={e => { if (qrDataUrl) { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(15,122,120,0.45)' } }}
                  onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,122,120,0.25)' }}
                >
                  {qrDataUrl
                    ? <img src={qrDataUrl} alt="QR Code" style={{ width: 88, height: 88, display: 'block' }} />
                    : <div style={{ width: 88, height: 88, background: 'var(--bg-overlay)', borderRadius: 8 }} />
                  }
                </button>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                    📷 Toque para expandir QR
                  </div>
                  <div style={{ display: 'flex', gap: 6, background: 'var(--bg-overlay)', borderRadius: 8, padding: '7px 10px', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {active.url}
                    </span>
                    <button
                      type="button"
                      onClick={copy}
                      style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0, background: copied ? 'var(--win)' : 'var(--accent)', color: '#fff', transition: 'background 200ms' }}
                    >
                      {copied ? '✓' : 'Copiar'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Share buttons */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {/* wa.me universal: mobile abre o app, desktop abre WhatsApp Web */}
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(active.waText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, textDecoration: 'none', transition: 'opacity .15s' }}
                  onMouseOver={e => e.currentTarget.style.opacity = '.85'}
                  onMouseOut={e => e.currentTarget.style.opacity = '1'}
                >
                  <WhatsAppIcon /> WhatsApp
                </a>
                {hasNativeShare ? (
                  <button
                    type="button"
                    onClick={shareNative}
                    style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: 'transparent', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'background .15s' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <ShareIcon /> Mais opções
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openExternal(`https://x.com/intent/tweet?text=${encodeURIComponent(active.waText)}`)}
                    style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: 'transparent', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'background .15s' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    𝕏 Postar
                  </button>
                )}
              </div>
            </>
          )}

          {/* Divider — número */}
          <Divider label="Enviar para um número" />

          {/* WhatsApp number tool */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="tel"
                placeholder="5511999998888"
                value={phone}
                onChange={e => { setPhone(e.target.value); setPhoneError(''); setWaLink('') }}
                onKeyDown={e => { if (e.key === 'Enter') generateWhatsAppLink() }}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1px solid ${phoneError ? 'var(--lose)' : 'var(--border)'}`, background: 'var(--bg-overlay)', color: 'var(--text-1)', fontFamily: 'var(--font-data)', fontSize: 14, outline: 'none', transition: 'border-color .15s' }}
              />
              <button
                type="button"
                onClick={generateWhatsAppLink}
                style={{ padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, flexShrink: 0, transition: 'opacity .15s' }}
                onMouseOver={e => e.currentTarget.style.opacity = '.85'}
                onMouseOut={e => e.currentTarget.style.opacity = '1'}
              >
                Gerar Link
              </button>
            </div>
            {phoneError
              ? <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--lose)', marginTop: 5 }}>{phoneError}</div>
              : <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 5 }}>DDI + DDD + número · Ex: 55 11 9 9999-8888 → 5511999998888</div>
            }
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', borderRadius: 10, background: '#25D366', color: '#fff', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, textDecoration: 'none', transition: 'opacity .15s' }}
                onMouseOver={e => e.currentTarget.style.opacity = '.85'}
                onMouseOut={e => e.currentTarget.style.opacity = '1'}
              >
                <WhatsAppIcon /> Abrir WhatsApp
              </a>
            )}
          </div>

          {/* Divider — imagem */}
          <Divider label="Compartilhar Ranking como Imagem" />

          {/* Source selector */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <SourcePill active={imgSource === 'geral'} onClick={() => { setImgSource('geral'); setImgDataUrl(null); setSelectedGroup(null) }} label="🌎 Ranking Geral" />
            {groups.map(g => (
              <SourcePill
                key={g.id}
                active={imgSource === 'group' && selectedGroup?.id === g.id}
                onClick={() => { setImgSource('group'); setSelectedGroup(g); setImgDataUrl(null) }}
                label={`👥 ${g.name}`}
              />
            ))}
            {!token && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', alignSelf: 'center' }}>Entre para ver seus grupos</span>}
          </div>

          <button
            type="button"
            onClick={generateImage}
            disabled={generatingImg}
            style={{ width: '100%', padding: '11px', borderRadius: 10, border: 'none', cursor: generatingImg ? 'wait' : 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: generatingImg ? 'var(--bg-overlay)' : 'var(--accent)', color: generatingImg ? 'var(--text-3)' : '#fff', transition: 'all .15s', marginBottom: imgDataUrl || imgError ? 14 : 0 }}
          >
            {generatingImg ? '⏳ Gerando…' : '📸 Gerar Imagem'}
          </button>

          {imgError && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)', textAlign: 'center', marginBottom: 10 }}>{imgError}</div>}

          {imgDataUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', lineHeight: 0 }}>
                <img src={imgDataUrl} alt="Ranking preview" style={{ width: '100%', display: 'block' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={downloadImage}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: 'transparent', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background .15s' }}
                  onMouseOver={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  ⬇ Baixar
                </button>
                {hasNativeShare && (
                  <button
                    type="button"
                    onClick={shareImageNative}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#25D366', color: '#fff', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'opacity .15s' }}
                    onMouseOver={e => e.currentTarget.style.opacity = '.85'}
                    onMouseOut={e => e.currentTarget.style.opacity = '1'}
                  >
                    <WhatsAppIcon /> Compartilhar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

function SourcePill({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600, background: active ? 'var(--accent)' : 'transparent', color: active ? '#fff' : 'var(--text-2)', transition: 'all .15s', whiteSpace: 'nowrap' }}
    >
      {label}
    </button>
  )
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  )
}
