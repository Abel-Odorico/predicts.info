import { useEffect, useState } from 'react'
import { api } from '../api'
import InfoPage, { parseInfoContent } from '../components/InfoPage'

export default function Terms() {
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    api.get('/site-config/public').then(setCfg).catch(() => {})
  }, [])

  const sections = parseInfoContent(cfg?.terms_content)
  const aside = [
    { label: 'Escopo', value: 'Simulador e conteudo esportivo informativo' },
    { label: 'Afiliacao', value: 'Nao afiliado a FIFA' },
    { label: 'Usuarios', value: 'Visitantes e contas cadastradas' },
    { label: 'Contato geral', value: cfg?.contact_email || 'contact@predicts.info' },
    { label: 'Ultima atualizacao', value: '18 de junho de 2026' },
  ]

  return (
    <InfoPage
      eyebrow="Termos"
      title={cfg?.terms_title || 'Termos de Uso'}
      intro={cfg?.terms_intro || 'Estes termos definem as condicoes de acesso e uso do Predicts.info, incluindo limites de responsabilidade e regras basicas de conduta.'}
      sections={sections}
      aside={aside}
    />
  )
}
