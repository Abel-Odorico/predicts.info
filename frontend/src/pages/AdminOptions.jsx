import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

const LEGAL_PAGES = [
  {
    slug: 'privacy',
    titleKey: 'privacy_title',
    introKey: 'privacy_intro',
    contentKey: 'privacy_content',
    label: 'Politica de Privacidade',
    path: '/privacidade',
  },
  {
    slug: 'terms',
    titleKey: 'terms_title',
    introKey: 'terms_intro',
    contentKey: 'terms_content',
    label: 'Termos de Uso',
    path: '/termos',
  },
  {
    slug: 'about',
    titleKey: 'about_title',
    introKey: 'about_intro',
    contentKey: 'about_content',
    label: 'Sobre',
    path: '/sobre',
  },
  {
    slug: 'contact',
    titleKey: 'contact_title',
    introKey: 'contact_intro',
    contentKey: 'contact_content',
    label: 'Contato',
    path: '/contato',
  },
]

const CONFIG_GROUPS = [
  {
    group: 'Identidade do Site',
    icon: '🏷',
    keys: [
      { key: 'site_title',    label: 'Título do site', hint: 'Exibido no header e sidebar' },
      { key: 'site_subtitle', label: 'Subtítulo',      hint: 'Linha abaixo do título no sidebar' },
    ],
  },
  {
    group: 'Banner de Destaque',
    icon: '📢',
    keys: [
      { key: 'banner_enabled', label: 'Banner ativo', hint: '"true" ou "false"', type: 'select', options: ['false', 'true'] },
      { key: 'banner_text',    label: 'Texto do banner', hint: 'Mensagem exibida no topo da página, ex: "🔴 Copa ao vivo agora!"' },
    ],
  },
  {
    group: 'Aviso aos Usuarios',
    icon: '🔔',
    keys: [
      { key: 'user_notice_enabled', label: 'Aviso ativo', hint: 'Liga ou desliga o comunicado dentro da area logada', type: 'select', options: ['true', 'false'] },
      { key: 'user_notice_profile_only', label: 'Somente perfil incompleto', hint: 'true = mostra apenas para quem ainda nao escolheu usuario ou celular; false = mostra para todos logados', type: 'select', options: ['true', 'false'] },
      { key: 'user_notice_title', label: 'Titulo do aviso', hint: 'Ex: Complete seu perfil' },
      { key: 'user_notice_text', label: 'Texto do aviso', hint: 'Use {itens} para inserir automaticamente o que falta no perfil', type: 'textarea', rows: 3 },
      { key: 'user_notice_button', label: 'Texto do botao', hint: 'Ex: Atualizar perfil' },
      { key: 'user_notice_url', label: 'Destino do botao', hint: 'Ex: /perfil, /meus-grupos ou uma URL completa' },
    ],
  },
  {
    group: 'Landing Page',
    icon: '🌐',
    keys: [
      { key: 'hero_headline',    label: 'Headline principal', hint: 'Título grande do hero' },
      { key: 'hero_subheadline', label: 'Subheadline',        hint: 'Parágrafo abaixo do título' },
      { key: 'hero_cta',         label: 'Texto do botão CTA', hint: 'Ex: "Simular agora →"' },
      { key: 'footer_text',      label: 'Texto do rodapé',    hint: 'Texto abaixo dos links' },
      { key: 'developer_credit', label: 'Desenvolvido por',   hint: 'Exibido no rodapé público do site' },
    ],
  },
  {
    group: 'SEO / Google',
    icon: '🔍',
    keys: [
      { key: 'meta_title',       label: 'Title tag',       hint: 'Tag <title> da página (ideal: 50–60 chars)' },
      { key: 'meta_description', label: 'Meta description', hint: 'Descrição para Google (ideal: 150–160 chars)', type: 'textarea' },
      { key: 'meta_keywords',    label: 'Meta keywords',    hint: 'Palavras-chave separadas por vírgula', type: 'textarea' },
    ],
  },
  {
    group: 'Paginas Institucionais',
    icon: '📄',
    keys: [
      { key: 'privacy_title',  label: 'Privacidade — titulo', hint: 'Titulo da pagina de privacidade' },
      { key: 'privacy_intro',  label: 'Privacidade — introducao', hint: 'Texto curto abaixo do titulo', type: 'textarea' },
      { key: 'privacy_content', label: 'Privacidade — conteudo', hint: 'Use "## Titulo da secao" e separe paragrafos por linha em branco', type: 'textarea', rows: 14 },
      { key: 'terms_title',    label: 'Termos — titulo', hint: 'Titulo da pagina de termos' },
      { key: 'terms_intro',    label: 'Termos — introducao', hint: 'Texto curto abaixo do titulo', type: 'textarea' },
      { key: 'terms_content',  label: 'Termos — conteudo', hint: 'Use "## Titulo da secao" e separe paragrafos por linha em branco', type: 'textarea', rows: 14 },
      { key: 'about_title',    label: 'Sobre — titulo', hint: 'Titulo da pagina sobre' },
      { key: 'about_intro',    label: 'Sobre — introducao', hint: 'Texto curto abaixo do titulo', type: 'textarea' },
      { key: 'about_content',  label: 'Sobre — conteudo', hint: 'Use "## Titulo da secao" e separe paragrafos por linha em branco', type: 'textarea', rows: 12 },
      { key: 'contact_title',  label: 'Contato — titulo', hint: 'Titulo da pagina de contato' },
      { key: 'contact_intro',  label: 'Contato — introducao', hint: 'Texto curto abaixo do titulo', type: 'textarea' },
      { key: 'contact_content', label: 'Contato — conteudo', hint: 'Use "## Titulo da secao" e separe paragrafos por linha em branco', type: 'textarea', rows: 10 },
      { key: 'contact_email',  label: 'Email geral', hint: 'Canal publico principal exibido na pagina de contato' },
      { key: 'privacy_email',  label: 'Email de privacidade', hint: 'Canal para LGPD, remocao e dados pessoais' },
    ],
  },
  {
    group: 'Google AdSense',
    icon: '💰',
    keys: [
      { key: 'adsense_enabled',      label: 'AdSense ativo',      hint: 'Ativa/desativa a injeção dos anúncios no site', type: 'select', options: ['false', 'true'] },
      { key: 'adsense_publisher_id', label: 'Publisher ID',        hint: 'Formato: ca-pub-XXXXXXXXXXXXXXXX (encontrado no painel do AdSense em Conta → Informações da conta)' },
      { key: 'adsense_auto_ads',     label: 'Auto Ads',            hint: 'true = Google escolhe onde colocar os anúncios automaticamente (recomendado para começar)', type: 'select', options: ['true', 'false'] },
      { key: 'adsense_slot_header',  label: 'Slot ID — Topo',      hint: 'ID do bloco de anúncio para o topo da página (Anúncios → Por bloco de anúncios → criar → exibição)' },
      { key: 'adsense_slot_content', label: 'Slot ID — Conteúdo',  hint: 'ID do bloco de anúncio no meio do conteúdo' },
      { key: 'adsense_slot_footer',  label: 'Slot ID — Rodapé',    hint: 'ID do bloco de anúncio no rodapé da página' },
    ],
  },
]

