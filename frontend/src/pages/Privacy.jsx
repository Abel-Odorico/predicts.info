import { useEffect, useState } from 'react'
import { api } from '../api'
import InfoPage, { parseInfoContent } from '../components/InfoPage'

export default function Privacy() {
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    api.get('/site-config/public').then(setCfg).catch(() => {})
  }, [])

  const sections = parseInfoContent(cfg?.privacy_content)
  const aside = [
    { label: 'Site', value: 'Predicts.info' },
    { label: 'Tema', value: 'World Cup 2026 predictions and simulator' },
    { label: 'Publicidade', value: 'Google AdSense e parceiros podem exibir anuncios' },
    { label: 'Contato privacidade', value: cfg?.privacy_email || 'privacy@predicts.info' },
    { label: 'Ultima atualizacao', value: '18 de junho de 2026' },
  ]

  return (
    <InfoPage
      eyebrow="Privacidade"
      title={cfg?.privacy_title || 'Politica de Privacidade'}
      intro={cfg?.privacy_intro || 'Esta pagina explica quais dados o Predicts.info pode coletar, por que eles sao usados e como publicidade e analytics se relacionam com o funcionamento do site.'}
      sections={sections}
      aside={aside}
    />
  )
}
