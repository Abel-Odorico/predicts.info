import { useState } from 'react'

/**
 * Imagem de time que serve tanto bandeira retangular (seleções, Copa) quanto
 * escudo quadrado de clube (Brasileirão, e futuras competições tipo
 * Libertadores/Copa do Brasil) no MESMO slot de UI.
 *
 * Detecta a proporção real da imagem ao carregar (crest ~1:1 vs bandeira
 * ~4:3) e troca o tratamento visual sozinha — evita hardcodar overrides de
 * CSS por competição que quebram quando entra uma competição nova com outra
 * proporção de asset (mesma lição do gotcha ".duel-bar__flag foi feita pra
 * bandeira, escudo é quadrado").
 */
export default function TeamCrestFlag({ src, alt, className = '', crestClassName = '', style, crestStyle }) {
  const [isCrest, setIsCrest] = useState(false)
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt}
      className={isCrest ? `${className} ${crestClassName}`.trim() : className}
      style={isCrest ? (crestStyle || style) : style}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
        if (w && h && Math.abs(w / h - 1) < 0.2) setIsCrest(true)
      }}
    />
  )
}