const ADSENSE_STEPS = [
  {
    step: 1,
    title: 'Criar conta no AdSense',
    desc: 'Acesse adsense.google.com e faça login com sua conta Google. Clique em "Começar" e preencha as informações do seu site.',
    url: 'https://adsense.google.com',
    tag: 'Obrigatório',
  },
  {
    step: 2,
    title: 'Adicionar o site predicts.info',
    desc: 'No painel do AdSense vá em Sites → Adicionar site. Digite predicts.info e clique em Salvar.',
    tag: 'Obrigatório',
  },
  {
    step: 3,
    title: 'Copiar o Publisher ID',
    desc: 'Vá em Conta → Informações da conta. Copie o Publisher ID no formato ca-pub-XXXXXXXXXXXXXXXX e cole no campo acima.',
    tag: 'Obrigatório',
  },
  {
    step: 4,
    title: 'Verificar propriedade do site',
    desc: 'O AdSense pedirá que você adicione um snippet de código no <head> do site. O snippet que o site já injeta automaticamente com o Publisher ID serve como verificação. Ative o AdSense e aguarde o Google rastrear o site (pode levar até 24h).',
    tag: 'Automático',
  },
  {
    step: 5,
    title: 'Habilitar Auto Ads (recomendado)',
    desc: 'Deixe "Auto Ads" como "true" nas configurações acima. O Google escolhe automaticamente os melhores lugares para os anúncios. Não precisa criar slots manualmente para começar.',
    tag: 'Recomendado',
  },
  {
    step: 6,
    title: 'Aguardar aprovação',
    desc: 'Após a configuração, o AdSense revisa o site (geralmente 1–3 dias, até 2 semanas em casos extremos). O site precisa ter conteúdo relevante, HTTPS ativo e política de privacidade.',
    tag: 'Aguardar',
  },
  {
    step: 7,
    title: 'Criar blocos de anúncio manuais (opcional)',
    desc: 'Se quiser controle sobre onde os anúncios aparecem: Anúncios → Por bloco de anúncio → Criar anúncio. Copie o "Slot ID" (número de 10 dígitos) e cole nos campos de Slot acima.',
    tag: 'Opcional',
  },
  {
    step: 8,
    title: 'Pré-requisitos para aprovação',
    desc: '✅ HTTPS ativo (predicts.info precisa do SSL)\n✅ Conteúdo original e relevante\n✅ Pelo menos 20–30 páginas com conteúdo\n✅ Política de privacidade acessível\n✅ Sem conteúdo proibido (apostas por dinheiro real, adulto, etc.)\n✅ Tráfego real de usuários humanos',
    tag: 'Checklist',
  },
]

