import { useEffect, useState } from 'react'
import { api } from '../api'
import InfoPage, { parseInfoContent } from '../components/InfoPage'

export default function About() {
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    api.get('/site-config/public').then(setCfg).catch(() => {})
  }, [])

  const sections = parseInfoContent(cfg?.about_content)
  const aside = [
    { label: 'Produto', value: 'Predicts.info' },
    { label: 'Modelo', value: 'Elo + Poisson + Monte Carlo' },
    { label: 'Cobertura', value: 'FIFA World Cup 2026' },
    { label: 'Acesso', value: 'Publico e gratuito' },
  ]

  return (
    <InfoPage
      eyebrow="Sobre"
      title={cfg?.about_title || 'Sobre o Predicts.info'}
      intro={cfg?.about_intro || 'Conheca rapidamente o objetivo do projeto, a natureza do conteudo e a base estatistica usada para gerar previsoes e simulacoes.'}
      sections={sections}
      aside={aside}
    />
  )
}
