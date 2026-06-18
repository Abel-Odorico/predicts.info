import { useEffect, useState } from 'react'
import { api } from '../api'
import InfoPage, { parseInfoContent } from '../components/InfoPage'

export default function Contact() {
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    api.get('/site-config/public').then(setCfg).catch(() => {})
  }, [])

  const sections = parseInfoContent(cfg?.contact_content)
  const aside = [
    { label: 'Contato geral', value: cfg?.contact_email || 'contact@predicts.info' },
    { label: 'Privacidade', value: cfg?.privacy_email || 'privacy@predicts.info' },
    { label: 'Site', value: 'https://predicts.info' },
    { label: 'Ultima atualizacao', value: '18 de junho de 2026' },
  ]

  return (
    <InfoPage
      eyebrow="Contato"
      title={cfg?.contact_title || 'Contato'}
      intro={cfg?.contact_intro || 'Esta pagina centraliza os canais para suporte, questoes de privacidade, denuncias de abuso e comunicacoes relacionadas ao Predicts.info.'}
      sections={sections}
      aside={aside}
    />
  )
}
