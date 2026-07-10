import { useState, useEffect } from 'react'
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

function normalizeDate(value) {
  if (!value) return null
  const hasTz = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)
  return hasTz ? value : `${value}Z`
}

function fmtShort(value) {
  if (!value) return '—'
  return new Date(normalizeDate(value)).toLocaleString('pt-BR', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

function WaIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="#25D366" style={{ verticalAlign: '-3px' }} aria-label="WhatsApp">
      <path d="M16.04 2.67C8.65 2.67 2.65 8.67 2.65 16.05c0 2.37.62 4.68 1.8 6.72L2.53 29.33l6.73-1.87a13.36 13.36 0 006.77 1.85h.01c7.39 0 13.39-6 13.39-13.38 0-3.57-1.39-6.93-3.92-9.46a13.28 13.28 0 00-9.47-3.8zm0 24.48h-.01a11.1 11.1 0 01-5.67-1.55l-.41-.24-4 1.1 1.07-3.9-.26-.4a11.1 11.1 0 01-1.71-5.9c0-6.14 5-11.14 11.15-11.14 2.98 0 5.78 1.16 7.88 3.27a11.06 11.06 0 013.26 7.88c0 6.14-5.01 11.14-11.15 11.14v.01zm6.11-8.35c-.33-.17-1.97-.97-2.28-1.08-.31-.11-.53-.17-.75.17-.22.33-.86 1.08-1.06 1.31-.19.22-.39.25-.72.08-.33-.17-1.4-.51-2.66-1.63-.98-.88-1.65-1.96-1.84-2.29-.19-.33-.02-.51.15-.68.15-.15.33-.39.5-.58.17-.2.22-.33.33-.55.11-.22.06-.42-.03-.58-.08-.17-.75-1.8-1.03-2.47-.27-.65-.55-.56-.75-.57-.19-.01-.42-.01-.64-.01-.22 0-.58.08-.89.42-.31.33-1.17 1.14-1.17 2.79 0 1.64 1.2 3.22 1.37 3.45.17.22 2.36 3.6 5.71 5.05.8.34 1.42.55 1.9.71.8.25 1.53.22 2.11.13.64-.1 1.97-.8 2.25-1.58.28-.77.28-1.44.2-1.58-.08-.14-.31-.22-.64-.39z" />
    </svg>
  )
}

const WA_SUBTABS = [
  { id: 'overview',  label: 'Visão geral' },
  { id: 'conexao',   label: 'Conexão' },
  { id: 'conversas', label: 'Conversas' },
  { id: 'campanhas', label: 'Campanhas' },
  { id: 'grupos',    label: 'Grupos' },
  { id: 'sessoes',   label: 'Sessões' },
  { id: 'mensagens', label: 'Mensagens' },
  { id: 'contatos',  label: 'Contatos' },
  { id: 'apostas',   label: 'Apostas WA' },
  { id: 'meta',      label: 'Oficial (Meta)' },
]