const TAG_COLOR = {
  'Obrigatório': '#ef4444',
  'Automático':  '#22c55e',
  'Recomendado': '#f59e0b',
  'Aguardar':    '#a855f7',
  'Opcional':    '#64748b',
  'Checklist':   '#0ea5e9',
}

// Grupos do CONFIG_GROUPS que cada aba renderiza (Landing Page e Paginas
// Institucionais ficam fora — editadas pelos cards dedicados).
const TABS = [
  { id: 'identidade',   icon: '🏷',  label: 'Identidade',    groups: ['Identidade do Site', 'Banner de Destaque'] },
  { id: 'paginas',      icon: '📄',  label: 'Páginas',       groups: [] },
  { id: 'avisos',       icon: '🔔',  label: 'Avisos & SEO',  groups: ['Aviso aos Usuarios', 'SEO / Google'] },
  { id: 'anuncios',     icon: '💰',  label: 'Anúncios',      groups: ['Google AdSense'] },
  { id: 'notificacoes', icon: '✈️',  label: 'Notificações',  groups: [] },
]

const _g = name => CONFIG_GROUPS.find(g => g.group === name)?.keys.map(k => k.key) ?? []
const TAB_KEYS = {
  identidade:   new Set(['site_title', 'site_subtitle', 'developer_credit', 'banner_enabled', 'banner_text']),
  paginas:      new Set([...LEGAL_PAGES.flatMap(p => [p.titleKey, p.introKey, p.contentKey]), 'contact_email', 'privacy_email']),
  avisos:       new Set([..._g('Aviso aos Usuarios'), ..._g('SEO / Google')]),
  anuncios:     new Set(_g('Google AdSense')),
  notificacoes: new Set(['telegram_bot_token', 'telegram_chat_id', 'video_upload_token']),
}

