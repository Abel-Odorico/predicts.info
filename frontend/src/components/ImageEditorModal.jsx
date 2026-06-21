import { useState, useCallback, useRef } from 'react'
import Cropper from 'react-easy-crop'

function getCroppedCanvas(imageSrc, crop, zoom, rotation) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const rad = (rotation * Math.PI) / 180
      const sin = Math.abs(Math.sin(rad))
      const cos = Math.abs(Math.cos(rad))
      const rotW = image.width * cos + image.height * sin
      const rotH = image.width * sin + image.height * cos

      canvas.width = rotW
      canvas.height = rotH
      ctx.translate(rotW / 2, rotH / 2)
      ctx.rotate(rad)
      ctx.drawImage(image, -image.width / 2, -image.height / 2)

      const scaleX = image.width / 100
      const scaleY = image.height / 100
      const cropX = (crop.x / 100) * rotW
      const cropY = (crop.y / 100) * rotH
      const cropW = (crop.width / 100) * rotW
      const cropH = (crop.height / 100) * rotH

      const output = document.createElement('canvas')
      output.width = cropW
      output.height = cropH
      output.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
      output.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png', 1)
    }
    image.onerror = reject
    image.src = imageSrc
  })
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  },
  modal: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    width: '100%', maxWidth: 520,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 16,
    color: 'var(--text-1)', letterSpacing: '0.04em',
  },
  close: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-3)', fontSize: 20, lineHeight: 1, padding: 4,
  },
  cropArea: {
    position: 'relative', width: '100%', height: 320,
    background: '#000',
  },
  controls: {
    padding: '16px 20px',
    display: 'flex', flexDirection: 'column', gap: 12,
    borderTop: '1px solid var(--border)',
  },
  label: {
    fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)',
    letterSpacing: '0.08em', marginBottom: 4, display: 'block',
  },
  slider: { width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' },
  row: { display: 'flex', gap: 8 },
  footer: {
    padding: '12px 20px',
    borderTop: '1px solid var(--border)',
    display: 'flex', justifyContent: 'flex-end', gap: 8,
  },
}

export default function ImageEditorModal({ src, onConfirm, onClose, loading }) {
  const [crop, setCrop]           = useState({ x: 0, y: 0 })
  const [zoom, setZoom]           = useState(1)
  const [rotation, setRotation]   = useState(0)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast]   = useState(100)
  const [completedCrop, setCompletedCrop] = useState(null)

  const handleConfirm = useCallback(async () => {
    if (!completedCrop) return
    try {
      const blob = await getCroppedCanvas(src, completedCrop, zoom, rotation)
      onConfirm(blob)
    } catch (e) {
      console.error(e)
    }
  }, [src, completedCrop, zoom, rotation, onConfirm])

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        {/* Header */}
        <div style={S.header}>
          <span style={S.title}>✂️ Editor de Imagem</span>
          <button style={S.close} onClick={onClose}>✕</button>
        </div>

        {/* Crop area */}
        <div style={S.cropArea}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, px) => setCompletedCrop(px)}
            style={{
              containerStyle: { background: '#0a0a0a' },
              cropAreaStyle: {
                border: '2px solid var(--accent)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              },
            }}
          />
          {/* CSS filter preview overlay via style on the media element */}
          <style>{`
            .reactEasyCrop_Image, .reactEasyCrop_Video {
              filter: brightness(${brightness}%) contrast(${contrast}%);
            }
          `}</style>
        </div>

        {/* Controls */}
        <div style={S.controls}>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>ZOOM — {zoom.toFixed(1)}×</label>
              <input type="range" style={S.slider} min={1} max={4} step={0.05}
                value={zoom} onChange={e => setZoom(Number(e.target.value))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>ROTAÇÃO — {rotation}°</label>
              <input type="range" style={S.slider} min={-180} max={180} step={1}
                value={rotation} onChange={e => setRotation(Number(e.target.value))} />
            </div>
          </div>
          <div style={S.row}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>BRILHO — {brightness}%</label>
              <input type="range" style={S.slider} min={50} max={200} step={1}
                value={brightness} onChange={e => setBrightness(Number(e.target.value))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>CONTRASTE — {contrast}%</label>
              <input type="range" style={S.slider} min={50} max={200} step={1}
                value={contrast} onChange={e => setContrast(Number(e.target.value))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm"
              onClick={() => { setZoom(1); setRotation(0); setBrightness(100); setContrast(100) }}>
              ↺ Resetar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRotation(r => r - 90)}>⟲ −90°</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRotation(r => r + 90)}>⟳ +90°</button>
          </div>
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={loading}>Cancelar</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleConfirm}
            disabled={loading || !completedCrop}
            style={{ minWidth: 120 }}
          >
            {loading ? '⏳ Salvando...' : '✓ Aplicar e salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