export default function AdminWhatsapp() {
  const { token } = useAuth()

  const [waStatus,     setWaStatus]     = useState(null)
  const [waStatusLoading, setWaStatusLoading] = useState(false)
  const [quietEnabled, setQuietEnabled] = useState(true)
  const [quietStart,   setQuietStart]   = useState('22')
  const [quietEnd,     setQuietEnd]     = useState('8')
  const [quietSaving,  setQuietSaving]  = useState(false)
  const [waQr,         setWaQr]         = useState(null)
  const [waQrLoading,  setWaQrLoading]  = useState(false)
  const [waEnabled,    setWaEnabled]    = useState(false)
  const [waMsg,        setWaMsg]        = useState('')
  const [waTestPhone,  setWaTestPhone]  = useState('')
  const [waTestText,   setWaTestText]   = useState('')
  const [waSending,    setWaSending]    = useState(false)
  const [waCampaignMsg, setWaCampaignMsg] = useState('')
  const [waCampaignSegment, setWaCampaignSegment] = useState('opt_in')
  const [waCampaignPreview, setWaCampaignPreview] = useState(null)
  const [waCampaignPreviewLoading, setWaCampaignPreviewLoading] = useState(false)
  const [waCampaigns,  setWaCampaigns]  = useState(null)
  const [waCampaignLoading, setWaCampaignLoading] = useState(false)
  const [waGroupSubject, setWaGroupSubject] = useState('')
  const [waGroupPhones,  setWaGroupPhones]  = useState('')
  const [waAnalytics,   setWaAnalytics]   = useState(null)
  const [waAnalyticsLoading, setWaAnalyticsLoading] = useState(false)
  const [waMessages,    setWaMessages]    = useState(null)
  const [waMessagesLoading, setWaMessagesLoading] = useState(false)
  const [waMessagesPhone, setWaMessagesPhone] = useState('')
  const [waSessions,    setWaSessions]    = useState(null)
  const [waSessionsLoading, setWaSessionsLoading] = useState(false)
  const [waContacts,    setWaContacts]    = useState(null)
  const [waContactsLoading, setWaContactsLoading] = useState(false)
  const [waContactsQuery, setWaContactsQuery] = useState('')
  const [waContactsOptInOnly, setWaContactsOptInOnly] = useState(false)
  const [waDetail, setWaDetail] = useState(null)
  const [waMessagesTotal, setWaMessagesTotal] = useState(null)
  const [waContactsTotal, setWaContactsTotal] = useState(null)
  const [waBets, setWaBets] = useState(null)
  const [waBetsLoading, setWaBetsLoading] = useState(false)
  const [waBetsTotal, setWaBetsTotal] = useState(null)
  const [waBetsOpen, setWaBetsOpen] = useState({})
  const [waBetsPeriod, setWaBetsPeriod] = useState('all') // all | today | 7d | 30d
  const [waChats, setWaChats] = useState(null)
  const [waChatsLoading, setWaChatsLoading] = useState(false)
  const [waChatsQuery, setWaChatsQuery] = useState('')
  const [waSubTab, setWaSubTab] = useState('overview')
  const [waGroups, setWaGroups] = useState(null)
  const [waGroupsLoading, setWaGroupsLoading] = useState(false)
  const [waOfficialJid, setWaOfficialJid] = useState('')
  const [waThread, setWaThread] = useState(null) // { jid, name, messages, loading, sending, draft, error }
  const [waGroupManage, setWaGroupManage] = useState(null) // { jid, subject, subjectDraft, description, descriptionDraft, participants, loading, busy, error }

  const [metaEnabled, setMetaEnabled] = useState(false)
  const [metaToken, setMetaToken] = useState('')
  const [metaPhoneId, setMetaPhoneId] = useState('')
  const [metaWabaId, setMetaWabaId] = useState('')
  const [metaVerifyToken, setMetaVerifyToken] = useState('')
  const [showMetaToken, setShowMetaToken] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaMsg, setMetaMsg] = useState('')
  const [metaLoaded, setMetaLoaded] = useState(false)

  async function loadWaStatus() {
    setWaStatusLoading(true)
    try {
      const [status, cfg] = await Promise.all([
        api.get('/admin/whatsapp/status', token),
        api.get('/site-config/all', token),
      ])
      setWaStatus(status)
      setWaEnabled((cfg.whatsapp_enabled || 'false') === 'true')
      setQuietEnabled((cfg.whatsapp_quiet_enabled || 'true') === 'true')
      setQuietStart(cfg.whatsapp_quiet_start || '22')
      setQuietEnd(cfg.whatsapp_quiet_end || '8')
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaStatusLoading(false) }
  }

  async function saveQuietHours(nextEnabled, nextStart, nextEnd) {
    setQuietSaving(true)
    try {
      await api.post('/site-config/bulk', {
        updates: {
          whatsapp_quiet_enabled: nextEnabled ? 'true' : 'false',
          whatsapp_quiet_start: String(nextStart),
          whatsapp_quiet_end: String(nextEnd),
        },
      }, token)
      setQuietEnabled(nextEnabled); setQuietStart(String(nextStart)); setQuietEnd(String(nextEnd))
      setWaMsg(nextEnabled ? `✓ Modo silêncio: ${nextStart}h às ${nextEnd}h (BRT)` : '✓ Modo silêncio desligado')
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro ao salvar silêncio'}`) }
    finally { setQuietSaving(false) }
  }

  async function loadWaQr() {
    setWaQrLoading(true); setWaMsg('')
    try {
      const r = await api.get('/admin/whatsapp/qrcode', token)
      setWaQr(r.base64 || r.qrcode?.base64 || null)
      if (!r.base64 && !r.qrcode?.base64) setWaMsg('Sem QR — instância já pode estar conectada. Confere o status.')
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro ao gerar QR'}`) }
    finally { setWaQrLoading(false) }
  }

  async function toggleWaEnabled() {
    const next = !waEnabled
    try {
      await api.put('/site-config/whatsapp_enabled', { value: next ? 'true' : 'false' }, token)
      setWaEnabled(next)
      setWaMsg(next ? '✓ WhatsApp ativado' : 'WhatsApp desativado')
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
  }

  async function sendWaTest() {
    if (!waTestPhone || !waTestText) return
    setWaSending(true); setWaMsg('')
    try {
      await api.post('/admin/whatsapp/send', { phone: waTestPhone, message: waTestText }, token)
      setWaMsg('✓ Mensagem enviada')
    } catch (e) { setWaMsg(`✗ ${e?.message || 'falha ao enviar'}`) }
    finally { setWaSending(false) }
  }

  async function loadWaCampaigns() {
    setWaCampaignLoading(true)
    try { setWaCampaigns(await api.get('/admin/whatsapp/campaigns', token)) }
    catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaCampaignLoading(false) }
  }

  function changeWaCampaignSegment(segment) {
    setWaCampaignSegment(segment)
    loadWaCampaignPreview(segment)
  }

  async function loadWaCampaignPreview(segment) {
    setWaCampaignPreviewLoading(true)
    try {
      const r = await api.get(`/admin/whatsapp/campaign/preview?segment=${segment}`, token)
      setWaCampaignPreview(r.recipients)
    } catch { setWaCampaignPreview(null) }
    finally { setWaCampaignPreviewLoading(false) }
  }

  async function createWaCampaign() {
    if (!waCampaignMsg.trim()) return
    if (!window.confirm(`Enviar pra ${waCampaignPreview ?? '?'} destinatário(s)? Não dá pra desfazer.`)) return
    setWaMsg('')
    try {
      const r = await api.post('/admin/whatsapp/campaign', { message: waCampaignMsg, segment: waCampaignSegment }, token)
      setWaMsg(`✓ Campanha criada — ${r.recipients} destinatário(s) na fila`)
      setWaCampaignMsg('')
      loadWaCampaigns()
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
  }

  function selectWaSubTab(id) {
    setWaSubTab(id)
    if (id === 'grupos' && !waGroups && !waGroupsLoading) loadWaGroups()
    if (id === 'conversas' && !waChats && !waChatsLoading) loadWaChats()
    if (id === 'campanhas' && waCampaignPreview === null) loadWaCampaignPreview(waCampaignSegment)
    if (id === 'meta' && !metaLoaded) loadMetaConfig()
    if (id === 'apostas' && !waBets && !waBetsLoading) loadWaBets()
  }

  async function loadMetaConfig() {
    try {
      const cfg = await api.get('/site-config/all', token)
      setMetaEnabled((cfg.whatsapp_meta_enabled || 'false') === 'true')
      setMetaToken(cfg.whatsapp_meta_token || '')
      setMetaPhoneId(cfg.whatsapp_meta_phone_id || '')
      setMetaWabaId(cfg.whatsapp_meta_waba_id || '')
      setMetaVerifyToken(cfg.whatsapp_meta_verify_token || '')
      setMetaLoaded(true)
    } catch (e) { setMetaMsg(`✗ ${e?.message || 'erro'}`) }
  }

  async function saveMetaConfig() {
    setMetaSaving(true); setMetaMsg('')
    try {
      await api.post('/site-config/bulk', {
        updates: {
          whatsapp_meta_enabled: metaEnabled ? 'true' : 'false',
          whatsapp_meta_token: metaToken.trim(),
          whatsapp_meta_phone_id: metaPhoneId.trim(),
          whatsapp_meta_waba_id: metaWabaId.trim(),
          whatsapp_meta_verify_token: metaVerifyToken.trim(),
        },
      }, token)
      setMetaMsg('✓ Credenciais salvas')
    } catch (e) { setMetaMsg(`✗ ${e?.message || 'erro ao salvar'}`) }
    finally { setMetaSaving(false) }
  }

  async function loadWaGroups() {
    setWaGroupsLoading(true)
    try {
      const [groups, official] = await Promise.allSettled([
        api.get('/admin/whatsapp/groups', token),
        api.get('/admin/whatsapp/group/official', token),
      ])
      if (groups.status === 'fulfilled') setWaGroups(groups.value)
      else setWaMsg(`✗ ${groups.reason?.message || 'erro ao listar grupos'}`)
      if (official.status === 'fulfilled') setWaOfficialJid(official.value?.group_jid || '')
    }
    finally { setWaGroupsLoading(false) }
  }

  async function setOfficialGroup(jid) {
    setWaMsg('')
    try {
      await api.put('/admin/whatsapp/group/official', { group_jid: jid }, token)
      setWaOfficialJid(jid)
      setWaMsg(jid ? '✓ Grupo oficial definido — avisos automáticos ativos' : '✓ Avisos automáticos desativados')
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro ao definir grupo oficial'}`) }
  }

  async function createWaGroup() {
    const participants = waGroupPhones.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    if (!waGroupSubject.trim() || participants.length === 0) return
    setWaMsg('')
    try {
      await api.post('/admin/whatsapp/group', { subject: waGroupSubject, participants }, token)
      setWaMsg('✓ Grupo criado')
      setWaGroupSubject(''); setWaGroupPhones('')
      loadWaGroups()
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro ao criar grupo'}`) }
  }

  async function loadWaAnalytics() {
    setWaAnalyticsLoading(true)
    try { setWaAnalytics(await api.get('/admin/whatsapp/analytics', token)) }
    catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaAnalyticsLoading(false) }
  }

  async function loadWaMessages(append = false) {
    setWaMessagesLoading(true)
    try {
      const params = new URLSearchParams()
      if (waMessagesPhone) params.set('phone', waMessagesPhone)
      params.set('offset', append ? String(waMessages?.length || 0) : '0')
      const r = await api.get(`/admin/whatsapp/messages?${params.toString()}`, token)
      setWaMessages(append ? [...(waMessages || []), ...r.items] : r.items)
      setWaMessagesTotal(r.total)
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaMessagesLoading(false) }
  }

  async function loadWaSessions() {
    setWaSessionsLoading(true)
    try { setWaSessions(await api.get('/admin/whatsapp/sessions', token)) }
    catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaSessionsLoading(false) }
  }

  async function cancelWaSession(id) {
    try {
      await api.delete(`/admin/whatsapp/session/${id}`, token)
      setWaSessions(prev => prev?.filter(s => s.id !== id))
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro ao cancelar'}`) }
  }

  async function loadWaContacts(append = false) {
    setWaContactsLoading(true)
    try {
      const params = new URLSearchParams()
      if (waContactsQuery) params.set('q', waContactsQuery)
      if (waContactsOptInOnly) params.set('only_opt_in', 'true')
      params.set('offset', append ? String(waContacts?.length || 0) : '0')
      const r = await api.get(`/admin/whatsapp/contacts?${params.toString()}`, token)
      setWaContacts(append ? [...(waContacts || []), ...r.items] : r.items)
      setWaContactsTotal(r.total)
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaContactsLoading(false) }
  }

  async function loadWaBets() {
    setWaBetsLoading(true)
    try {
      // limit=200 (teto do backend) — agrupado por partida na UI, paginação só se passar disso
      const r = await api.get('/admin/whatsapp/bets?limit=200&offset=0', token)
      setWaBets(r.items)
      setWaBetsTotal(r.total)
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaBetsLoading(false) }
  }

  async function loadWaChats() {
    setWaChatsLoading(true)
    try { setWaChats(await api.get('/admin/whatsapp/chats', token)) }
    catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setWaChatsLoading(false) }
  }

  async function openGroupManage(jid, subject) {
    setWaGroupManage({ jid, subject, subjectDraft: subject || '', description: '', descriptionDraft: '', participants: null, loading: true, busy: false, error: null })
    try {
      const participants = await api.get(`/admin/whatsapp/group/participants?group_jid=${encodeURIComponent(jid)}`, token)
      setWaGroupManage(g => (g?.jid === jid ? { ...g, participants, loading: false } : g))
    } catch (e) {
      setWaGroupManage(g => (g?.jid === jid ? { ...g, loading: false, error: e?.message || 'erro ao carregar' } : g))
    }
  }

  async function saveGroupSubject() {
    const jid = waGroupManage?.jid
    const subject = waGroupManage?.subjectDraft?.trim()
    if (!jid || !subject) return
    setWaGroupManage(g => ({ ...g, busy: true }))
    try {
      await api.put('/admin/whatsapp/group/subject', { group_jid: jid, subject }, token)
      setWaGroupManage(g => (g?.jid === jid ? { ...g, subject, busy: false } : g))
      loadWaGroups()
    } catch (e) {
      setWaGroupManage(g => (g?.jid === jid ? { ...g, busy: false, error: e?.message || 'falha ao renomear' } : g))
    }
  }

  async function saveGroupDescription() {
    const jid = waGroupManage?.jid
    const description = waGroupManage?.descriptionDraft?.trim()
    if (!jid) return
    setWaGroupManage(g => ({ ...g, busy: true }))
    try {
      await api.put('/admin/whatsapp/group/description', { group_jid: jid, description }, token)
      setWaGroupManage(g => (g?.jid === jid ? { ...g, description, busy: false } : g))
    } catch (e) {
      setWaGroupManage(g => (g?.jid === jid ? { ...g, busy: false, error: e?.message || 'falha ao atualizar descrição' } : g))
    }
  }

  async function removeGroupParticipant(phone) {
    const jid = waGroupManage?.jid
    if (!jid) return
    if (!window.confirm(`Remover ${phone} do grupo? Não dá pra desfazer sem adicionar de novo.`)) return
    setWaGroupManage(g => ({ ...g, busy: true }))
    try {
      await api.post('/admin/whatsapp/group/participant', { group_jid: jid, action: 'remove', participants: [phone] }, token)
      setWaGroupManage(g => (g?.jid === jid ? { ...g, busy: false, participants: g.participants.filter(p => p.phone !== phone) } : g))
    } catch (e) {
      setWaGroupManage(g => (g?.jid === jid ? { ...g, busy: false, error: e?.message || 'falha ao remover' } : g))
    }
  }

  async function doLeaveGroup() {
    const jid = waGroupManage?.jid
    const subject = waGroupManage?.subject
    if (!jid) return
    if (!window.confirm(`Sair do grupo "${subject}"? Não dá pra desfazer — precisaria ser adicionado de novo.`)) return
    setWaGroupManage(g => ({ ...g, busy: true }))
    try {
      await api.delete(`/admin/whatsapp/group/${encodeURIComponent(jid)}/leave`, token)
      setWaGroupManage(null)
      loadWaGroups()
    } catch (e) {
      setWaGroupManage(g => (g?.jid === jid ? { ...g, busy: false, error: e?.message || 'falha ao sair do grupo' } : g))
    }
  }

  async function openChatThread({ jid, phone, name }) {
    const key = jid || phone
    setWaThread({ key, jid, name, messages: null, loading: true, sending: false, draft: '', error: null })
    try {
      const q = jid ? `jid=${encodeURIComponent(jid)}` : `phone=${encodeURIComponent(phone)}`
      const r = await api.get(`/admin/whatsapp/chat/messages?${q}`, token)
      setWaThread(t => (t?.key === key ? { ...t, jid: r.jid, messages: r.messages, loading: false } : t))
    } catch (e) {
      setWaThread(t => (t?.key === key ? { ...t, loading: false, error: e?.message || 'erro ao carregar' } : t))
    }
  }

  async function sendChatReply() {
    const jid = waThread?.jid
    const text = waThread?.draft?.trim()
    if (!jid || !text) return
    setWaThread(t => ({ ...t, sending: true }))
    try {
      await api.post('/admin/whatsapp/chat/send', { jid, message: text }, token)
      setWaThread(t => (t?.key === waThread.key ? { ...t, draft: '', sending: false } : t))
      openChatThread({ jid, name: waThread.name })
    } catch (e) {
      setWaThread(t => (t?.key === waThread.key ? { ...t, sending: false, error: e?.message || 'falha ao enviar' } : t))
    }
  }

  async function cancelWaCampaign(id) {
    try { await api.post(`/admin/whatsapp/campaign/${id}/cancel`, {}, token); loadWaCampaigns() }
    catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
  }

  async function retryWaCampaign(id) {
    try {
      const r = await api.post(`/admin/whatsapp/campaign/${id}/retry`, {}, token)
      setWaMsg(`✓ ${r.requeued} reenfileirada(s)`)
      loadWaCampaigns()
    } catch (e) { setWaMsg(`✗ ${e?.message || 'erro'}`) }
  }

  useEffect(() => {
    loadWaStatus()
    loadWaCampaigns()
    loadWaAnalytics()
    loadWaMessages()
    loadWaSessions()
    loadWaContacts()
  }, [])

  return (
    <div className="adm-shell">
      <div className="adm-header">
        <div className="adm-header__left">
          <div className="adm-header__title"><WaIcon size={22} /> WHATSAPP</div>
          <div className="adm-header__sub">predicts.info · bot de apostas &amp; campanhas</div>
        </div>
        <div className="adm-header__actions">
          <a href="/admin" className="btn btn-ghost btn-sm">🛠 Painel Admin</a>
          <a href="/admin/analytics" className="btn btn-ghost btn-sm">📊 Analytics</a>
          <a href="/admin/options" className="btn btn-ghost btn-sm">⚙️ Config</a>
        </div>
      </div>

      <div className="adm-pane fade-in-1">
        {waMsg && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 13, color: waMsg.startsWith('✓') ? 'var(--win)' : 'var(--text-2)' }}>
            {waMsg}
          </div>
        )}

        {/* Sub-navegação */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          {WA_SUBTABS.map(st => (
            <button
              key={st.id}
              className={waSubTab === st.id ? 'btn btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => selectWaSubTab(st.id)}
            >
              {st.label}
            </button>
          ))}
        </div>

        {waSubTab === 'overview' && (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Opt-in', value: waAnalytics ? `${waAnalytics.opt_in.opted_in}/${waAnalytics.opt_in.total_with_phone}` : '—', sub: waAnalytics && waAnalytics.opt_in.total_with_phone > 0 ? `${Math.round(100 * waAnalytics.opt_in.opted_in / waAnalytics.opt_in.total_with_phone)}% adesão` : 'sem telefone cadastrado' },
                { label: 'Msgs recebidas', value: waAnalytics?.messages.inbound ?? '—', sub: 'total inbound' },
                { label: 'Msgs enviadas', value: waAnalytics?.messages.outbound_sent ?? '—', sub: `${waAnalytics?.messages.outbound_failed ?? 0} falharam` },
                { label: 'Sessões ativas', value: waAnalytics?.active_sessions ?? '—', sub: 'aguardando confirmação' },
                { label: 'Apostas via WA', value: waAnalytics?.bets_via_whatsapp ?? '—', sub: 'palpites confirmados' },
                { label: 'Campanhas', value: waAnalytics?.campaigns.total ?? '—', sub: `${waAnalytics?.campaigns.running ?? 0} rodando` },
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--bg-overlay)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{k.value}</div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* Gráfico volume diário */}
            {waAnalytics?.daily?.length > 0 && (
              <div className="adm-card">
                <div className="adm-card__header">
                  <span className="adm-card__title">📈 Volume de mensagens (14 dias)</span>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={waAnalytics.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-3)' }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="inbound" name="Recebidas" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="outbound" name="Enviadas" fill="var(--win)" radius={[4, 4, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {waSubTab === 'conexao' && (
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title"><WaIcon /> Instância WhatsApp (predicts)</span>
              <button className="btn btn-sm" onClick={loadWaStatus} disabled={waStatusLoading}>
                {waStatusLoading ? '…' : '↻ Status'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: waStatus?.instance?.state === 'open' ? 'var(--win)' : (waStatus?.instance?.state === 'connecting' ? '#f59e0b' : 'var(--lose)'),
                  display: 'inline-block',
                }} />
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700 }}>
                  {waStatus?.instance?.state === 'open' ? 'Conectado' : waStatus?.instance?.state === 'connecting' ? 'Conectando…' : waStatus?.instance?.state === 'close' ? 'Desconectado' : 'Desconhecido'}
                </span>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={waEnabled} onChange={toggleWaEnabled} />
                WhatsApp ativado (envios/recebimento liberados)
              </label>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16,
              padding: '12px 16px', background: 'var(--bg-overlay)', borderRadius: 10,
              border: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 13,
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={quietEnabled}
                  disabled={quietSaving}
                  onChange={() => saveQuietHours(!quietEnabled, quietStart, quietEnd)}
                />
                🌙 Modo silêncio
              </label>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: quietEnabled ? 1 : 0.45 }}>
                das
                <select
                  value={quietStart} disabled={!quietEnabled || quietSaving}
                  onChange={e => saveQuietHours(quietEnabled, e.target.value, quietEnd)}
                  style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text-1)' }}
                >
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}h</option>)}
                </select>
                às
                <select
                  value={quietEnd} disabled={!quietEnabled || quietSaving}
                  onChange={e => saveQuietHours(quietEnabled, quietStart, e.target.value)}
                  style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text-1)' }}
                >
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}h</option>)}
                </select>
                (BRT)
              </span>
              <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                Bloqueia campanha, lembrete, grupo, resultado e novidades na janela. Resposta a mensagem recebida sempre sai.
              </span>
            </div>

            {waStatus?.info && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
                padding: 16, background: 'var(--bg-overlay)', borderRadius: 10, border: '1px solid var(--border)',
                marginBottom: 16, fontFamily: 'var(--font-cond)',
              }}>
                {waStatus.info.profile_pic_url && (
                  <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <img src={waStatus.info.profile_pic_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%' }} />
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{waStatus.info.profile_name || '—'}</span>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Instância</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{waStatus.info.instance_name || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Número</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{waStatus.info.number || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Conectado em</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {waStatus.info.created_at ? new Date(waStatus.info.created_at).toLocaleString('pt-BR') : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Última atividade</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {waStatus.info.updated_at ? new Date(waStatus.info.updated_at).toLocaleString('pt-BR') : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Mensagens</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{waStatus.info.message_count ?? '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Contatos</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{waStatus.info.contact_count ?? '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Conversas</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{waStatus.info.chat_count ?? '—'}</div>
                </div>
              </div>
            )}

            {waStatus?.webhook && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10,
                border: `1px solid ${waStatus.webhook.healthy ? 'var(--border)' : 'var(--lose)'}`,
                background: 'var(--bg-overlay)', marginBottom: 16, fontFamily: 'var(--font-cond)', fontSize: 13,
              }}>
                <span>{waStatus.webhook.healthy ? '✅' : '⚠️'}</span>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    Webhook {waStatus.webhook.healthy ? 'ok' : 'com problema'} — {waStatus.webhook.enabled ? 'ativado' : 'desativado'}, eventos: {waStatus.webhook.events.join(', ') || 'nenhum'}
                  </div>
                  {!waStatus.webhook.healthy && (
                    <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 2 }}>
                      Se cair, palpite por WhatsApp para de responder sem avisar. Confere URL/eventos no manager Evolution.
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <button className="btn btn-sm" onClick={loadWaQr} disabled={waQrLoading}>
                {waQrLoading ? 'Gerando…' : '📷 Gerar QR Code'}
              </button>
            </div>

            {waQr && (
              <div style={{ textAlign: 'center', padding: 16, background: 'var(--bg-overlay)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 16 }}>
                <img src={waQr} alt="QR WhatsApp" style={{ width: 260, height: 260, borderRadius: 8 }} />
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
                  Escaneia com WhatsApp de um número dedicado (não usa número pessoal). Expira rápido — gera de novo se passar do tempo.
                </div>
              </div>
            )}

            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>
              apikey/URL/instância ficam em Config → chaves <code>whatsapp_*</code>.
            </div>
          </div>
        )}

        {waSubTab === 'conversas' && (
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title">🗨️ Conversas ativas{waChats?.length ? ` (${waChats.length})` : ''}</span>
              <button className="btn btn-sm" onClick={loadWaChats} disabled={waChatsLoading}>
                {waChatsLoading ? '…' : '↻'}
              </button>
            </div>
            {waChats?.length > 0 && (
              <input
                className="form-input" placeholder="Filtrar por nome…"
                value={waChatsQuery} onChange={e => setWaChatsQuery(e.target.value)}
                style={{ maxWidth: 280, marginBottom: 12 }}
              />
            )}
            {waChats?.length > 0 ? (
              <div style={{ maxHeight: 560, overflowY: 'auto', display: 'grid', gap: 8 }}>
                {waChats
                  .filter(c => !waChatsQuery.trim() || c.name?.toLowerCase().includes(waChatsQuery.trim().toLowerCase()))
                  .map(c => (
                  <div
                    key={c.id}
                    onClick={() => openChatThread({ jid: c.id, name: c.name })}
                    title="Ver conversa"
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px',
                      background: 'var(--bg-overlay)', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${c.unread_count > 0 ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    {c.profile_pic_url ? (
                      <img src={c.profile_pic_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, marginTop: 2 }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-raised)', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                        {c.is_group ? '👥' : '👤'}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        {c.is_group && <span style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 400, flexShrink: 0 }}>grupo</span>}
                        {c.matched_user_email && <span title={c.matched_user_email} style={{ fontSize: 10, color: 'var(--win)', flexShrink: 0 }}>✓ cadastrado</span>}
                        {c.unread_count > 0 && (
                          <span style={{ fontSize: 10, background: 'var(--accent)', color: '#000', borderRadius: 8, padding: '1px 6px', flexShrink: 0 }}>
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      {c.last_message_preview && (
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                          {c.last_message_from_me ? '➡️ ' : ''}{c.last_message_preview}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                        <span>{c.updated_at ? new Date(c.updated_at).toLocaleString('pt-BR') : '—'}</span>
                        {c.window_active === false && <span style={{ color: 'var(--lose)' }}>· janela 24h fechada</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                {waChatsLoading ? 'Carregando…' : 'Nenhuma conversa encontrada.'}
              </div>
            )}
          </div>
        )}

        {waSubTab === 'campanhas' && (
          <>
            {/* Envio de teste */}
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">✉️ Mensagem de teste</span>
              </div>
              <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
                <input
                  className="form-input" placeholder="Telefone (só dígitos, com DDI: 5511999999999)"
                  value={waTestPhone} onChange={e => setWaTestPhone(e.target.value)}
                />
                <textarea
                  className="form-input" rows={3} placeholder="Mensagem…"
                  value={waTestText} onChange={e => setWaTestText(e.target.value)}
                />
                <button className="btn btn-sm" onClick={sendWaTest} disabled={waSending || !waTestPhone || !waTestText} style={{ justifySelf: 'start' }}>
                  {waSending ? 'Enviando…' : 'Enviar teste'}
                </button>
              </div>
            </div>

            {/* Campanha / disparo em massa */}
            <div className="adm-card" style={{ marginTop: 16 }}>
              <div className="adm-card__header">
                <span className="adm-card__title">📢 Disparo em massa</span>
                <button className="btn btn-sm" onClick={loadWaCampaigns} disabled={waCampaignLoading}>
                  {waCampaignLoading ? '…' : '↻ Atualizar fila'}
                </button>
              </div>
              <div style={{ display: 'grid', gap: 10, maxWidth: 480, marginBottom: 16 }}>
                <textarea
                  className="form-input" rows={3} placeholder="Texto da campanha…"
                  value={waCampaignMsg} onChange={e => setWaCampaignMsg(e.target.value)}
                />
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: -6 }}>
                  {waCampaignMsg.length} caracteres
                </div>

                <div style={{ display: 'grid', gap: 6 }}>
                  {[
                    { id: 'opt_in', label: 'Só quem tem opt-in ativo', hint: 'recomendado' },
                    { id: 'no_bets', label: 'Opt-in + nunca apostou', hint: 'reengajamento' },
                    { id: 'all', label: 'Todos com telefone cadastrado', hint: '⚠️ ignora opt-in' },
                    { id: 'test', label: 'Só admins', hint: '🧪 teste do disparo' },
                  ].map(seg => (
                    <label key={seg.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13, cursor: 'pointer' }}>
                      <input type="radio" name="wa-campaign-segment" checked={waCampaignSegment === seg.id} onChange={() => changeWaCampaignSegment(seg.id)} />
                      {seg.label} <span style={{ color: 'var(--text-4)', fontSize: 11 }}>({seg.hint})</span>
                    </label>
                  ))}
                </div>

                <div style={{
                  fontFamily: 'var(--font-cond)', fontSize: 13, padding: '8px 12px', borderRadius: 8,
                  background: 'var(--bg-overlay)', border: '1px solid var(--border)',
                }}>
                  {waCampaignPreviewLoading ? 'Calculando destinatários…' : waCampaignPreview === 0 ? (
                    <span style={{ color: 'var(--lose)' }}>⚠️ Nenhum destinatário nesse segmento — troca o segmento ou espera mais gente ativar opt-in.</span>
                  ) : (
                    <>📤 Vai pra <b style={{ color: 'var(--accent)' }}>{waCampaignPreview ?? '—'}</b> destinatário(s)</>
                  )}
                </div>

                <button className="btn btn-sm" onClick={createWaCampaign} disabled={!waCampaignMsg.trim() || !waCampaignPreview} style={{ justifySelf: 'start' }}>
                  🚀 Criar e iniciar campanha
                </button>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                  Fila drena via cron a cada 1min, 1 msg por vez, delay 3-8s (anti-ban) — não é instantâneo.
                </div>
              </div>

              {waCampaigns?.length > 0 && (
                <div className="adm-table-wrap">
                <table className="adm-table" style={{ fontSize: 13 }}>
                  <thead><tr><th>#</th><th>Mensagem</th><th>Status</th><th>Enviado</th><th>Falhas</th><th>Criada</th><th>Ações</th></tr></thead>
                  <tbody>
                    {waCampaigns.map(c => (
                      <tr key={c.id}>
                        <td style={{ fontFamily: 'var(--font-data)', color: 'var(--text-3)' }}>{c.id}</td>
                        <td
                          style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                          title="Ver mensagem completa"
                          onClick={() => setWaDetail({ title: `Campanha #${c.id}`, body: c.message, meta: `${c.status} · ${c.sent}/${c.total} enviados · ${c.failed} falhas` })}
                        >{c.message}</td>
                        <td>{c.status}</td>
                        <td style={{ fontFamily: 'var(--font-data)' }}>{c.sent}/{c.total}</td>
                        <td style={{ fontFamily: 'var(--font-data)', color: c.failed > 0 ? 'var(--lose)' : 'var(--text-3)' }}>{c.failed}</td>
                        <td style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>{fmtShort(c.created_at)}</td>
                        <td style={{ display: 'flex', gap: 6 }}>
                          {c.status === 'running' && (
                            <button className="btn-ghost btn-sm" onClick={() => cancelWaCampaign(c.id)}>Cancelar</button>
                          )}
                          {c.failed > 0 && (
                            <button className="btn-ghost btn-sm" onClick={() => retryWaCampaign(c.id)}>Reenviar falhas</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </>
        )}

        {waSubTab === 'grupos' && (
          <>
            {/* Criar grupo */}
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">👥 Criar grupo</span>
              </div>
              <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
                <input
                  className="form-input" placeholder="Nome do grupo"
                  value={waGroupSubject} onChange={e => setWaGroupSubject(e.target.value)}
                />
                <textarea
                  className="form-input" rows={3} placeholder="Telefones, um por linha ou separados por vírgula"
                  value={waGroupPhones} onChange={e => setWaGroupPhones(e.target.value)}
                />
                <button className="btn btn-sm" onClick={createWaGroup} disabled={!waGroupSubject.trim() || !waGroupPhones.trim()} style={{ justifySelf: 'start' }}>
                  Criar grupo
                </button>
              </div>
            </div>

            {/* Grupos existentes */}
            <div className="adm-card" style={{ marginTop: 16 }}>
              <div className="adm-card__header">
                <span className="adm-card__title">📋 Grupos existentes</span>
                <button className="btn btn-sm" onClick={loadWaGroups} disabled={waGroupsLoading}>
                  {waGroupsLoading ? '…' : '↻'}
                </button>
              </div>
              <div style={{ padding: '4px 0 12px', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                ⭐ O grupo oficial recebe avisos automáticos: projeção 24h antes, lembrete 1h antes e resultado final de cada jogo.
              </div>
              {waGroups?.length > 0 ? (
                <div className="adm-table-wrap">
                <table className="adm-table" style={{ fontSize: 13 }}>
                  <thead><tr><th>Nome</th><th>Participantes</th><th>Criado</th><th>Oficial</th></tr></thead>
                  <tbody>
                    {waGroups.map(g => (
                      <tr
                        key={g.id}
                        style={{ cursor: 'pointer' }}
                        title="Ver participantes"
                        onClick={() => openGroupManage(g.id, g.subject)}
                      >
                        <td>{g.subject || '—'}{g.id === waOfficialJid && <span style={{ marginLeft: 6 }} title="Grupo oficial">⭐</span>}</td>
                        <td style={{ fontFamily: 'var(--font-data)' }}>{g.size ?? '—'}</td>
                        <td style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>{g.creation ? fmtShort(new Date(g.creation * 1000).toISOString()) : '—'}</td>
                        <td onClick={e => e.stopPropagation()}>
                          {g.id === waOfficialJid ? (
                            <button className="btn-ghost btn-sm btn-ghost--active" onClick={() => setOfficialGroup('')}>⭐ Oficial — remover</button>
                          ) : (
                            <button className="btn-ghost btn-sm" onClick={() => setOfficialGroup(g.id)}>Definir oficial</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ) : (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                  {waGroupsLoading ? 'Carregando…' : 'Nenhum grupo encontrado (ou instância desconectada).'}
                </div>
              )}
            </div>
          </>
        )}

        {waSubTab === 'sessoes' && (
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title">⏳ Sessões de aposta em aberto</span>
              <button className="btn btn-sm" onClick={loadWaSessions} disabled={waSessionsLoading}>
                {waSessionsLoading ? '…' : '↻'}
              </button>
            </div>
            {waSessions?.length > 0 ? (
              <div className="adm-table-wrap">
              <table className="adm-table" style={{ fontSize: 13 }}>
                <thead><tr><th>Telefone</th><th>Partida</th><th>Placar rascunho</th><th>Pênaltis</th><th>Status</th><th>Expira</th><th>Ações</th></tr></thead>
                <tbody>
                  {waSessions.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontFamily: 'var(--font-data)' }}>{s.phone}</td>
                      <td>{s.match || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)' }}>{s.draft_score}</td>
                      <td style={{ fontFamily: 'var(--font-data)' }}>{s.draft_et_winner_pick ? s.draft_et_winner_pick.toUpperCase() : '—'}</td>
                      <td style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                        {s.state === 'aguardando_penaltis' ? 'aguardando pênaltis' : s.state === 'aguardando_confirmacao' ? 'aguardando SIM' : s.state}
                      </td>
                      <td style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>{fmtShort(s.expires_at)}</td>
                      <td><button className="btn-ghost btn-sm" onClick={() => cancelWaSession(s.id)}>Cancelar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Nenhuma sessão aguardando confirmação.</div>
            )}
          </div>
        )}

        {waSubTab === 'mensagens' && (
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title">💬 Log de mensagens{waMessagesTotal != null ? ` (${waMessagesTotal})` : ''}</span>
              <button className="btn btn-sm" onClick={() => loadWaMessages()} disabled={waMessagesLoading}>
                {waMessagesLoading ? '…' : '↻'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                className="form-input" placeholder="Filtrar por telefone…"
                value={waMessagesPhone} onChange={e => setWaMessagesPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadWaMessages()}
                style={{ maxWidth: 260 }}
              />
              <button className="btn-ghost btn-sm" onClick={() => loadWaMessages()}>Buscar</button>
            </div>
            {waMessages?.length > 0 ? (
              <div style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'auto' }}>
                <table className="adm-table" style={{ fontSize: 13, minWidth: 560 }}>
                  <thead><tr><th></th><th>Telefone</th><th>Mensagem</th><th>Status</th><th>Quando</th></tr></thead>
                  <tbody>
                    {waMessages.map(m => (
                      <tr
                        key={m.id}
                        style={{ cursor: 'pointer' }}
                        title="Ver mensagem completa"
                        onClick={() => setWaDetail({ title: m.direction === 'inbound' ? `⬅️ Recebida de ${m.phone}` : `➡️ Enviada para ${m.phone}`, body: m.body, meta: `${m.status} · ${fmtShort(m.created_at)}` })}
                      >
                        <td>{m.direction === 'inbound' ? '⬅️' : '➡️'}</td>
                        <td style={{ fontFamily: 'var(--font-data)' }}>{m.phone}</td>
                        <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.body}</td>
                        <td style={{ color: m.status === 'failed' ? 'var(--lose)' : 'var(--text-3)' }}>{m.status}</td>
                        <td style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>{fmtShort(m.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Sem mensagens ainda.</div>
            )}
            {waMessages?.length > 0 && waMessagesTotal > waMessages.length && (
              <button className="btn-ghost btn-sm" onClick={() => loadWaMessages(true)} disabled={waMessagesLoading} style={{ marginTop: 12 }}>
                {waMessagesLoading ? 'Carregando…' : `Carregar mais (${waMessages.length}/${waMessagesTotal})`}
              </button>
            )}
          </div>
        )}

        {waSubTab === 'contatos' && (
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title">📇 Contatos (usuários com telefone){waContactsTotal != null ? ` (${waContactsTotal})` : ''}</span>
              <button className="btn btn-sm" onClick={() => loadWaContacts()} disabled={waContactsLoading}>
                {waContactsLoading ? '…' : '↻'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                className="form-input" placeholder="Buscar nome, email ou telefone…"
                value={waContactsQuery} onChange={e => setWaContactsQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadWaContacts()}
                style={{ maxWidth: 280 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-cond)', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={waContactsOptInOnly} onChange={e => setWaContactsOptInOnly(e.target.checked)} />
                Só opt-in
              </label>
              <button className="btn-ghost btn-sm" onClick={() => loadWaContacts()}>Buscar</button>
            </div>
            {waContacts?.length > 0 ? (
              <div style={{ maxHeight: 420, overflowY: 'auto', overflowX: 'auto' }}>
                <table className="adm-table" style={{ fontSize: 13, minWidth: 480 }}>
                  <thead><tr><th>Nome</th><th>Email</th><th>Telefone</th><th>Opt-in</th><th></th></tr></thead>
                  <tbody>
                    {waContacts.map(c => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td style={{ color: 'var(--text-3)' }}>{c.email}</td>
                        <td style={{ fontFamily: 'var(--font-data)' }}>{c.phone}</td>
                        <td>{c.whatsapp_opt_in ? '✅' : '—'}</td>
                        <td>
                          {c.phone && (
                            <button
                              className="btn-ghost btn-sm"
                              onClick={() => openChatThread({ phone: c.phone, name: c.name })}
                            >
                              💬 Mensagem
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Nenhum contato encontrado.</div>
            )}
            {waContacts?.length > 0 && waContactsTotal > waContacts.length && (
              <button className="btn-ghost btn-sm" onClick={() => loadWaContacts(true)} disabled={waContactsLoading} style={{ marginTop: 12 }}>
                {waContactsLoading ? 'Carregando…' : `Carregar mais (${waContacts.length}/${waContactsTotal})`}
              </button>
            )}
          </div>
        )}

        {waSubTab === 'apostas' && (() => {
          const cutoffs = { today: 1, '7d': 7, '30d': 30 }
          const cutoff = cutoffs[waBetsPeriod]
            ? Date.now() - cutoffs[waBetsPeriod] * 24 * 60 * 60 * 1000
            : null
          const visible = (waBets || []).filter(b =>
            !cutoff || new Date(normalizeDate(b.created_at)).getTime() >= cutoff
          )
          // agrupa por partida preservando ordem (endpoint já vem mais recente primeiro)
          const groups = []
          const byMatch = {}
          for (const b of visible) {
            if (!byMatch[b.match]) { byMatch[b.match] = { match: b.match, bets: [] }; groups.push(byMatch[b.match]) }
            byMatch[b.match].bets.push(b)
          }
          return (
            <div className="adm-card">
              <div className="adm-card__header" style={{ flexWrap: 'wrap', gap: 8 }}>
                <span className="adm-card__title">
                  🎯 Apostas via chat WhatsApp — {visible.length} palpite(s) em {groups.length} partida(s)
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[['all', 'Tudo'], ['today', '24h'], ['7d', '7 dias'], ['30d', '30 dias']].map(([id, label]) => (
                    <button
                      key={id}
                      className={`btn-ghost btn-sm${waBetsPeriod === id ? ' btn-ghost--active' : ''}`}
                      onClick={() => setWaBetsPeriod(id)}
                    >
                      {label}
                    </button>
                  ))}
                  <button className="btn btn-sm" onClick={() => loadWaBets()} disabled={waBetsLoading}>
                    {waBetsLoading ? '…' : '↻'}
                  </button>
                </div>
              </div>
              {groups.length > 0 ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {groups.map((g, idx) => {
                    const open = waBetsOpen[g.match] ?? idx === 0
                    const scoreCount = {}
                    g.bets.forEach(b => {
                      const s = (b.score || '?').replace('-', 'x')
                      scoreCount[s] = (scoreCount[s] || 0) + 1
                    })
                    const topScore = Object.entries(scoreCount).sort((a, b) => b[1] - a[1])[0]
                    const teams = g.match.split(' x ')
                    return (
                      <div key={g.match} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                        <button
                          onClick={() => setWaBetsOpen({ ...waBetsOpen, [g.match]: !open })}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                            width: '100%', padding: '10px 12px', background: 'var(--bg-overlay)',
                            border: 0, cursor: 'pointer', color: 'var(--text-1)', textAlign: 'left',
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>⚽ {g.match}</span>
                          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                            {g.bets.length} palpite(s)
                            {topScore ? <> · mais apostado: <b style={{ color: 'var(--accent)' }}>{topScore[0]}</b> ({topScore[1]})</> : null}
                            {' '}{open ? '▲' : '▼'}
                          </span>
                        </button>
                        {open && (
                          <div style={{ overflowX: 'auto' }}>
                            <table className="adm-table" style={{ fontSize: 13, minWidth: 560 }}>
                              <thead><tr><th>Usuário</th><th>Telefone</th><th>Placar</th><th>Se empatar, avança</th><th>Quando</th></tr></thead>
                              <tbody>
                                {g.bets.map(b => (
                                  <tr key={b.id}>
                                    <td>
                                      {b.user_name || '—'}
                                      {b.user_email ? <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{b.user_email}</div> : null}
                                    </td>
                                    <td style={{ fontFamily: 'var(--font-data)' }}>{b.phone || '—'}</td>
                                    <td style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)', fontWeight: 600 }}>{(b.score || '—').replace('-', 'x')}</td>
                                    <td>{b.et_winner_pick ? (teams[b.et_winner_pick === 'a' ? 0 : 1] || b.et_winner_pick.toUpperCase()) : '—'}</td>
                                    <td style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>{fmtShort(b.created_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                  {waBetsLoading ? 'Carregando…' : (waBets?.length ? 'Nenhum palpite no período selecionado.' : 'Nenhuma aposta feita pelo chat ainda.')}
                </div>
              )}
            </div>
          )
        })()}

        {waSubTab === 'meta' && (
          <>
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">📘 WhatsApp Oficial (Meta Cloud API) — em paralelo</span>
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 10px' }}>
                  Roda separado do bot atual (Evolution/Baileys) — não substitui, não mexe no número já em uso.
                  Pra pegar as credenciais:
                </p>
                <ol style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  <li>Cria um app em <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>developers.facebook.com</a>, tipo "Business"</li>
                  <li>Adiciona o produto <b>WhatsApp</b> ao app (Meta já dá um número de teste temporário)</li>
                  <li>No painel do produto WhatsApp, copia <b>Temporary access token</b>, <b>Phone number ID</b> e <b>WhatsApp Business Account ID</b></li>
                  <li>Cola nos campos abaixo e salva</li>
                </ol>
                <p style={{ margin: 0, color: 'var(--text-4)', fontSize: 12 }}>
                  Token temporário expira em ~24h — pra produção precisa de token permanente (System User) e verificação de negócio, que leva dias.
                </p>
              </div>
            </div>

            <div className="adm-card" style={{ marginTop: 16 }}>
              <div className="adm-card__header">
                <span className="adm-card__title">🔑 Credenciais</span>
              </div>
              <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={metaEnabled} onChange={e => setMetaEnabled(e.target.checked)} />
                  Ativar WhatsApp Oficial
                </label>

                <div>
                  <label className="form-label" style={{ fontSize: 11 }}>Access Token</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input" type={showMetaToken ? 'text' : 'password'}
                      value={metaToken} onChange={e => setMetaToken(e.target.value)}
                      placeholder="EAAxxxxxxxx…" style={{ flex: 1 }}
                    />
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setShowMetaToken(s => !s)}>
                      {showMetaToken ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11 }}>Phone Number ID</label>
                  <input className="form-input" value={metaPhoneId} onChange={e => setMetaPhoneId(e.target.value)} placeholder="1234567890" />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11 }}>WhatsApp Business Account ID</label>
                  <input className="form-input" value={metaWabaId} onChange={e => setMetaWabaId(e.target.value)} placeholder="1234567890" />
                </div>

                <div>
                  <label className="form-label" style={{ fontSize: 11 }}>Verify Token (webhook)</label>
                  <input
                    className="form-input" value={metaVerifyToken} onChange={e => setMetaVerifyToken(e.target.value)}
                    placeholder="cria uma palavra secreta qualquer"
                  />
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                    Você inventa essa string e cola na configuração do webhook lá no Meta também (precisa bater dos dois lados).
                  </div>
                </div>

                {metaMsg && (
                  <p style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: metaMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                    {metaMsg}
                  </p>
                )}

                <button className="btn btn-sm" onClick={saveMetaConfig} disabled={metaSaving} style={{ justifySelf: 'start' }}>
                  {metaSaving ? 'Salvando…' : 'Salvar credenciais'}
                </button>
              </div>
            </div>
          </>
        )}

        {waDetail && (
          <div
            onClick={() => setWaDetail(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9700,
              background: 'rgba(3,8,14,0.75)', backdropFilter: 'blur(5px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="fade-in-1"
              style={{
                width: '100%', maxWidth: 420, maxHeight: '80vh', overflowY: 'auto',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.6)', padding: 'var(--s5)',
              }}
            >
              <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)', marginBottom: 4 }}>
                {waDetail.title}
              </div>
              {waDetail.meta && (
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginBottom: 12 }}>
                  {waDetail.meta}
                </div>
              )}
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {waDetail.body}
              </div>
              <button className="btn-ghost btn-sm" onClick={() => setWaDetail(null)} style={{ marginTop: 16 }}>Fechar</button>
            </div>
          </div>
        )}

        {waThread && (
          <div
            onClick={() => setWaThread(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9700,
              background: 'rgba(3,8,14,0.75)', backdropFilter: 'blur(5px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="fade-in-1"
              style={{
                width: '100%', maxWidth: 480, height: '80vh', display: 'flex', flexDirection: 'column',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 'var(--s4)', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>
                  💬 {waThread.name || waThread.jid}
                </span>
                <button className="btn-ghost btn-sm" onClick={() => setWaThread(null)}>✕</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {waThread.loading && (
                  <div style={{ textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando…</div>
                )}
                {!waThread.loading && waThread.messages?.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Sem mensagens nessa conversa.</div>
                )}
                {waThread.messages?.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: m.from_me ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '78%', padding: '8px 12px', borderRadius: 12,
                      background: m.from_me ? 'var(--accent)' : 'var(--bg-overlay)',
                      color: m.from_me ? '#000' : 'var(--text-1)',
                      border: m.from_me ? 'none' : '1px solid var(--border)',
                      fontFamily: 'var(--font-cond)', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.4,
                    }}>
                      {m.text}
                      {m.timestamp && (
                        <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4, textAlign: 'right' }}>
                          {new Date(m.timestamp * 1000).toLocaleString('pt-BR')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {waThread.error && (
                <div style={{ padding: '0 var(--s4)', color: 'var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>
                  ✗ {waThread.error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, padding: 'var(--s4)', borderTop: '1px solid var(--border)' }}>
                <input
                  className="form-input"
                  placeholder="Escreve uma mensagem…"
                  value={waThread.draft}
                  onChange={e => setWaThread(t => ({ ...t, draft: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && sendChatReply()}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-sm" onClick={sendChatReply} disabled={waThread.sending || !waThread.draft?.trim()}>
                  {waThread.sending ? '…' : 'Enviar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {waGroupManage && (
          <div
            onClick={() => setWaGroupManage(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 9700,
              background: 'rgba(3,8,14,0.75)', backdropFilter: 'blur(5px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="fade-in-1"
              style={{
                width: '100%', maxWidth: 460, maxHeight: '85vh', overflowY: 'auto',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.6)', padding: 'var(--s5)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>
                  👥 Gerenciar grupo
                </span>
                <button className="btn-ghost btn-sm" onClick={() => setWaGroupManage(null)}>✕</button>
              </div>

              {waGroupManage.error && (
                <div style={{ marginBottom: 12, color: 'var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>
                  ✗ {waGroupManage.error}
                </div>
              )}

              <div style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>Nome do grupo</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="form-input" value={waGroupManage.subjectDraft}
                    onChange={e => setWaGroupManage(g => ({ ...g, subjectDraft: e.target.value }))}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-sm" onClick={saveGroupSubject}
                    disabled={waGroupManage.busy || !waGroupManage.subjectDraft?.trim() || waGroupManage.subjectDraft === waGroupManage.subject}
                  >Salvar</button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
                <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>Descrição</label>
                <textarea
                  className="form-input" rows={2} value={waGroupManage.descriptionDraft}
                  onChange={e => setWaGroupManage(g => ({ ...g, descriptionDraft: e.target.value }))}
                  placeholder="Descrição do grupo…"
                />
                <button className="btn btn-sm" onClick={saveGroupDescription} disabled={waGroupManage.busy} style={{ justifySelf: 'start' }}>
                  Salvar descrição
                </button>
              </div>

              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', marginBottom: 6 }}>
                Participantes {waGroupManage.participants ? `(${waGroupManage.participants.length})` : ''}
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 6, marginBottom: 16 }}>
                {waGroupManage.loading && (
                  <div style={{ textAlign: 'center', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando…</div>
                )}
                {waGroupManage.participants?.map(p => (
                  <div key={p.phone} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', background: 'var(--bg-overlay)', borderRadius: 8, border: '1px solid var(--border)',
                  }}>
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 13 }}>
                      {p.phone}
                      {p.admin && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-4)' }}>({p.admin === 'superadmin' ? 'dono' : 'admin'})</span>}
                    </span>
                    <button className="btn-ghost btn-sm" disabled={waGroupManage.busy} onClick={() => removeGroupParticipant(p.phone)}>Remover</button>
                  </div>
                ))}
              </div>

              <button className="btn-ghost btn-sm" disabled={waGroupManage.busy} onClick={doLeaveGroup} style={{ color: 'var(--lose)' }}>
                🚪 Sair do grupo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