export default function AdminOptions() {
  const { token } = useAuth()
  const [config, setConfig]   = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState(null)
  const [dirty, setDirty]     = useState({})
  const [tgTesting, setTgTesting]   = useState(false)
  const [tgMsg, setTgMsg]           = useState(null)
  const [showToken, setShowToken]       = useState(false)
  const [showVideoToken, setShowVideoToken] = useState(false)
  const [tgHook, setTgHook]         = useState(false)
  const [tgHookInfo, setTgHookInfo] = useState(null)
  const [tab, setTab]               = useState('identidade')

  useEffect(() => {
    api.get('/site-config/all', token)
      .then(d => setConfig(d))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [token])

  // Avisa antes de sair/recarregar com alterações pendentes
  useEffect(() => {
    const hasDirty = Object.values(dirty).some(Boolean)
    if (!hasDirty) return
    const handler = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function handleChange(key, value) {
    setConfig(c => ({ ...c, [key]: value }))
    setDirty(d => ({ ...d, [key]: true }))
    setMsg(null)
  }

  function isFieldDirty(key) {
    return Boolean(dirty[key])
  }

  async function saveAll() {
    setSaving(true)
    setMsg(null)
    try {
      const updates = Object.fromEntries(
        Object.entries(dirty).filter(([, v]) => v).map(([k]) => [k, config[k]])
      )
      if (Object.keys(updates).length === 0) {
        setMsg({ type: 'info', text: 'Sem alterações para salvar.' })
        return
      }
      await api.post('/site-config/bulk', { updates }, token)
      setDirty({})
      setMsg({ type: 'ok', text: `${Object.keys(updates).length} configuração(ões) salva(s).` })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function discardAll() {
    setSaving(true)
    try {
      const d = await api.get('/site-config/all', token)
      setConfig(d)
      setDirty({})
      setMsg({ type: 'info', text: 'Alterações descartadas.' })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function saveTelegram() {
    setSaving(true)
    setTgMsg(null)
    try {
      await api.post('/site-config/bulk', {
        updates: {
          telegram_bot_token: config.telegram_bot_token || '',
          telegram_chat_id:   config.telegram_chat_id   || '',
        }
      }, token)
      setDirty(d => ({ ...d, telegram_bot_token: false, telegram_chat_id: false }))
      setTgMsg({ type: 'ok', text: 'Credenciais salvas.' })
    } catch (e) {
      setTgMsg({ type: 'err', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  async function testTelegram() {
    setTgTesting(true)
    setTgMsg(null)
    try {
      await api.post('/site-config/bulk', {
        updates: {
          telegram_bot_token: config.telegram_bot_token || '',
          telegram_chat_id:   config.telegram_chat_id   || '',
        }
      }, token)
      await api.post('/admin/daily-report/send', {}, token)
      setTgMsg({ type: 'ok', text: '✅ Relatório enviado com sucesso!' })
    } catch (e) {
      setTgMsg({ type: 'err', text: e.message })
    } finally {
      setTgTesting(false)
    }
  }

  async function setupWebhook() {
    setTgHook(true)
    setTgMsg(null)
    try {
      await api.post('/site-config/bulk', {
        updates: {
          telegram_bot_token: config.telegram_bot_token || '',
          telegram_chat_id:   config.telegram_chat_id   || '',
        }
      }, token)
      const r = await api.post('/admin/telegram/setup-webhook', {}, token)
      if (r?.ok) {
        setTgMsg({ type: 'ok', text: '🤖 Bot ativado! Mande /menu no Telegram para abrir o painel.' })
        loadWebhookInfo()
      } else {
        setTgMsg({ type: 'err', text: 'Falha ao ativar: ' + (r?.reason || JSON.stringify(r?.telegram || r)) })
      }
    } catch (e) {
      setTgMsg({ type: 'err', text: e.message })
    } finally {
      setTgHook(false)
    }
  }

  async function loadWebhookInfo() {
    try {
      const r = await api.get('/admin/telegram/webhook-info', token)
      setTgHookInfo(r?.result || r)
    } catch { setTgHookInfo(null) }
  }

  async function saveKey(key) {
    setSaving(true)
    try {
      await api.put(`/site-config/${key}`, { value: config[key] }, token)
      setDirty(d => ({ ...d, [key]: false }))
      setMsg({ type: 'ok', text: `"${key}" salvo.` })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner text="Carregando configurações..." />

  const dirtyCount = Object.values(dirty).filter(Boolean).length
  const legalDirtyCount = LEGAL_PAGES.reduce((sum, page) => {
    return sum + [page.titleKey, page.introKey, page.contentKey].filter(isFieldDirty).length
  }, 0) + ['contact_email', 'privacy_email'].filter(isFieldDirty).length
  const brandingDirty = ['site_title', 'site_subtitle', 'developer_credit'].filter(isFieldDirty).length
  const tabDirty = id => Object.keys(dirty).filter(k => dirty[k] && TAB_KEYS[id]?.has(k)).length

  const renderGroups = names => (
    <div className="stack fade-in-2" style={{ gap: 'var(--s6)' }}>
      {CONFIG_GROUPS.filter(group => names.includes(group.group)).map(group => (
        <div key={group.group} className="card">
          <div className="card__header">
            <span className="section-title section-title--flush">
              {group.icon} {group.group}
            </span>
          </div>
          <div className="card__body">
            <div className="stack gap-4">
              {group.keys.map(field => (
                <div key={field.key} className="options-field">
                  <div className="options-field__label">
                    <span>{field.label}</span>
                    {dirty[field.key] && (
                      <span className="options-field__changed">● ALTERADO</span>
                    )}
                  </div>
                  <div className="options-field__hint">{field.hint}</div>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="form-input"
                      rows={field.rows || 3}
                      value={config[field.key] ?? ''}
                      onChange={e => handleChange(field.key, e.target.value)}
                      style={{ resize: 'vertical', fontFamily: 'var(--font-data)', fontSize: 13 }}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      className="form-input"
                      value={config[field.key] ?? 'false'}
                      onChange={e => handleChange(field.key, e.target.value)}
                      style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}
                    >
                      {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="form-input"
                      value={config[field.key] ?? ''}
                      onChange={e => handleChange(field.key, e.target.value)}
                      style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}
                    />
                  )}
                  {dirty[field.key] && (
                    <button
                      onClick={() => saveKey(field.key)}
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 'var(--s2)', alignSelf: 'flex-start' }}
                      disabled={saving}
                    >
                      Salvar apenas este
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="page">
      <div className="fade-in-1">
        <div>
          <h1 className="page-title">CONFIGURAÇÕES DO SITE</h1>
          <p className="page-subtitle">Identidade, páginas públicas, avisos, SEO, anúncios e notificações</p>
        </div>
      </div>

      <div className="admin-options-quick mt-6 fade-in-1">
        <button type="button" onClick={() => setTab('identidade')} className={`admin-options-quick__card${tab === 'identidade' ? ' admin-options-quick__card--accent' : ''}`}>
          <span className="admin-options-quick__label">Identidade</span>
          <strong className="admin-options-quick__value">{config.site_title || 'Predicts.info'}</strong>
          <span className="admin-options-quick__meta">{brandingDirty > 0 ? `${brandingDirty} alteração(ões)` : 'Sem pendências'}</span>
        </button>
        <button type="button" onClick={() => setTab('paginas')} className={`admin-options-quick__card${tab === 'paginas' ? ' admin-options-quick__card--accent' : ''}`}>
          <span className="admin-options-quick__label">Páginas Públicas</span>
          <strong className="admin-options-quick__value">Privacidade · Termos · Sobre · Contato</strong>
          <span className="admin-options-quick__meta">{legalDirtyCount > 0 ? `${legalDirtyCount} alteração(ões)` : 'Sem pendências'}</span>
        </button>
        <button type="button" onClick={() => setTab('avisos')} className={`admin-options-quick__card${tab === 'avisos' ? ' admin-options-quick__card--accent' : ''}`}>
          <span className="admin-options-quick__label">Aviso aos Usuários</span>
          <strong className="admin-options-quick__value">{config.user_notice_title || 'Sem título'}</strong>
          <span className="admin-options-quick__meta">{config.user_notice_enabled === 'true' ? '✅ Ativo' : '⚪ Desativado'}</span>
        </button>
        <button type="button" onClick={() => setTab('anuncios')} className={`admin-options-quick__card${tab === 'anuncios' ? ' admin-options-quick__card--accent' : ''}`}>
          <span className="admin-options-quick__label">AdSense</span>
          <strong className="admin-options-quick__value">{config.adsense_publisher_id || 'Não configurado'}</strong>
          <span className="admin-options-quick__meta">{config.adsense_enabled === 'true' ? '✅ Ativo' : '⚪ Desativado'}</span>
        </button>
        <button type="button" onClick={() => setTab('notificacoes')} className={`admin-options-quick__card${tab === 'notificacoes' ? ' admin-options-quick__card--accent' : ''}`}>
          <span className="admin-options-quick__label">Telegram</span>
          <strong className="admin-options-quick__value">{config.telegram_chat_id || 'Não configurado'}</strong>
          <span className="admin-options-quick__meta">{config.telegram_bot_token && config.telegram_chat_id ? '✅ Configurado' : '⚠️ Pendente'}</span>
        </button>
      </div>

      <div className="tabs mt-6 fade-in-1">
        {TABS.map(t => {
          const n = tabDirty(t.id)
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'active' : ''}>
              <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
              {n > 0 && <span className="tab-badge">{n}</span>}
            </button>
          )
        })}
      </div>

      {msg && (
        <div style={{
          marginTop: 'var(--s4)',
          padding: 'var(--s3) var(--s4)',
          borderRadius: 'var(--r2)',
          background: msg.type === 'ok' ? 'color-mix(in srgb, var(--win) 12%, transparent)' :
                      msg.type === 'err' ? 'color-mix(in srgb, var(--lose) 12%, transparent)' :
                      'var(--bg-overlay)',
          border: `1px solid ${msg.type === 'ok' ? 'var(--win)' : msg.type === 'err' ? 'var(--lose)' : 'var(--border)'}`,
          fontFamily: 'var(--font-cond)',
          fontSize: 13,
          color: msg.type === 'ok' ? 'var(--win)' : msg.type === 'err' ? 'var(--lose)' : 'var(--text-2)',
        }}>
          {msg.text}
        </div>
      )}

      {tab === 'identidade' && (<>
      <div className="card card--accent fade-in-2" style={{ marginTop: 'var(--s6)' }}>
        <div className="card__header">
          <span className="section-title section-title--flush">
            ✍️ Credito Publico e Identidade
          </span>
        </div>
        <div className="card__body">
          <div className="admin-options-highlight">
            <div className="admin-options-highlight__preview">
              <div className="admin-options-highlight__kicker">Aparece publicamente no site</div>
              <div className="admin-options-highlight__title">Desenvolvido por</div>
              <div className="admin-options-highlight__value">{config.developer_credit || 'PeepConnect - By Abel Odorico'}</div>
            </div>
            <div className="stack gap-4" style={{ flex: 1 }}>
              {[
                { key: 'site_title', label: 'Titulo do site', hint: 'Exibido no header e sidebar' },
                { key: 'site_subtitle', label: 'Subtitulo', hint: 'Linha abaixo do titulo no sidebar' },
                { key: 'developer_credit', label: 'Desenvolvido por', hint: 'Exibido na landing e no app' },
              ].map(field => (
                <div key={field.key} className="options-field">
                  <div className="options-field__label">
                    <span>{field.label}</span>
                    {isFieldDirty(field.key) && <span className="options-field__changed">● ALTERADO</span>}
                  </div>
                  <div className="options-field__hint">{field.hint}</div>
                  <input
                    type="text"
                    className="form-input"
                    value={config[field.key] ?? ''}
                    onChange={e => handleChange(field.key, e.target.value)}
                    style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {renderGroups(['Identidade do Site', 'Banner de Destaque'])}
      </>)}

      {tab === 'paginas' && (
      <div id="legal-pages-card" className="card fade-in-2" style={{ marginTop: 'var(--s6)' }}>
        <div className="card__header">
          <span className="section-title section-title--flush">
            📄 Paginas Publicas Editaveis
          </span>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
            /privacidade · /termos · /sobre · /contato
          </span>
        </div>
        <div className="card__body">
          <div className="admin-options-help">
            Edite aqui o conteudo visivel dessas paginas. Para criar secoes, use <code>## Titulo da secao</code>. Separe paragrafos com uma linha em branco.
          </div>

          <div className="admin-legal-grid">
            {LEGAL_PAGES.map(page => (
              <section key={page.slug} className="admin-legal-card">
                <div className="admin-legal-card__head">
                  <div>
                    <div className="admin-legal-card__title">{page.label}</div>
                    <div className="admin-legal-card__path">{page.path}</div>
                  </div>
                  <a href={page.path} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    Abrir pagina
                  </a>
                </div>

                <div className="stack gap-4">
                  <div className="options-field">
                    <div className="options-field__label">
                      <span>Titulo</span>
                      {isFieldDirty(page.titleKey) && <span className="options-field__changed">● ALTERADO</span>}
                    </div>
                    <input
                      type="text"
                      className="form-input"
                      value={config[page.titleKey] ?? ''}
                      onChange={e => handleChange(page.titleKey, e.target.value)}
                      style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}
                    />
                  </div>

                  <div className="options-field">
                    <div className="options-field__label">
                      <span>Introducao</span>
                      {isFieldDirty(page.introKey) && <span className="options-field__changed">● ALTERADO</span>}
                    </div>
                    <textarea
                      className="form-input"
                      rows={4}
                      value={config[page.introKey] ?? ''}
                      onChange={e => handleChange(page.introKey, e.target.value)}
                      style={{ resize: 'vertical', fontFamily: 'var(--font-data)', fontSize: 13 }}
                    />
                  </div>

                  <div className="options-field">
                    <div className="options-field__label">
                      <span>Conteudo</span>
                      {isFieldDirty(page.contentKey) && <span className="options-field__changed">● ALTERADO</span>}
                    </div>
                    <textarea
                      className="form-input"
                      rows={12}
                      value={config[page.contentKey] ?? ''}
                      onChange={e => handleChange(page.contentKey, e.target.value)}
                      style={{ resize: 'vertical', fontFamily: 'var(--font-data)', fontSize: 13 }}
                    />
                  </div>
                </div>
              </section>
            ))}
          </div>

          <div className="admin-legal-emails">
            <div className="options-field">
              <div className="options-field__label">
                <span>Email geral</span>
                {isFieldDirty('contact_email') && <span className="options-field__changed">● ALTERADO</span>}
              </div>
              <div className="options-field__hint">Canal publico principal exibido na pagina de contato</div>
              <input
                type="text"
                className="form-input"
                value={config.contact_email ?? ''}
                onChange={e => handleChange('contact_email', e.target.value)}
                style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}
              />
            </div>

            <div className="options-field">
              <div className="options-field__label">
                <span>Email de privacidade</span>
                {isFieldDirty('privacy_email') && <span className="options-field__changed">● ALTERADO</span>}
              </div>
              <div className="options-field__hint">Canal para LGPD, remocao de dados e solicitacoes de privacidade</div>
              <input
                type="text"
                className="form-input"
                value={config.privacy_email ?? ''}
                onChange={e => handleChange('privacy_email', e.target.value)}
                style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}
              />
            </div>
          </div>
        </div>
      </div>
      )}

      {tab === 'avisos' && (
        <div className="mt-6">
          {renderGroups(['Aviso aos Usuarios', 'SEO / Google'])}
        </div>
      )}

      {tab === 'anuncios' && (
        <div className="mt-6">
          {renderGroups(['Google AdSense'])}
        </div>
      )}

      {tab === 'notificacoes' && (
      <div id="telegram-card" className="card fade-in-3" style={{ marginTop: 'var(--s6)' }}>
        <div className="card__header">
          <span className="section-title section-title--flush">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#229ED9" style={{ verticalAlign: '-3px', marginRight: 4 }} aria-label="Telegram"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" /></svg> Notificações — Telegram
          </span>
        </div>
        <div className="card__body">
          <div style={{ display: 'grid', gap: 'var(--s5)', maxWidth: 540 }}>

            {/* Status */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s3)',
              padding: 'var(--s3) var(--s4)',
              background: config.telegram_bot_token && config.telegram_chat_id
                ? 'color-mix(in srgb, var(--win) 10%, transparent)'
                : 'color-mix(in srgb, var(--conf-caf) 10%, transparent)',
              border: `1px solid ${config.telegram_bot_token && config.telegram_chat_id ? 'color-mix(in srgb, var(--win) 35%, transparent)' : 'color-mix(in srgb, var(--conf-caf) 35%, transparent)'}`,
              borderRadius: 'var(--r2)',
              fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600,
              color: config.telegram_bot_token && config.telegram_chat_id ? 'var(--win)' : 'var(--conf-caf)',
            }}>
              {config.telegram_bot_token && config.telegram_chat_id ? '✅ Configurado — pronto para envio' : '⚠️ Não configurado'}
            </div>

            {/* Token */}
            <div className="form-group">
              <label className="form-label">Bot Token</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showToken ? 'text' : 'password'}
                  className="form-input"
                  style={{ paddingRight: 44, fontFamily: 'var(--font-data)', fontSize: 12 }}
                  placeholder="7123456789:AAF..."
                  value={config.telegram_bot_token || ''}
                  onChange={e => handleChange('telegram_bot_token', e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(v => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {showToken ? 'ocultar' : 'mostrar'}
                </button>
              </div>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                Obtenha em @BotFather → /newbot
              </span>
            </div>

            {/* Chat ID */}
            <div className="form-group">
              <label className="form-label">Chat ID</label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}
                placeholder="-100xxxxxxxxxx ou @seucanal"
                value={config.telegram_chat_id || ''}
                onChange={e => handleChange('telegram_chat_id', e.target.value)}
                autoComplete="off"
              />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                Envie /start pro bot e acesse api.telegram.org/bot&lt;TOKEN&gt;/getUpdates para ver o chat.id
              </span>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={saveTelegram}
                disabled={saving}
              >
                {saving ? '⏳ Salvando...' : '💾 Salvar credenciais'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={testTelegram}
                disabled={tgTesting || !config.telegram_bot_token || !config.telegram_chat_id}
              >
                {tgTesting ? '⏳ Enviando...' : '📨 Testar envio agora'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={setupWebhook}
                disabled={tgHook || !config.telegram_bot_token || !config.telegram_chat_id}
                title="Ativa o menu interativo (/menu) no bot"
              >
                {tgHook ? '⏳ Ativando...' : '🤖 Ativar bot/menu'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={loadWebhookInfo}
                disabled={!config.telegram_bot_token}
              >
                🔍 Status do bot
              </button>
            </div>

            {tgHookInfo && (
              <div style={{
                padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r2)',
                background: 'var(--bg-overlay)', border: '1px solid var(--border)',
                fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-2)',
                lineHeight: 1.7, wordBreak: 'break-all',
              }}>
                <div>Webhook: <b style={{ color: tgHookInfo.url ? 'var(--win)' : 'var(--lose)' }}>{tgHookInfo.url || '(não configurado)'}</b></div>
                <div>Updates pendentes: {tgHookInfo.pending_update_count ?? '—'}</div>
                {tgHookInfo.last_error_message && (
                  <div style={{ color: 'var(--lose)' }}>Último erro: {tgHookInfo.last_error_message}</div>
                )}
                <div style={{ color: 'var(--text-4)', marginTop: 4 }}>Relatório automático: todo dia às 07:00 (Brasília)</div>
              </div>
            )}

            {tgMsg && (
              <div style={{
                padding: 'var(--s3) var(--s4)',
                borderRadius: 'var(--r2)',
                background: tgMsg.type === 'ok'
                  ? 'color-mix(in srgb, var(--win) 12%, transparent)'
                  : 'color-mix(in srgb, var(--lose) 12%, transparent)',
                border: `1px solid ${tgMsg.type === 'ok' ? 'var(--win)' : 'var(--lose)'}`,
                fontFamily: 'var(--font-cond)', fontSize: 13,
                color: tgMsg.type === 'ok' ? 'var(--win)' : 'var(--lose)',
              }}>
                {tgMsg.text}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div style={{
            marginTop: 'var(--s6)', padding: 'var(--s4)',
            background: 'var(--bg-overlay)', borderRadius: 'var(--r2)',
            border: '1px solid var(--border)', fontSize: 12,
            color: 'var(--text-2)', lineHeight: 1.8,
          }}>
            <strong style={{ fontFamily: 'var(--font-cond)', letterSpacing: '0.06em', color: 'var(--text-1)' }}>
              📋 Como configurar
            </strong>
            <ol style={{ marginTop: 'var(--s3)', paddingLeft: 'var(--s5)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              <li>Abra o Telegram e fale com <strong>@BotFather</strong></li>
              <li>Digite <code style={{ background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: 3 }}>/newbot</code> e siga as instruções — copie o <strong>token</strong> e cole acima</li>
              <li>Mande qualquer mensagem pro bot (ex: <code style={{ background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: 3 }}>/start</code>)</li>
              <li>Acesse <code style={{ background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: 3 }}>api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> — procure o campo <strong>chat.id</strong></li>
              <li>Cole o Chat ID acima, salve e clique em <strong>Testar envio</strong></li>
            </ol>
            <div style={{ marginTop: 'var(--s3)', color: 'var(--text-3)' }}>
              Para grupos: adicione o bot ao grupo antes. O Chat ID de grupos começa com <code style={{ background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: 3 }}>-100</code>.
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Video Upload Token */}
      {tab === 'notificacoes' && (
      <div className="card fade-in-3" style={{ marginTop: 'var(--s6)' }}>
        <div className="card__header">
          <span className="section-title section-title--flush">🎬 Upload de Vídeo — Token</span>
        </div>
        <div className="card__body">
          <div style={{ display: 'grid', gap: 'var(--s5)', maxWidth: 540 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s3)',
              padding: 'var(--s3) var(--s4)',
              background: config.video_upload_token
                ? 'color-mix(in srgb, var(--win) 10%, transparent)'
                : 'color-mix(in srgb, var(--conf-caf) 10%, transparent)',
              border: `1px solid ${config.video_upload_token ? 'color-mix(in srgb, var(--win) 35%, transparent)' : 'color-mix(in srgb, var(--conf-caf) 35%, transparent)'}`,
              borderRadius: 'var(--r2)',
              fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600,
              color: config.video_upload_token ? 'var(--win)' : 'var(--conf-caf)',
            }}>
              {config.video_upload_token ? '✅ Token configurado' : '⚠️ Token não definido'}
            </div>
            <div className="form-group">
              <label className="form-label">Token de acesso</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showVideoToken ? 'text' : 'password'}
                  className="form-input"
                  style={{ paddingRight: 44, fontFamily: 'var(--font-data)', fontSize: 13 }}
                  placeholder="Token secreto para upload de vídeo"
                  value={config.video_upload_token || ''}
                  onChange={e => handleChange('video_upload_token', e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowVideoToken(v => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {showVideoToken ? 'ocultar' : 'mostrar'}
                </button>
              </div>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                Enviado como header <code style={{ background: 'var(--bg-surface)', padding: '1px 4px', borderRadius: 3 }}>x-token</code> em POST /api/video/upload
              </span>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* AdSense Manual */}
      {tab === 'anuncios' && (
      <div className="card fade-in-3" style={{ marginTop: 'var(--s6)' }}>
        <div className="card__header">
          <span className="section-title section-title--flush">
            📋 Manual — Como configurar o Google AdSense
          </span>
        </div>
        <div className="card__body">
          <div className="stack gap-4">
            {ADSENSE_STEPS.map(s => (
              <div key={s.step} style={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr',
                gap: 'var(--s4)',
                padding: 'var(--s4)',
                background: 'var(--bg-overlay)',
                borderRadius: 'var(--r2)',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: `color-mix(in srgb, ${TAG_COLOR[s.tag]} 15%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${TAG_COLOR[s.tag]} 40%, transparent)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 14,
                  color: TAG_COLOR[s.tag],
                }}>
                  {s.step}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s2)', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-1)' }}>
                      {s.title}
                    </span>
                    <span style={{
                      fontSize: 9, fontFamily: 'var(--font-cond)', fontWeight: 700,
                      letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 7px',
                      borderRadius: 100, border: `1px solid ${TAG_COLOR[s.tag]}`,
                      color: TAG_COLOR[s.tag],
                      background: `color-mix(in srgb, ${TAG_COLOR[s.tag]} 12%, transparent)`,
                    }}>
                      {s.tag}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{s.desc}</p>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{
                      display: 'inline-block', marginTop: 'var(--s2)',
                      fontSize: 11, color: 'var(--accent2)', fontFamily: 'var(--font-data)',
                    }}>
                      {s.url} ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 'var(--s6)', padding: 'var(--s4)',
            background: 'color-mix(in srgb, var(--win) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--win) 30%, transparent)',
            borderRadius: 'var(--r2)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7,
          }}>
            <strong style={{ color: 'var(--win)', fontFamily: 'var(--font-cond)', letterSpacing: '0.06em' }}>💡 COMO FUNCIONA A INTEGRAÇÃO</strong><br />
            Ao salvar o Publisher ID e ativar o AdSense, a landing page (<code style={{ background: 'var(--bg-overlay)', padding: '1px 5px', borderRadius: 3 }}>predicts.info/</code>) e o simulador passarão a injetar automaticamente o script do AdSense no <code style={{ background: 'var(--bg-overlay)', padding: '1px 5px', borderRadius: 3 }}>&lt;head&gt;</code>.
            Com Auto Ads ativo, o Google coloca os anúncios nos melhores lugares sem configuração manual de slots.
            Os slots manuais (Topo, Conteúdo, Rodapé) são opcionais e permitem controle fino da posição.
          </div>
        </div>
      </div>
      )}

      <div className="admin-save-bar">
        <span className="admin-save-bar__status">
          {dirtyCount > 0
            ? `${dirtyCount} alteração${dirtyCount > 1 ? 'ões' : ''} não salva${dirtyCount > 1 ? 's' : ''}`
            : '✓ Tudo salvo'}
        </span>
        {dirtyCount > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={discardAll} disabled={saving}>
            Descartar
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={saveAll} disabled={saving || dirtyCount === 0}>
          {saving ? '⏳ Salvando...' : dirtyCount > 0 ? `💾 Salvar ${dirtyCount}` : '✓ Salvo'}
        </button>
      </div>
    </div>
  )
}
