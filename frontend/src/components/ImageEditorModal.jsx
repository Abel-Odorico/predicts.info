import { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'

const SHAPES = [
  { id: 'rect-square', label: '⬜ Quadrado',   cropShape: 'rect',  aspect: 1 },
  { id: 'round',       label: '⭕ Circular',    cropShape: 'round', aspect: 1 },
  { id: 'rect-16-9',   label: '▭ 16:9',        cropShape: 'rect',  aspect: 16/9 },
  { id: 'rect-4-3',    label: '▭ 4:3',         cropShape: 'rect',  aspect: 4/3 },
  { id: 'rect-free',   label: '✥ Livre',        cropShape: 'rect',  aspect: undefined },
]

function createImage(url) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })
}

async function getCroppedCanvas(src, pixelCrop, rotation, shape) {
  const image = await createImage(src)
  const rad = (rotation * Math.PI) / 180
  const safeArea = 2 * ((Math.max(image.width, image.height) / 2) * Math.sqrt(2))

  // Rotated full image
  const rot = document.createElement('canvas')
  rot.width = rot.height = safeArea
  const rCtx = rot.getContext('2d')
  rCtx.translate(safeArea / 2, safeArea / 2)
  rCtx.rotate(rad)
  rCtx.translate(-safeArea / 2, -safeArea / 2)
  rCtx.drawImage(image, safeArea / 2 - image.width / 2, safeArea / 2 - image.height / 2)

  const data = rCtx.getImageData(0, 0, safeArea, safeArea)

  // Crop
  const out = document.createElement('canvas')
  out.width  = pixelCrop.width
  out.height = pixelCrop.height
  const ctx = out.getContext('2d')

  if (shape === 'round') {
    ctx.save()
    ctx.beginPath()
    ctx.arc(pixelCrop.width / 2, pixelCrop.height / 2, Math.min(pixelCrop.width, pixelCrop.height) / 2, 0, Math.PI * 2)
    ctx.clip()
  }

  ctx.putImageData(
    data,
    Math.round(0 - safeArea / 2 + image.width / 2 - pixelCrop.x),
    Math.round(0 - safeArea / 2 + image.height / 2 - pixelCrop.y)
  )

  if (shape === 'round') ctx.restore()

  return new Promise((res, rej) =>
    out.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png', 1)
  )
}

const chip = (active) => ({
  fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 12,
  padding: '5px 10px', borderRadius: 6, cursor: 'pointer', border: 'none',
  background: active ? 'var(--accent)' : 'var(--bg-2)',
  color: active ? 'var(--on-accent)' : 'var(--text-2)',
  transition: 'background 0.15s, color 0.15s',
})

export default function ImageEditorModal({ src, onConfirm, onClose, loading }) {
  const [crop, setCrop]           = useState({ x: 0, y: 0 })
  const [zoom, setZoom]           = useState(1)
  const [rotation, setRotation]   = useState(0)
  const [brightness, setBright]   = useState(100)
  const [contrast, setContrast]   = useState(100)
  const [shapeId, setShapeId]     = useState('rect-square')
  const [pixelCrop, setPixelCrop] = useState(null)

  const shape = SHAPES.find(s => s.id === shapeId) || SHAPES[0]

  const handleConfirm = useCallback(async () => {
    if (!pixelCrop) return
    const blob = await getCroppedCanvas(src, pixelCrop, rotation, shape.cropShape)
    onConfirm(blob)
  }, [src, pixelCrop, rotation, shape, onConfirm])

  const reset = () => { setZoom(1); setRotation(0); setBright(100); setContrast(100) }

  return (
    <div
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.88)',
               backdropFilter:'blur(6px)', display:'flex', alignItems:'center',
               justifyContent:'center', padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)',
                    borderRadius:16, width:'100%', maxWidth:540,
                    display:'flex', flexDirection:'column', overflow:'hidden',
                    boxShadow:'0 24px 64px rgba(0,0,0,0.7)', maxHeight:'95vh' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                      padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
          <span style={{ fontFamily:'var(--font-cond)', fontWeight:700, fontSize:16,
                         color:'var(--text-1)', letterSpacing:'0.04em' }}>
            ✂️ Editor de Imagem
          </span>
          <button onClick={onClose}
            style={{ background:'none', border:'none', cursor:'pointer',
                     color:'var(--text-3)', fontSize:20, padding:4 }}>✕</button>
        </div>

        {/* Shape selector */}
        <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)',
                      display:'flex', gap:6, flexWrap:'wrap' }}>
          {SHAPES.map(s => (
            <button key={s.id} style={chip(s.id === shapeId)}
              onClick={() => { setShapeId(s.id); setCrop({ x:0, y:0 }); setZoom(1) }}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Crop area */}
        <div style={{ position:'relative', width:'100%', height:300, background:'#050d14' }}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={shape.aspect}
            cropShape={shape.cropShape}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, px) => setPixelCrop(px)}
            style={{
              containerStyle: { background: '#050d14' },
              cropAreaStyle: { border: '2px solid var(--accent)',
                               boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' },
            }}
          />
          <style>{`.reactEasyCrop_Image,.reactEasyCrop_Video{filter:brightness(${brightness}%) contrast(${contrast}%)}`}</style>
        </div>

        {/* Controls */}
        <div style={{ padding:'14px 20px', display:'flex', flexDirection:'column',
                      gap:10, borderTop:'1px solid var(--border)', overflowY:'auto' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {[
              { label:`ZOOM — ${zoom.toFixed(1)}×`, min:1, max:4, step:0.05, val:zoom, set:setZoom },
              { label:`ROTAÇÃO — ${rotation}°`, min:-180, max:180, step:1, val:rotation, set:setRotation },
              { label:`BRILHO — ${brightness}%`, min:50, max:200, step:1, val:brightness, set:setBright },
              { label:`CONTRASTE — ${contrast}%`, min:50, max:200, step:1, val:contrast, set:setContrast },
            ].map(({ label, min, max, step, val, set }) => (
              <div key={label}>
                <label style={{ fontFamily:'var(--font-cond)', fontSize:10,
                                color:'var(--text-4)', letterSpacing:'0.08em',
                                display:'block', marginBottom:4 }}>{label}</label>
                <input type="range" min={min} max={max} step={step} value={val}
                  onChange={e => set(Number(e.target.value))}
                  style={{ width:'100%', accentColor:'var(--accent)', cursor:'pointer' }} />
              </div>
            ))}
          </div>

          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={reset}>↺ Resetar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRotation(r => r - 90)}>⟲ −90°</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setRotation(r => r + 90)}>⟳ +90°</button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border)',
                      display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={loading}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={handleConfirm}
            disabled={loading || !pixelCrop} style={{ minWidth:130 }}>
            {loading ? '⏳ Salvando...' : '✓ Aplicar e salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
