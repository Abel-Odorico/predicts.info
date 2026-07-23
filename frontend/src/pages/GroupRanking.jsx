import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import { COMPETITIONS } from '../utils/competitions'
import { aproveitamento, getBadges, BADGE_CATALOG } from '../utils/groupBadges'
import { displayName } from '../utils/displayName'
import RankingNameToggle from '../components/RankingNameToggle'
import TeamCrestFlag from '../components/TeamCrestFlag'
import MedalIcon from '../components/MedalIcon'
import GroupFeatureConfig from '../components/GroupFeatureConfig'
import GroupClassificationBonus from '../components/GroupClassificationBonus'
import GroupDoubleMatchBadge from '../components/GroupDoubleMatchBadge'
import GroupLanterna from '../components/GroupLanterna'
import GroupPeriodRanking from '../components/GroupPeriodRanking'
import GroupRulesModal from '../components/GroupRulesModal'

// Partição por competição também — sem isso, trocar de aba (Geral/Copa/Brasileirão)
// lê/grava o snapshot errado, já que cada aba tem um ranking e ordem diferentes.
const POSITION_STORE_KEY = (id, comp) => `predicts_group_positions_${id}_${comp}`
const PHASE_LABELS = {
  all: 'Geral', group: 'Fase de Grupos', r16: 'Oitavas', qf: 'Quartas', sf: 'Semifinal', final: 'Final', '3rd': '3º Lugar',
}
const LINE_COLORS = ['#0fa896', '#e8a030', '#e85252', '#9b5de8', '#4a90e8', '#25D366', '#ff6b35', '#c43c97']

function todayStr() {
  const now = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
function buildShareText(groupName, ranking, finished, total, inviteLink) {
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
  const rows = ranking.slice(0, 5).map((r, i) =>
    `${medal(i)} ${r.name} — ${r.total_points} pts (${r.exact_scores} exatos)`
  ).join('\n')
  const link = inviteLink || 'https://predicts.info'
  return `🏆 *${groupName} — Ranking do Bolão*\n\n${rows}\n\n⚽ ${finished}/${total} jogos realizados\n\n🎯 Entre no grupo: ${link}`
}
function loadSavedPositions(groupId, comp) {
  try {
    const raw = localStorage.getItem(POSITION_STORE_KEY(groupId, comp))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function savePositions(groupId, comp, ranking) {
  try {
    const map = {}
    ranking.forEach((r, i) => { map[r.user_id] = i + 1 })
    localStorage.setItem(POSITION_STORE_KEY(groupId, comp), JSON.stringify({ date: todayStr(), positions: map }))
  } catch {}
}

function useCountdown(targetDateStr) {
  const [time, setTime] = useState({ hours: 0, minutes: 0, seconds: 0, urgent: false })
  const ref = useRef(null)
  useEffect(() => {
    if (!targetDateStr) return
    function tick() {
      const diff = new Date(targetDateStr) - new Date()
      if (diff <= 0) { setTime({ hours: 0, minutes: 0, seconds: 0, urgent: true }); return }
      const totalSec = Math.floor(diff / 1000)
      const hours = Math.floor(totalSec / 3600)
      const minutes = Math.floor((totalSec % 3600) / 60)
      const seconds = totalSec % 60
      setTime({ hours, minutes, seconds, urgent: hours === 0 && minutes < 30 })
    }
    tick()
    ref.current = setInterval(tick, 1000)
    return () => clearInterval(ref.current)
  }, [targetDateStr])
  return time
}

export default function GroupRanking() {
  const { groupId } = useParams()
  const { token, user } = useAuth()
  const namePref = user?.ranking_display_pref === 'username' ? 'username' : 'name'

  // ── Core state ─────────────────────────────────────────────
  const [data, setData] = useState(null)
  const [matchStats, setMatchStats] = useState({ finished: 0, total: 0 })
  const [todayTop, setTodayTop] = useState(null)
  const [todayPts, setTodayPts] = useState({})
  const [highlights, setHighlights] = useState(null)
  const [prevPositions, setPrevPos] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])

  // ── Competição: Geral (soma bruta, curiosidade) / Copa / Brasileirão (pódio real) ──
  // Default Brasileirão (não Geral) — é onde mora o ranking oficial e as mecânicas
  // extras do bolão, mesmo padrão já usado em Ranking.jsx desde a reposição pós-Copa.
  const [comp, setComp] = useState('brasileirao2026')

  // ── Invite & share ─────────────────────────────────────────
  const [inviteLink, setInviteLink] = useState('')
  const [linkLoading, setLinkLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [showQr, setShowQr] = useState(false)
  const [qrEnlarged, setQrEnlarged] = useState(false)
  const personalLink = inviteLink && user?.id ? `${inviteLink}?by=${user.id}` : inviteLink

  // ── Pedidos de entrada pendentes (link de membro que não é o dono) ──────────
  const [joinRequests, setJoinRequests] = useState([])
  const [showJoinRequestsModal, setShowJoinRequestsModal] = useState(false)
  const [joinReqActionId, setJoinReqActionId] = useState(null)

  useEffect(() => {
    if (!qrEnlarged) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [qrEnlarged])

  useEffect(() => {
    if (!showJoinRequestsModal) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [showJoinRequestsModal])

  // ── Owner actions ───────────────────────────────────────────
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameMsg, setRenameMsg] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const [duelMember, setDuelMember] = useState(null)

  // ── Phase ranking ───────────────────────────────────────────
  const [activePhase, setActivePhase] = useState('all')
  const [phaseRanking, setPhaseRanking] = useState(null)
  const [phaseLoading, setPhaseLoading] = useState(false)

  // ── Apostas reveladas ───────────────────────────────────────
  const [recentMatches, setRecentMatches] = useState([])
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [matchBets, setMatchBets] = useState([])
  const [matchBetsLoading, setMatchBetsLoading] = useState(false)

  // ── Atividade do grupo (semana/mês/mais ativos/última rodada) ──
  const [activityTab, setActivityTab] = useState('semana')

  // ── Guia de página: Ranking (pódio+tabela) vs Estatísticas (engajamento) ──
  const [showStats, setShowStats] = useState(false)

  // ── Champion pick ───────────────────────────────────────────
  const [championPicks, setChampionPicks] = useState([])
  const [showChampionPicker, setShowChampionPicker] = useState(false)
  const [championSearch, setChampionSearch] = useState('')
  const [savingChampion, setSavingChampion] = useState(false)

  // ── Evolution chart ─────────────────────────────────────────
  const [evolution, setEvolution] = useState(null)
  const [showEvolution, setShowEvolution] = useState(false)

  // ── Expanded row ────────────────────────────────────────────
  const [expandedUserId, setExpandedUserId] = useState(null)

  // ── Mecânicas extras de bolão (passos 13-17, só Brasileirão) ───
  const [featureConfig, setFeatureConfig] = useState(null)
  const [brTeams, setBrTeams] = useState([])
  const [brCurrentRodada, setBrCurrentRodada] = useState(null)
  const [showFeatureConfig, setShowFeatureConfig] = useState(false)
  const [showRules, setShowRules] = useState(false)

  // ── Chat ────────────────────────────────────────────────────
  const [messages, setMessages] = useState([])
  const [msgText, setMsgText] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const chatEndRef = useRef(null)
  const chatOpenedRef = useRef(false)
  const chatPollRef = useRef(null)
  // Garante que o snapshot de posições anteriores só é lido UMA VEZ por grupo nesta
  // visita — sem isso, uma segunda chamada de load() (ex: token rehidratando de forma
  // assíncrona do zustand persist) relia o localStorage DEPOIS que a 1ª chamada já
  // tinha sobrescrito com a posição atual, zerando sempre o delta de progresso.
  const positionsReadRef = useRef(null)

  const today = todayStr()

  // ── Primary load ────────────────────────────────────────────
  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    const positionsKey = `${groupId}:${comp}`
    if (positionsReadRef.current !== positionsKey) {
      const saved = loadSavedPositions(groupId, comp)
      setPrevPos(saved ? saved.positions : null)
      positionsReadRef.current = positionsKey
    }

    // allSettled: falha parcial não cancela os outros dados
    Promise.allSettled([
      api.get(`/user-groups/${groupId}/ranking?competition=${comp}`, token),
      api.get('/matches'),
      api.get(`/ranking?date_from=${today}&date_to=${today}&limit=100`),
    ]).then(([rankRes, matchRes, todayRes]) => {
      if (rankRes.status === 'rejected') {
        setError(rankRes.reason?.message || 'Erro ao carregar ranking')
        return
      }
      const groupData = rankRes.value
      setData(groupData)
      if (groupData.is_owner) {
        api.get(`/user-groups/${groupId}/join-requests`, token)
          .then(list => {
            setJoinRequests(list)
            if (list.length > 0) setShowJoinRequestsModal(true)
          })
          .catch(() => {})
      }
      if (matchRes.status === 'fulfilled') {
        const matches = matchRes.value ?? []
        const finished = matches.filter(m => m.status === 'finished').length
        setMatchStats({ finished, total: matches.length })
        const teamMap = {}
        matches.forEach(m => {
          if (m.team_a) teamMap[m.team_a.id] = m.team_a
          if (m.team_b) teamMap[m.team_b.id] = m.team_b
        })
        setTeams(Object.values(teamMap).sort((a, b) => a.name.localeCompare(b.name)))
      }
      if (todayRes.status === 'fulfilled') {
        const todayRanking = todayRes.value ?? []
        const memberIds = new Set((groupData.ranking ?? []).map(r => r.user_id))
        const groupToday = todayRanking
          .filter(r => memberIds.has(r.user_id))
          .sort((a, b) => b.total_points - a.total_points)
        setTodayTop(groupToday[0] || null)
        setTodayPts(Object.fromEntries(groupToday.map(r => [r.user_id, r.total_points])))
      }
      savePositions(groupId, comp, groupData.ranking ?? [])
    }).finally(() => setLoading(false))

    // Secondary fetches (non-blocking) — highlights independente do load principal.
    // highlights/recent-matches/evolution só existem por competição real (Copa/Brasileirão) —
    // "geral" é soma bruta sem endpoint próprio, então nem dispara a chamada (evita 404 garantido).
    if (comp !== 'geral') {
      api.get(`/user-groups/${groupId}/highlights?competition=${comp}`, token).catch(() => null).then(setHighlights)
      api.get(`/user-groups/${groupId}/recent-matches?competition=${comp}`, token).catch(() => []).then(setRecentMatches)
      api.get(`/user-groups/${groupId}/evolution?competition=${comp}`, token).catch(() => null).then(setEvolution)
    } else {
      setHighlights(null)
      setRecentMatches([])
      setEvolution(null)
    }
    api.get(`/user-groups/${groupId}/champion`, token).catch(() => []).then(setChampionPicks)
    api.get(`/user-groups/${groupId}/messages`, token).catch(() => []).then(setMessages)

    // Mecânicas extras (passos 13-17) — hoje só existem pro Brasileirão (plan.md,
    // fora de escopo pra Copa), mas o ACESSO à configuração fica na home do grupo,
    // não preso à aba — pra quando outras competições ganharem mecânicas próprias.
    // feature-config é legível por qualquer membro (não só dono).
    api.get(`/user-groups/${groupId}/feature-config`, token).catch(() => null).then(setFeatureConfig)
    api.get('/brasileirao/standings').catch(() => null).then(res => {
      setBrTeams(res?.table ?? [])
      setBrCurrentRodada(res?.current_rodada ?? null)
    })
  }, [groupId, token, today, comp])

  useEffect(() => { load() }, [load])

  // ── Chat polling ────────────────────────────────────────────
  useEffect(() => {
    if (!token || !showChat) return
    chatPollRef.current = setInterval(() => {
      api.get(`/user-groups/${groupId}/messages`, token).catch(() => null).then(msgs => {
        if (msgs) setMessages(msgs)
      })
    }, 10000)
    return () => clearInterval(chatPollRef.current)
  }, [groupId, token, showChat])

  useEffect(() => {
    if (showChat) chatOpenedRef.current = true
  }, [showChat])

  useEffect(() => {
    if (showChat && chatOpenedRef.current && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, showChat])

  // ── QR Code generation ──────────────────────────────────────
  useEffect(() => {
    if (!personalLink) return
    QRCode.toDataURL(personalLink, { width: 260, margin: 1, color: { dark: '#0c1a2a', light: '#f5f7fb' } })
      .then(setQrDataUrl).catch(() => {})
  }, [personalLink])

  // Aba de fases só existe na Copa — trocar de competição sem resetar deixava o
  // ranking de fase antigo (ex: Semi) preso e exibido por baixo do pano na aba nova.
  useEffect(() => { setActivePhase('all') }, [comp])
  useEffect(() => { if (comp === 'geral') setShowStats(false) }, [comp])

  // ── Phase ranking ───────────────────────────────────────────
  useEffect(() => {
    if (!token || activePhase === 'all') { setPhaseRanking(null); return }
    setPhaseLoading(true)
    api.get(`/user-groups/${groupId}/ranking-phase?phase=${activePhase}`, token)
      .then(setPhaseRanking).catch(() => setPhaseRanking(null))
      .finally(() => setPhaseLoading(false))
  }, [groupId, token, activePhase])

  // ── Match bets (apostas reveladas) ──────────────────────────
  useEffect(() => {
    if (!selectedMatch) return
    setMatchBetsLoading(true)
    api.get(`/user-groups/${groupId}/matches/${selectedMatch.id}/bets`, token)
      .then(setMatchBets).catch(() => setMatchBets([]))
      .finally(() => setMatchBetsLoading(false))
  }, [groupId, token, selectedMatch])

  // ── Actions ─────────────────────────────────────────────────
  const nextMatchDate = highlights?.next_match?.match_date
  const countdown = useCountdown(nextMatchDate)

  async function generateLink() {
    setLinkLoading(true)
    try {
      const res = await api.post(`/user-groups/${groupId}/invite-link`, {}, token)
      setInviteLink(`${window.location.origin}/bolao/${res.token}`)
    } catch (e) { setError(e.message) }
    finally { setLinkLoading(false) }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(personalLink); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }
  async function shareLink() {
    if (navigator.share) await navigator.share({ title: data?.group_name, url: personalLink })
    else copyLink()
  }
  async function saveRename(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSavingName(true); setRenameMsg('')
    try {
      const res = await api.put(`/user-groups/${groupId}`, { name: newName.trim() }, token)
      setData(d => ({ ...d, group_name: res.name }))
      setRenaming(false)
    } catch (err) { setRenameMsg(`✗ ${err.message}`) }
    finally { setSavingName(false) }
  }
  async function removeMember(userId) {
    if (!window.confirm('Remover este membro do grupo?')) return
    setRemovingId(userId)
    try {
      await api.delete(`/user-groups/${groupId}/members/${userId}`, token)
      setData(d => ({ ...d, ranking: d.ranking.filter(r => r.user_id !== userId) }))
    } catch (err) { setError(err.message) }
    finally { setRemovingId(null) }
  }
  async function approveJoinRequest(reqId) {
    if (!window.confirm('Aceitar esse pedido de entrada no grupo?')) return
    setJoinReqActionId(reqId)
    try {
      await api.post(`/user-groups/${groupId}/join-requests/${reqId}/approve`, {}, token)
      setJoinRequests(list => list.filter(r => r.id !== reqId))
      load()
    } catch (err) { setError(err.message) }
    finally { setJoinReqActionId(null) }
  }
  async function rejectJoinRequest(reqId) {
    if (!window.confirm('Recusar esse pedido de entrada? Essa ação não pode ser desfeita.')) return
    setJoinReqActionId(reqId)
    try {
      await api.post(`/user-groups/${groupId}/join-requests/${reqId}/reject`, {}, token)
      setJoinRequests(list => list.filter(r => r.id !== reqId))
    } catch (err) { setError(err.message) }
    finally { setJoinReqActionId(null) }
  }
  function copyShareText() {
    const text = buildShareText(data.group_name, ranking, matchStats.finished, matchStats.total, personalLink)
    navigator.clipboard.writeText(text).then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000) })
  }
  function shareWhatsApp() {
    const text = buildShareText(data.group_name, ranking, matchStats.finished, matchStats.total, personalLink)
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }
  async function pickChampion(teamId) {
    setSavingChampion(true)
    try {
      await api.post(`/user-groups/${groupId}/champion`, { team_id: teamId }, token)
      const picks = await api.get(`/user-groups/${groupId}/champion`, token)
      setChampionPicks(picks)
      setShowChampionPicker(false)
    } catch (e) { alert(e.message) }
    finally { setSavingChampion(false) }
  }
  async function sendMessage(e) {
    e.preventDefault()
    if (!msgText.trim() || sendingMsg) return
    setSendingMsg(true)
    try {
      const msg = await api.post(`/user-groups/${groupId}/messages`, { content: msgText.trim() }, token)
      setMessages(prev => [...prev, msg])
      setMsgText('')
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (err) { alert(err.message) }
    finally { setSendingMsg(false) }
  }

  if (!token) return (
    <div className="page"><div className="bet-empty fade-in-1">
      <p className="page-subtitle">Faça login para ver o ranking do grupo.</p>
      <Link to="/login" className="btn btn-primary btn-lg" style={{ marginTop: 'var(--s6)' }}>Entrar</Link>
    </div></div>
  )
  if (loading) return <Spinner text="Carregando ranking do grupo..." />
  if (error) return (
    <div className="page"><div className="card fade-in-1"><div className="card__body">
      <p className="page-subtitle" style={{ margin: 0 }}>{error}</p>
      <Link to="/meus-grupos" className="btn btn-primary btn-sm mt-4">Voltar</Link>
    </div></div></div>
  )

  const ranking = data?.ranking ?? []
  const amOwner = data?.is_owner === true
  const myEntry = ranking.find(r => r.is_me)

  // Notificação de progresso pessoal — dado real já salvo (prevPositions, localStorage,
  // atualizado a cada load em `savePositions`): compara a posição desta visita com a anterior.
  const myPrevPos = myEntry ? prevPositions?.[myEntry.user_id] : null
  const myPosDelta = (myPrevPos && myPrevPos !== myEntry?.position) ? myPrevPos - myEntry.position : 0
  const passedMeBy = myEntry ? ranking.filter((r, i) => {
    if (r.user_id === myEntry.user_id) return false
    const rPrevPos = prevPositions?.[r.user_id]
    if (!rPrevPos || !myPrevPos) return false
    const rCurPos = i + 1
    return rPrevPos > myPrevPos && rCurPos < myEntry.position
  }) : []
  const champion = data?.champion ?? null
  const championBonusPts = data?.champion_bonus_pts ?? 0
  const leaderPts = ranking[0]?.effective_points ?? ranking[0]?.total_points ?? 1
  const { finished, total } = matchStats
  const maxBets = ranking.length ? Math.max(...ranking.map(r => r.total_bets)) : 0
  const effectiveTotal = Math.max(finished, maxBets, 1)
  const streakMap = Object.fromEntries((highlights?.streaks ?? []).map(s => [s.user_id, s.streak]))
  const recentForm = highlights?.recent_form ?? {}
  const muralHeroName = highlights?.top_bets?.[0]?.user_name
  const groupLevel = highlights?.group_level ?? 1
  const groupXp = highlights?.group_xp ?? 0
  const nextLevelXp = highlights?.next_level_xp ?? 500
  const xpPct = Math.min(100, Math.round((groupXp % 500) / 5))
  const topBets = highlights?.top_bets ?? []
  const weeklyRanking = highlights?.weekly_ranking ?? []
  const monthlyRanking = highlights?.monthly_ranking ?? []
  const bestApproval = highlights?.best_approval ?? null
  const weekLeader = weeklyRanking[0] ?? null
  const memberRecentBets = highlights?.member_recent_bets ?? {}

  // Mais ativos — quem mais apostou no total (dado já presente em `ranking`)
  const mostActiveRanking = [...ranking].filter(r => (r.total_bets ?? 0) > 0).sort((a, b) => (b.total_bets ?? 0) - (a.total_bets ?? 0))

  // Última rodada — cruza a partida finalizada mais recente (recentMatches[0]) com
  // as apostas recentes de cada membro pra saber quem apostou e quem não apostou nela.
  const lastFinishedMatch = recentMatches[0] ?? null
  const lastRoundBetUserIds = lastFinishedMatch
    ? new Set(ranking.filter(r => (memberRecentBets[String(r.user_id)] ?? []).some(b =>
        b.match_date === lastFinishedMatch.match_date &&
        b.team_a?.code === lastFinishedMatch.team_a?.code &&
        b.team_b?.code === lastFinishedMatch.team_b?.code
      )).map(r => r.user_id))
    : new Set()
  const lastRoundBet = lastFinishedMatch ? ranking.filter(r => lastRoundBetUserIds.has(r.user_id)) : []
  const lastRoundNotBet = lastFinishedMatch ? ranking.filter(r => !lastRoundBetUserIds.has(r.user_id)) : []
  const leaderPtsTotal = ranking[0]?.total_points ?? 0
  const padTime = n => String(n).padStart(2, '0')
  const myChampionPick = championPicks.find(p => p.is_me)
  const availablePhases = ['all', 'group', 'r16', 'qf', 'sf', 'final']
  const displayRanking = (activePhase !== 'all' && phaseRanking) ? phaseRanking : ranking
  const top3 = displayRanking.slice(0, 3)
  const filteredTeams = teams.filter(t =>
    !championSearch || t.name.toLowerCase().includes(championSearch.toLowerCase()) || t.code.toLowerCase().includes(championSearch.toLowerCase())
  )

  // Conquistas de todos os membros (mesma função já usada por linha da tabela) — reaproveitado
  // aqui só pra saber quais o usuário já tem e quantos do grupo têm cada uma.
  // Usa `ranking` (geral, nunca filtrado), não `displayRanking`: com um filtro de fase ativo,
  // displayRanking vira phaseRanking, que só lista quem apostou NAQUELA fase — um membro sem
  // aposta na fase filtrada sumiria do cálculo e o painel mostraria "0 conquistas" errado pra ele.
  const allMemberBadges = ranking.map((r, i) => ({
    user_id: r.user_id,
    badges: getBadges(r, i + 1, effectiveTotal, todayTop?.user_id === r.user_id, streakMap[r.user_id] || 0, muralHeroName === r.name),
  }))
  // Chave por ÍCONE, não por label — o badge de sequência tem label dinâmico ("7 seguidos"),
  // que nunca bateria com o nome fixo "Sequência" da legenda abaixo.
  const myBadgeIcons = new Set(
    (allMemberBadges.find(m => m.user_id === myEntry?.user_id)?.badges ?? []).map(b => b.icon)
  )
  const badgeHolderCount = {}
  allMemberBadges.forEach(m => m.badges.forEach(b => { badgeHolderCount[b.icon] = (badgeHolderCount[b.icon] || 0) + 1 }))

  return (
    <div className="page">

      {/* ── Cabeçalho ── */}
      <div className="fade-in-1">
        <Link to="/meus-grupos" className="match-breadcrumb__link">‹ Meus Grupos</Link>
        <div className="page-hero" style={{ marginTop: 'var(--s4)' }}>
          <div className="page-hero__main">
            <div className="page-hero__icon">
              {myEntry?.position >= 1 && myEntry?.position <= 3 ? <MedalIcon rank={myEntry.position} size={28} /> : '🏆'}
            </div>
            <div className="page-hero__text">
              {renaming ? (
                <form onSubmit={saveRename} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="text" className="form-input" value={newName} autoFocus maxLength={120} onChange={e => setNewName(e.target.value)} style={{ minWidth: 180 }} />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={savingName}>{savingName ? '...' : 'Salvar'}</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRenaming(false); setRenameMsg('') }}>Cancelar</button>
                  {renameMsg && <span style={{ fontSize: 12, color: 'var(--lose)' }}>{renameMsg}</span>}
                </form>
              ) : (
                <>
                  <div className="group-manager-card__kicker">Bolão privado</div>
                  <div className="group-manager-card__title-row">
                    <h1 className="group-manager-card__title">{data?.group_name}</h1>
                    {amOwner && <span className="group-manager-card__owner-chip">Dono</span>}
                  </div>
                </>
              )}
              <div className="page-hero__subtitle">
                <span>{ranking.length} participante{ranking.length !== 1 ? 's' : ''}</span>
                {groupXp > 0 && <span>· ⚡ Nível {groupLevel}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {amOwner && (
                  <button
                    type="button"
                    className="badge"
                    onClick={() => setShowFeatureConfig(true)}
                    style={{
                      cursor: 'pointer', border: '1px solid var(--accent)',
                      background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)',
                      fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    ⚙️ Como habilitar bônus, dobro, lanterna e mensal →
                  </button>
                )}
                {featureConfig && (
                  <button
                    type="button"
                    className="badge"
                    onClick={() => setShowRules(true)}
                    style={{
                      cursor: 'pointer', border: '1px solid var(--border-strong)',
                      background: 'var(--bg-overlay)', color: 'var(--text-2)',
                      fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    📖 Regras deste grupo
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="page-hero__actions group-detail-hero__actions">
            {myEntry && (
              <div className="page-hero__stat">
                <div className="page-hero__stat-value">
                  {myEntry.position >= 1 && myEntry.position <= 3 ? <MedalIcon rank={myEntry.position} size={26} /> : `${myEntry.position}º`}
                </div>
                <div className="page-hero__stat-label">{myEntry.effective_points ?? myEntry.total_points} pts</div>
              </div>
            )}
            <RankingNameToggle />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShareOpen(o => !o)}>
              📤 Ranking
            </button>
            {amOwner && !renaming && (
              <button type="button" className="group-manager-card__icon-btn" onClick={() => { setNewName(data?.group_name ?? ''); setRenaming(true) }} title="Editar nome" aria-label="Editar nome do bolão">
                ✏️
              </button>
            )}
            {amOwner && (
              <button type="button" className="group-manager-card__icon-btn" onClick={() => setShowFeatureConfig(o => !o)} title="Mecânicas extras do bolão" aria-label="Configurar mecânicas extras do bolão">
                ⚙️
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Notificação de progresso pessoal (desde a última visita) ── */}
      {comp === 'copa2026' && myEntry && (myPosDelta !== 0 || passedMeBy.length > 0) && (
        <div
          className="card mt-4 fade-in-1"
          style={{
            padding: 'var(--s3) var(--s4)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap',
            borderLeft: `3px solid ${myPosDelta > 0 ? 'var(--win)' : 'var(--lose)'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{myPosDelta > 0 ? '🔥' : '⚠️'}</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
              {myPosDelta > 0 && `Você subiu ${myPosDelta} posiç${myPosDelta === 1 ? 'ão' : 'ões'} desde sua última visita!`}
              {myPosDelta <= 0 && passedMeBy.length > 0 && (
                `${passedMeBy.slice(0, 2).map(m => displayName(m, namePref)).join(' e ')}${passedMeBy.length > 2 ? ` e mais ${passedMeBy.length - 2}` : ''} te ultrapassa${passedMeBy.length === 1 ? 'ou' : 'ram'} desde sua última visita`
              )}
              {myPosDelta < 0 && passedMeBy.length === 0 && `Você caiu ${Math.abs(myPosDelta)} posiç${Math.abs(myPosDelta) === 1 ? 'ão' : 'ões'} desde sua última visita`}
            </span>
          </div>
          {myPosDelta <= 0 && (
            <Link to="/apostas" className="btn btn-sm" style={{ background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, flexShrink: 0 }}>
              Apostar e recuperar →
            </Link>
          )}
        </div>
      )}

      {/* ── Aba de competição ── */}
      <div className="phase-nav fade-in-1" style={{ margin: 'var(--s4) 0 0' }}>
        {COMPETITIONS.map(c => (
          <button key={c.id} type="button" className={`phase-nav__tab ${comp === c.id ? 'active' : ''}`} onClick={() => setComp(c.id)}>{c.emoji} {c.label}</button>
        ))}
      </div>
      {comp === 'geral' && (
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', margin: 'var(--s2) 0 0' }}>
          Soma bruta dos pontos entre competições — só curiosidade, sem pódio oficial. O pódio de verdade fica dentro de cada competição.
        </p>
      )}

      {/* ── Guia de página: Ranking vs Estatísticas ── */}
      {comp !== 'geral' && (
        <div className="phase-nav fade-in-1" style={{ margin: 'var(--s3) 0 0' }}>
          <button type="button" className={`phase-nav__tab ${!showStats ? 'active' : ''}`} onClick={() => setShowStats(false)}>🏆 Ranking</button>
          <button type="button" className={`phase-nav__tab ${showStats ? 'active' : ''}`} onClick={() => setShowStats(true)}>📊 Estatísticas</button>
        </div>
      )}

      {/* ── Config das mecânicas extras — home do grupo, não presa a nenhuma aba: */}
      {/* hoje só o Brasileirão tem mecânica de verdade, mas o ACESSO à config não */}
      {/* fica escondido dentro da aba, pra quando outra competição ganhar as suas. ── */}
      {amOwner && showFeatureConfig && featureConfig && (
        <GroupFeatureConfig
          groupId={groupId}
          token={token}
          config={featureConfig.config}
          onSaved={cfg => setFeatureConfig(fc => ({ ...fc, config: cfg }))}
          brTeams={brTeams}
          currentRodada={brCurrentRodada}
          onClose={() => setShowFeatureConfig(false)}
        />
      )}

      {/* ── Regras — leitura pra QUALQUER membro (não só dono), valores reais do grupo ── */}
      {showRules && featureConfig && (
        <GroupRulesModal config={featureConfig.config} brTeams={brTeams} onClose={() => setShowRules(false)} />
      )}

      {/* ── Ranking por período (rodada/turno/mês) — visão à parte do ranking do */}
      {/* campeonato inteiro (esse já é a lista principal logo abaixo). Não depende */}
      {/* de nenhuma mecânica ligada, é só outro recorte de leitura. ── */}
      {comp === 'brasileirao2026' && (
        <GroupPeriodRanking groupId={groupId} token={token} currentRodada={brCurrentRodada} />
      )}

      {/* ── Seções inline das mecânicas — só aparecem na aba Brasileirão (só ela tem hoje) ── */}
      {comp === 'brasileirao2026' && featureConfig && (
        <>
          {featureConfig.config.classification_bonus?.enabled && (
            <GroupClassificationBonus groupId={groupId} token={token} brTeams={brTeams} myEntry={myEntry} />
          )}
          {featureConfig.config.double_match?.enabled && (
            <GroupDoubleMatchBadge groupId={groupId} token={token} currentRodada={brCurrentRodada} brTeams={brTeams} />
          )}
          {featureConfig.config.lanterna?.enabled && (
            <GroupLanterna groupId={groupId} token={token} amOwner={amOwner} />
          )}
        </>
      )}

      {!showStats && (
      <>
      {/* ── Nível XP do grupo ── */}
      {groupXp > 0 && (
        <div className="card mt-4 fade-in-1 group-xp-bar">
          <div style={{ padding: 'var(--s3) var(--s4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Nível do Grupo</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--accent)', lineHeight: 1, marginTop: 2 }}>⚡ Nível {groupLevel}</div>
            </div>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-2)' }}>{groupXp % 500} / 500 XP</span>
          </div>
          <div style={{ height: 5, background: 'var(--bg-overlay)' }}>
            <div style={{ height: '100%', width: `${xpPct}%`, background: 'linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #fff))', transition: 'width 800ms cubic-bezier(0.22,1,0.36,1)' }} />
          </div>
        </div>
      )}

      {/* ── Compartilhar ── */}
      {shareOpen && (
        <div className="card mt-4 fade-in-1" style={{ padding: 'var(--s4) var(--s5)', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>Compartilhar Ranking</div>
          <pre style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-1)', background: 'var(--bg-overlay)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
            {buildShareText(data.group_name, ranking, finished, total, personalLink)}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={shareWhatsApp} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <WaIcon /> WhatsApp
            </button>
            <button onClick={copyShareText} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: shareCopied ? 'var(--win)' : 'var(--bg-raised)', color: shareCopied ? '#fff' : 'var(--text-1)', transition: 'all .2s' }}>
              {shareCopied ? '✓ Copiado!' : '📋 Copiar'}
            </button>
            {navigator.share && (
              <button
                onClick={() => navigator.share({ title: data?.group_name, text: buildShareText(data.group_name, ranking, matchStats.finished, matchStats.total, personalLink) })}
                style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: 16 }}
                title="Compartilhar"
              >
                ↗
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Stats pills ── */}
      <div className="fade-in-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--s3)', marginTop: 'var(--s6)' }}>
        <StatPill icon="⚽" label="Realizados" value={`${finished}/${total}`} />
        <StatPill icon="⏳" label="Pendentes" value={total - finished} />
        <StatPill icon="👥" label="Participantes" value={ranking.length} />
        {todayTop && <StatPill icon="🔥" label="Em Alta Hoje" value={displayName(todayTop, namePref)} sub={`+${todayTop.total_points} pts hoje`} accent />}
        {weekLeader && <StatPill icon="📅" label="Destaque Semana" value={displayName(weekLeader, namePref)} sub={`+${weekLeader.pts_week} pts (7 dias)`} />}
        {bestApproval && <StatPill icon="📊" label="Melhor Aproveito" value={displayName(bestApproval, namePref)} sub={`${bestApproval.pct}% eficiência`} />}
        {myEntry && (
          <Link to={`/usuarios/${myEntry.user_id}/historico`} style={{ textDecoration: 'none' }}>
            <StatPill icon="📜" label="Meu Histórico" value="Ver tudo →" sub="palpites detalhados" />
          </Link>
        )}
      </div>

      {/* ── Próximo jogo + countdown (Copa) ── */}
      {comp === 'copa2026' && highlights?.next_match && (
        <div className="card mt-4 fade-in-2">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>⏰ Próximo Jogo</span>
            <span className={`countdown-chip${countdown.urgent ? ' countdown-chip--urgent' : ''}`}>
              {countdown.hours > 0
                ? `${padTime(countdown.hours)}h ${padTime(countdown.minutes)}m`
                : `${padTime(countdown.minutes)}m ${padTime(countdown.seconds)}s`
              }
            </span>
          </div>
          <div style={{ padding: 'var(--s3) var(--s4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
              <TeamChip t={highlights.next_match.team_a} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-2)' }}>×</span>
              <TeamChip t={highlights.next_match.team_b} />
            </div>
            <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              {highlights.members_bet_next?.length > 0 && (
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--win)', marginBottom: 5 }}>
                    ✓ Apostaram ({highlights.members_bet_next.length})
                  </div>
                  {highlights.members_bet_next.map(m => (
                    <div key={m.user_id} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', padding: '2px 0' }}>{m.name}</div>
                  ))}
                </div>
              )}
              {highlights.members_no_bet_next?.length > 0 && (
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--lose)', marginBottom: 5 }}>
                    ⚠ Faltam apostar ({highlights.members_no_bet_next.length})
                  </div>
                  {highlights.members_no_bet_next.map(m => (
                    <div key={m.user_id} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-1)', fontWeight: 700, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--lose)' }}>!</span> {m.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {ranking.length > 0 && (
              <div style={{ marginTop: 'var(--s3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-2)' }}>Cobertura do grupo</span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-2)' }}>
                    {highlights.members_bet_next?.length}/{ranking.length}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-overlay)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, transition: 'width 600ms ease',
                    width: `${Math.round((highlights.members_bet_next?.length ?? 0) / ranking.length * 100)}%`,
                    background: highlights.members_bet_next?.length === ranking.length ? 'var(--win)' : 'var(--accent)',
                  }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pick do Campeão (só Copa — Brasileirão não tem esse jogo) ── */}
      {comp === 'copa2026' && <div className="card mt-4 fade-in-2">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🏆 Palpite do Campeão</span>
          <button className="btn btn-sm" style={{ background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 }}
            onClick={() => setShowChampionPicker(p => !p)}>
            {myChampionPick ? `✏️ ${myChampionPick.champion?.code ?? 'Trocar'}` : '+ Escolher'}
          </button>
        </div>
        {showChampionPicker && (
          <div style={{ padding: 'var(--s3) var(--s4)', borderBottom: '1px solid var(--border)' }}>
            <input
              type="text" placeholder="Buscar time..." value={championSearch}
              onChange={e => setChampionSearch(e.target.value)}
              style={{ width: '100%', fontFamily: 'var(--font-cond)', fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text-1)', marginBottom: 8, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
              {filteredTeams.map(t => (
                <button key={t.id} onClick={() => pickChampion(t.id)} disabled={savingChampion}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20, border: '1px solid var(--border)', background: myChampionPick?.champion?.id === t.id ? 'var(--accent)' : 'var(--bg-raised)', color: myChampionPick?.champion?.id === t.id ? '#fff' : 'var(--text-1)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600 }}>
                  {t.flag_url && <TeamCrestFlag src={t.flag_url} alt={t.code} style={{ width: 18, height: 12, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
                  {t.code}
                </button>
              ))}
            </div>
          </div>
        )}
        {championPicks.length > 0 ? (
          <div style={{ padding: 'var(--s2) var(--s4) var(--s4)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {championPicks.map(p => (
                <div key={p.user_id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 10, background: p.is_me ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg-raised)', border: p.is_me ? '1px solid var(--accent)' : '1px solid var(--border)', minWidth: 70 }}>
                  {p.champion ? (
                    <>
                      {p.champion.flag_url && <TeamCrestFlag src={p.champion.flag_url} alt={p.champion.code} style={{ width: 32, height: 22, objectFit: 'cover', borderRadius: 3 }} crestStyle={{ width: 30, height: 30, objectFit: 'contain', borderRadius: 5, background: 'var(--bg-overlay)' }} />}
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>{p.champion.code}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 20 }}>❓</span>
                  )}
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: p.is_me ? 'var(--accent)' : 'var(--text-2)', fontWeight: p.is_me ? 700 : 400 }}>{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: 'var(--s4)', color: 'var(--text-2)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>Nenhum membro escolheu o campeão ainda.</div>
        )}
      </div>}

      {/* ── Ranking por fase (tabs — só faz sentido pra Copa, fases de mata-mata) ── */}
      <div className="card mt-4 fade-in-2">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Classificação do Grupo</span>
        </div>
        {/* Phase tabs */}
        {comp === 'copa2026' && <div style={{ display: 'flex', gap: 4, padding: '0 var(--s4) var(--s3)', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingTop: 'var(--s3)' }}>
          {availablePhases.map(ph => (
            <button key={ph} onClick={() => setActivePhase(ph)}
              style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: activePhase === ph ? 'none' : '1px solid var(--border)', background: activePhase === ph ? 'var(--accent)' : 'var(--bg-raised)', color: activePhase === ph ? '#fff' : 'var(--text-2)', cursor: 'pointer', transition: 'all .15s' }}>
              {PHASE_LABELS[ph]}
            </button>
          ))}
        </div>}

        {phaseLoading ? (
          <div style={{ padding: 'var(--s8)', textAlign: 'center', color: 'var(--text-2)' }}>Carregando...</div>
        ) : (
          <>
            {/* Banner campeão real (se definido) */}
            {champion && activePhase === 'all' && (
              <div style={{ margin: 'var(--s3) var(--s4)', padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(90deg, #e8a03020 0%, var(--bg-raised) 100%)', border: '1px solid #e8a03060', display: 'flex', alignItems: 'center', gap: 10 }}>
                {champion.flag_url && <TeamCrestFlag src={champion.flag_url} alt={champion.code} style={{ width: 36, height: 25, objectFit: 'cover', borderRadius: 3 }} crestStyle={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6, background: 'var(--bg-overlay)' }} />}
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#e8a030' }}>🏆 Campeão do Mundo</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-1)', lineHeight: 1.1 }}>{champion.name}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-2)' }}>bônus correto</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: '#e8a030' }}>+{championBonusPts} pts</div>
                </div>
              </div>
            )}

            {/* Pódio top-3 (só nas abas por competição — Geral é só curiosidade) */}
            {comp !== 'geral' && top3.length >= 1 && (
              <div className="group-podium">
                {top3.map((r, i) => (
                  <div key={r.user_id} className={`group-podium__slot group-podium__slot--${i + 1}`}>
                    <div className="group-podium__avatar rank-fav-crest-wrap">
                      {getInitials(r.name)}
                      {r.favorite_team_flag_url && (
                        <span className="rank-fav-crest-badge" title={r.favorite_team_name}>
                          <TeamCrestFlag
                            src={r.favorite_team_flag_url}
                            alt={r.favorite_team_name}
                            className="rank-fav-crest-badge__img"
                            crestClassName="rank-fav-crest-badge__img--crest"
                          />
                        </span>
                      )}
                    </div>
                    <div className="group-podium__medal"><MedalIcon rank={i + 1} size={26} /></div>
                    <div className="group-podium__name" title={r.name}>{displayName(r, namePref)}{r.is_me ? ' ★' : ''}</div>
                    <div className="group-podium__pts">{r.effective_points ?? r.total_points} pts</div>
                    {r.exact_scores > 0 && (
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--win)', marginTop: 2 }}>
                        🎯 {r.exact_scores} exato{r.exact_scores !== 1 ? 's' : ''}
                      </div>
                    )}
                    <div className="group-podium__platform" />
                  </div>
                ))}
              </div>
            )}

            {/* Meu desempenho detalhado — posição/pontos já aparecem no cabeçalho; aqui é o detalhamento (exatos/certos/apostas/forma) */}
            {myEntry && (
              <div className="group-ranking-hero fade-in-2">
                <div className="group-ranking-hero__pos" aria-hidden="true">📊</div>
                <div className="group-ranking-hero__info">
                  <div className="group-ranking-hero__label">Seu desempenho</div>
                  <div className="group-ranking-hero__name">{displayName(myEntry, namePref)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-2)' }}>
                      {myEntry.exact_scores} exatos · {myEntry.correct_results} certos · {myEntry.total_bets} apostas
                      {aproveitamento(myEntry) !== null && ` · ${aproveitamento(myEntry)}%`}
                    </span>
                    {recentForm[myEntry.user_id]?.length > 0 && <FormDots form={recentForm[myEntry.user_id]} />}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="group-ranking-hero__pts">{myEntry.effective_points ?? myEntry.total_points}</div>
                  {myEntry.champion_bonus > 0 && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: '#e8a030', fontWeight: 700 }}>🏆 +{myEntry.champion_bonus}</div>}
                  <div className="group-ranking-hero__pts-label">pontos</div>
                </div>
              </div>
            )}

            {/* Tabela */}
            {displayRanking.length === 0 ? (
              <div style={{ padding: 'var(--s16)', textAlign: 'center', color: 'var(--text-2)', fontFamily: 'var(--font-cond)' }}>
                {activePhase !== 'all' ? 'Nenhum jogo desta fase encerrado ainda.' : 'Nenhuma aposta ainda.'}
              </div>
            ) : (
              <div>
                <div className="grp-rank-grid" style={{ padding: '6px var(--s4)', borderBottom: '1px solid var(--border)' }}>
                  {[
                    ['#', 'center', '', 'Posição'],
                    ['Participante', 'left', '', ''],
                    ['🎯', 'center', 'grp-col-x', 'Placares exatos'],
                    ['✅', 'center', 'grp-col-x', 'Resultados certos'],
                    ['❌', 'center', 'grp-col-x', 'Erros'],
                    ['Méd', 'center', 'grp-col-x', 'Média de pontos por palpite'],
                    ['Hoje', 'center', 'grp-col-x', 'Pontos ganhos hoje'],
                    ['Pts', 'right', '', 'Pontos totais'],
                  ].map(([h, align, cls, tip]) => (
                    <span key={h} className={cls} title={tip} style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)', textAlign: align, justifyContent: 'center' }}>{h}</span>
                  ))}
                </div>
                {displayRanking.map((r, i) => {
                  const podiumClass = i === 0 ? 'ranking-row--gold' : i === 1 ? 'ranking-row--silver' : i === 2 ? 'ranking-row--bronze' : ''
                  const isHotToday = todayTop?.user_id === r.user_id
                  const streak = streakMap[r.user_id] || 0
                  const isMuralHero = muralHeroName === r.name
                  const badges = getBadges(r, i + 1, effectiveTotal, isHotToday, streak, isMuralHero)
                  const leaderDiff = i > 0 ? leaderPtsTotal - r.total_points : 0
                  const prevMember = i > 0 ? displayRanking[i - 1] : null
                  const coveragePct = Math.min(100, Math.round(r.total_bets / effectiveTotal * 100))
                  const aprv = aproveitamento(r)
                  const prevPos = prevPositions?.[r.user_id]
                  const curPos = i + 1
                  const delta = prevPos && prevPos !== curPos ? prevPos - curPos : 0
                  const form = recentForm[r.user_id] ?? []
                  const memberChampion = championPicks.find(p => p.user_id === r.user_id)?.champion
                  const isExpanded = expandedUserId === r.user_id
                  const recentBets = memberRecentBets[String(r.user_id)] ?? []
                  const erros = r.total_bets - r.exact_scores - r.correct_results

                  return (
                    <div key={r.user_id}>
                      <div
                        className={`ranking-row fade-in grp-rank-grid ${podiumClass}`}
                        onClick={() => setExpandedUserId(isExpanded ? null : r.user_id)}
                        style={{ animationDelay: `${i * 30}ms`, borderLeft: i < 3 ? undefined : r.is_me ? '3px solid var(--accent)' : '3px solid transparent', background: isExpanded ? 'color-mix(in srgb, var(--accent) 6%, var(--bg-raised))' : r.is_me && i >= 3 ? 'rgba(15,122,120,0.04)' : undefined, cursor: 'pointer', userSelect: 'none' }}>
                        <div style={{ textAlign: 'center', alignSelf: 'start', paddingTop: 4 }}>
                          <span className={`ranking-row__pos ${i < 3 ? 'ranking-row__pos--top' : ''}`}>
                            {i < 3 ? <MedalIcon rank={i + 1} size={18} /> : i + 1}
                          </span>
                          {delta !== 0 && (
                            <div style={{ fontSize: 9, fontFamily: 'var(--font-cond)', fontWeight: 700, color: delta > 0 ? 'var(--win)' : 'var(--lose)', lineHeight: 1, marginTop: 2 }}>
                              {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                            </div>
                          )}
                        </div>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {r.favorite_team_flag_url && (
                              <TeamCrestFlag
                                src={r.favorite_team_flag_url}
                                alt={r.favorite_team_name}
                                className="rank-fav-crest"
                                crestClassName="rank-fav-crest--crest"
                              />
                            )}
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 'clamp(15px, 4vw, 16px)', color: 'var(--text-1)' }}>{displayName(r, namePref)}</span>
                            {r.is_me && <span style={{ fontSize: 9, fontFamily: 'var(--font-cond)', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>VOCÊ</span>}
                            {memberChampion && (
                              <span title={`Campeão: ${memberChampion.name}`} style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '0px 5px' }}>
                                🏆 {memberChampion.code}
                              </span>
                            )}
                          </div>
                          {badges.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {badges.map(b => (
                                <span key={b.label} style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: `${b.color}20`, color: b.color, border: `1px solid ${b.color}40` }}>
                                  {b.icon} {b.label}
                                </span>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ height: 4, width: 80, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                                <div style={{ height: '100%', borderRadius: 2, width: `${coveragePct}%`, background: coveragePct >= 80 ? 'var(--win)' : coveragePct >= 50 ? 'var(--accent)' : 'var(--lose)', transition: 'width 600ms ease' }} />
                              </div>
                              <span style={{ fontFamily: 'var(--font-data)', fontSize: 'clamp(11px, 3vw, 11px)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                                {r.total_bets}/{effectiveTotal}{aprv !== null && ` · ${aprv}%`}
                              </span>
                            </div>
                            {form.length > 0 && <FormDots form={form} />}
                            {r.exact_scores > 0 && (
                              <span className="grp-exact-chip" style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--win)', background: 'color-mix(in srgb, var(--win) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--win) 30%, transparent)', borderRadius: 10, padding: '0 6px', whiteSpace: 'nowrap' }}>
                                🎯 {r.exact_scores} exato{r.exact_scores !== 1 ? 's' : ''}
                              </span>
                            )}
                            {(todayPts[r.user_id] || 0) > 0 && (
                              <span className="grp-today-chip" style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--win)', background: 'color-mix(in srgb, var(--win) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--win) 30%, transparent)', borderRadius: 10, padding: '0 6px', whiteSpace: 'nowrap' }}>
                                🔥 +{todayPts[r.user_id]} hoje
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="grp-col-x" style={{ alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 800, color: 'var(--win)', background: 'color-mix(in srgb, var(--win) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--win) 35%, transparent)', borderRadius: 8, padding: '2px 8px', lineHeight: 1.4 }}>
                            {r.exact_scores}
                          </span>
                        </span>
                        {[
                          { key: 'ok', val: r.correct_results, color: 'var(--accent)' },
                          { key: 'er', val: Math.max(0, erros), color: 'var(--lose)' },
                          { key: 'med', val: r.total_bets > 0 ? (r.total_points / r.total_bets).toFixed(1) : '–', color: 'var(--text-2)' },
                          { key: 'hoje', val: (todayPts[r.user_id] || 0) > 0 ? `+${todayPts[r.user_id]}` : '–', color: (todayPts[r.user_id] || 0) > 0 ? 'var(--win)' : 'var(--text-4)' },
                        ].map(c => (
                          <span key={c.key} className="grp-col-x" style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: c.color, alignItems: 'center', justifyContent: 'center' }}>{c.val}</span>
                        ))}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--accent)', fontWeight: 700 }}>{r.effective_points ?? r.total_points}</span>
                          {r.champion_bonus > 0 && (
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: '#e8a030', fontWeight: 700, background: '#e8a03018', border: '1px solid #e8a03040', borderRadius: 10, padding: '1px 5px' }}>🏆+{r.champion_bonus}</span>
                          )}
                          {i > 0 && (() => {
                            const topPts = displayRanking[0] ? (displayRanking[0].effective_points ?? displayRanking[0].total_points) : 0
                            const diff = topPts - (r.effective_points ?? r.total_points)
                            return diff > 0 ? (
                              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>−{diff} do líder</span>
                            ) : null
                          })()}
                          <div style={{ width: 36, height: 3, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, width: `${leaderPts > 0 ? ((r.effective_points ?? r.total_points) / leaderPts) * 100 : 0}%`, background: i === 0 ? '#e8a030' : i === 1 ? 'var(--text-3)' : 'var(--accent)', transition: 'width 600ms ease' }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-3)', lineHeight: 1 }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {/* ── Expanded row details ── */}
                      {isExpanded && (
                        <div className="fade-in-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)', padding: 'var(--s3) var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>

                          {/* Stats breakdown */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(58px, 1fr))', gap: 4 }}>
                            {[
                              { icon: '🎯', label: 'Exatos', val: r.exact_scores, color: 'var(--win)' },
                              { icon: '✅', label: 'Certos', val: r.correct_results, color: 'var(--accent)' },
                              { icon: '❌', label: 'Erros', val: Math.max(0, erros), color: 'var(--lose)' },
                              { icon: '📝', label: 'Total', val: r.total_bets, color: 'var(--text-2)' },
                              { icon: '📊', label: 'Aprov.', val: aprv !== null ? `${aprv}%` : '–', color: aprv !== null && aprv >= 50 ? 'var(--win)' : 'var(--text-2)' },
                              { icon: '⚖️', label: 'Média', val: r.total_bets > 0 ? (r.total_points / r.total_bets).toFixed(1) : '–', color: 'var(--text-2)' },
                              { icon: '🔥', label: 'Hoje', val: (todayPts[r.user_id] || 0) > 0 ? `+${todayPts[r.user_id]}` : '0', color: (todayPts[r.user_id] || 0) > 0 ? 'var(--win)' : 'var(--text-3)' },
                            ].map(s => (
                              <div key={s.label} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 8, background: 'var(--bg-surface)' }}>
                                <div style={{ fontFamily: 'var(--font-data)', fontSize: 15, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-3)', marginTop: 2, letterSpacing: '0.05em' }}>{s.icon} {s.label}</div>
                              </div>
                            ))}
                          </div>

                          {/* ── Breakdown do desempate (passo 17) — só Brasileirão, só se */}
                          {/* alguma mecânica estiver ligada no grupo (senão os campos vêm 0 sem sentido). */}
                          {comp === 'brasileirao2026' && r.double_bonus !== undefined && featureConfig && (
                            Object.values(featureConfig.config).some(v => v && typeof v === 'object' && v.enabled)
                          ) && (
                            <div>
                              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
                                Composição do desempate
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 4 }}>
                                {[
                                  { icon: '📌', label: 'Base', val: r.total_points, color: 'var(--text-2)' },
                                  { icon: '🔥', label: 'Dobro', val: r.double_bonus > 0 ? `+${r.double_bonus}` : '0', color: r.double_bonus > 0 ? 'var(--win)' : 'var(--text-3)' },
                                  { icon: '📅', label: 'Mensal', val: r.monthly_bonus_pts > 0 ? `+${r.monthly_bonus_pts}` : '0', color: r.monthly_bonus_pts > 0 ? 'var(--win)' : 'var(--text-3)' },
                                  { icon: '🏆', label: 'Class.', val: r.classification_hits ?? 0, color: (r.classification_hits ?? 0) > 0 ? 'var(--win)' : 'var(--text-3)' },
                                  { icon: '🎯', label: 'PE efet.', val: r.pe_efetivo ?? 0, color: 'var(--text-2)' },
                                  { icon: '✅', label: 'VE efet.', val: r.ve_efetivo ?? 0, color: 'var(--text-2)' },
                                  { icon: '🏁', label: 'Total', val: r.effective_points ?? r.total_points, color: 'var(--accent)' },
                                ].map(s => (
                                  <div key={s.label} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-3)', marginTop: 2, letterSpacing: '0.05em' }}>{s.icon} {s.label}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Recent bets grouped by date */}
                          {recentBets.length > 0 && (() => {
                            const groups = {}
                            recentBets.forEach(bet => {
                              const dateKey = bet.match_date
                                ? new Date(bet.match_date.endsWith('Z') ? bet.match_date : bet.match_date + 'Z')
                                    .toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', weekday: 'short' })
                                : 'Sem data'
                              if (!groups[dateKey]) groups[dateKey] = []
                              groups[dateKey].push(bet)
                            })
                            return (
                              <div>
                                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>Resultados por Data</div>
                                {Object.entries(groups).map(([dateStr, dateBets]) => (
                                  <div key={dateStr} style={{ marginBottom: 8 }}>
                                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 0 4px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>{dateStr}</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {dateBets.map((bet, bi) => {
                                        const exact = bet.bet_a === bet.result_a && bet.bet_b === bet.result_b
                                        const correct = (bet.points_earned || 0) > 0
                                        const ptColor = exact ? 'var(--win)' : correct ? 'var(--accent)' : 'var(--lose)'
                                        return (
                                          <div key={bi} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 8, background: 'var(--bg-surface)', border: `1px solid ${ptColor}30` }}>
                                            {bet.team_a?.flag_url && <TeamCrestFlag src={bet.team_a.flag_url} alt={bet.team_a.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
                                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)', fontWeight: 600, flex: 1 }}>{bet.team_a?.code} × {bet.team_b?.code}</span>
                                            <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-1)', fontWeight: 700 }}>{bet.bet_a}–{bet.bet_b}</span>
                                            {bet.result_a !== null && bet.result_b !== null && (
                                              <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)' }}>({bet.result_a}–{bet.result_b})</span>
                                            )}
                                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: ptColor, background: `${ptColor}15`, borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
                                              {exact ? '🎯' : correct ? '✅' : '❌'} {bet.points_earned > 0 ? `+${bet.points_earned}` : '0'}
                                            </span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          })()}

                          {/* Diff pro líder + links */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>
                              {i === 0
                                ? <span style={{ color: 'var(--win)', fontWeight: 700 }}>👑 Líder do grupo</span>
                                : leaderDiff === 0
                                  ? <span style={{ color: 'var(--win)', fontWeight: 700 }}>= empatado com {displayName(displayRanking[0], namePref)}</span>
                                  : <>−<strong style={{ color: 'var(--text-1)' }}>{leaderDiff} pts</strong> para {displayName(displayRanking[0], namePref)}</>
                              }
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Link to={`/usuarios/${r.user_id}/historico`}
                                style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-overlay)', color: 'var(--accent)', border: '1px solid var(--accent)', textDecoration: 'none' }}
                                onClick={e => e.stopPropagation()}>
                                📜 Histórico
                              </Link>
                              <button onClick={e => { e.stopPropagation(); setDuelMember(duelMember?.user_id === r.user_id ? null : r) }}
                                style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-overlay)', color: '#9b5de8', border: '1px solid #9b5de840', cursor: 'pointer' }}>
                                ⚔️ Duelo
                              </button>
                              {amOwner && !r.is_me && (
                                <button type="button"
                                  style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-overlay)', color: 'var(--lose)', border: '1px solid var(--lose)40', cursor: 'pointer' }}
                                  disabled={removingId === r.user_id}
                                  onClick={e => { e.stopPropagation(); removeMember(r.user_id) }}>
                                  {removingId === r.user_id ? '...' : '✕ Remover'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Duelo ── */}
      {duelMember && myEntry && duelMember.user_id !== myEntry.user_id && (
        <div className="card mt-4 fade-in-1" style={{ borderLeft: '3px solid #9b5de8', padding: 0 }}>
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>⚔️ Duelo Direto</span>
            <button onClick={() => setDuelMember(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 18 }}>×</button>
          </div>
          <DuelCard me={myEntry} them={duelMember} />
        </div>
      )}
      </>
      )}

      {showStats && (
      <>
      {/* ── Gráfico de evolução ── */}
      {comp !== 'geral' && evolution?.series?.length > 0 && (
        <div className="card mt-4 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>📈 Evolução de Posições</span>
            <button onClick={() => setShowEvolution(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>
              {showEvolution ? 'Ocultar ▲' : 'Ver ▼'}
            </button>
          </div>
          {showEvolution && <EvolutionChart data={evolution} />}
          {!showEvolution && (
            <div style={{ padding: '0 var(--s4) var(--s3)', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>
              {evolution.labels.length} checkpoints · {evolution.series.length} participantes
            </div>
          )}
        </div>
      )}

      {/* ── Apostas reveladas ── */}
      {comp !== 'geral' && recentMatches.length > 0 && (
        <div className="card mt-4 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🔍 Apostas Reveladas</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>pós-jogo</span>
          </div>
          <div style={{ padding: 'var(--s3) var(--s4)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {recentMatches.map(m => (
              <button key={m.id} onClick={() => setSelectedMatch(selectedMatch?.id === m.id ? null : m)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: selectedMatch?.id === m.id ? '1.5px solid var(--accent)' : '1px solid var(--border)', background: selectedMatch?.id === m.id ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-raised)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600, color: 'var(--text-1)', transition: 'all .15s' }}>
                {m.team_a?.flag_url && <TeamCrestFlag src={m.team_a.flag_url} alt={m.team_a.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
                <span>{m.team_a?.code}</span>
                <span style={{ color: 'var(--text-2)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{m.result?.score_a}–{m.result?.score_b}</span>
                <span>{m.team_b?.code}</span>
                {m.team_b?.flag_url && <TeamCrestFlag src={m.team_b.flag_url} alt={m.team_b.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
              </button>
            ))}
          </div>
          {selectedMatch && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 'var(--s3) var(--s4)' }}>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                Palpites · {selectedMatch.team_a?.code} {selectedMatch.result?.score_a}–{selectedMatch.result?.score_b} {selectedMatch.team_b?.code}
              </div>
              {matchBetsLoading ? (
                <div style={{ color: 'var(--text-2)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>Carregando...</div>
              ) : matchBets.length === 0 ? (
                <div style={{ color: 'var(--text-2)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>Nenhum palpite encontrado.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {matchBets.map((b, i) => {
                    const exact = b.score_a === selectedMatch.result?.score_a && b.score_b === selectedMatch.result?.score_b
                    const correct = b.points_earned > 0
                    return (
                      <div key={b.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, background: b.is_me ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--bg-raised)', border: b.is_me ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', width: 20, textAlign: 'center' }}>{i + 1}.</span>
                        <span style={{ flex: 1, fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{b.name}</span>
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 700, color: exact ? 'var(--win)' : correct ? 'var(--accent)' : 'var(--text-2)', minWidth: 40, textAlign: 'center' }}>
                          {b.score_a}–{b.score_b}
                        </span>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: exact ? 'var(--win)' : correct ? 'var(--accent-dim)' : 'var(--bg-overlay)', color: exact ? '#fff' : correct ? 'var(--accent)' : 'var(--text-3)' }}>
                          {exact ? '🎯 +3' : correct ? `+${b.points_earned}` : '0'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Highlights ── */}
      {comp !== 'geral' && highlights?.streaks?.length > 0 && (
        <div className="card mt-4 fade-in-3" style={{ padding: 'var(--s4) var(--s5)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#0fa896', marginBottom: 8 }}>🔗 Maior Sequência de Exatos</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-1)', lineHeight: 1 }}>{highlights.streaks[0].streak}</div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', marginTop: 4 }}>{displayName(highlights.streaks[0], namePref)}</div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>consecutivos</div>
        </div>
      )}

      {/* ── Mural de provocações ── */}
      {comp !== 'geral' && topBets.length > 0 && (
        <div className="card mt-4 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🎲 Mural de Provocações</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>palpites mais ousados</span>
          </div>
          <div className="mural-grid">
            {topBets.map((bet, i) => (
              <div key={i} className={`mural-card mural-card--${i + 1}`}>
                <span className="mural-card__tag">{i === 0 ? '🏅 Mais ousado' : i === 1 ? '2º lugar' : '3º lugar'}</span>
                <div className="mural-card__score">{bet.score_a} × {bet.score_b}</div>
                <div className="mural-card__name">{bet.user_name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Atividade do Grupo ── */}
      {comp !== 'geral' && (weeklyRanking.length > 0 || monthlyRanking.length > 0 || mostActiveRanking.length > 0 || lastFinishedMatch) && (
        <div className="card mt-4 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>📊 Atividade do Grupo</span>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '0 var(--s4) var(--s3)', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', paddingTop: 'var(--s3)' }}>
            {[
              ['semana', '📅 Semana'],
              ['mes', '🗓️ Mês'],
              ['ativos', '🔥 Mais Ativos'],
              ...(lastFinishedMatch ? [['rodada', '⚽ Última Rodada']] : []),
            ].map(([key, label]) => (
              <button key={key} onClick={() => setActivityTab(key)}
                style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, border: activityTab === key ? 'none' : '1px solid var(--border)', background: activityTab === key ? 'var(--accent)' : 'var(--bg-raised)', color: activityTab === key ? '#fff' : 'var(--text-2)', cursor: 'pointer', transition: 'all .15s' }}>
                {label}
              </button>
            ))}
          </div>

          {activityTab === 'semana' && (
            weeklyRanking.length > 0 ? (
              <div className="weekly-ranking">
                {weeklyRanking.slice(0, 8).map((r, i) => (
                  <div key={r.user_id} className={`weekly-ranking__row weekly-ranking__row--${i + 1}`}>
                    <span className="weekly-ranking__medal">{i < 3 ? <MedalIcon rank={i + 1} size={16} /> : `${i + 1}.`}</span>
                    <span className="weekly-ranking__name">{displayName(r, namePref)}</span>
                    <span className="weekly-ranking__pts">+{r.pts_week}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 'var(--s4)', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>Ninguém pontuou nos últimos 7 dias ainda.</div>
            )
          )}

          {activityTab === 'mes' && (
            monthlyRanking.length > 0 ? (
              <div className="weekly-ranking">
                {monthlyRanking.slice(0, 8).map((r, i) => (
                  <div key={r.user_id} className={`weekly-ranking__row weekly-ranking__row--${i + 1}`}>
                    <span className="weekly-ranking__medal">{i < 3 ? <MedalIcon rank={i + 1} size={16} /> : `${i + 1}.`}</span>
                    <span className="weekly-ranking__name">{displayName(r, namePref)}</span>
                    <span className="weekly-ranking__pts">+{r.pts_month}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 'var(--s4)', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>Ninguém pontuou este mês ainda.</div>
            )
          )}

          {activityTab === 'ativos' && (
            mostActiveRanking.length > 0 ? (
              <div className="weekly-ranking">
                {mostActiveRanking.slice(0, 8).map((r, i) => (
                  <div key={r.user_id} className={`weekly-ranking__row weekly-ranking__row--${i + 1}`}>
                    <span className="weekly-ranking__medal">{i < 3 ? <MedalIcon rank={i + 1} size={16} /> : `${i + 1}.`}</span>
                    <span className="weekly-ranking__name">{displayName(r, namePref)}</span>
                    <span className="weekly-ranking__pts">{r.total_bets}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: 'var(--s4)', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>Ninguém apostou ainda.</div>
            )
          )}

          {activityTab === 'rodada' && lastFinishedMatch && (
            <div style={{ padding: 'var(--s3) var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                {lastFinishedMatch.team_a?.code} {lastFinishedMatch.result?.score_a}–{lastFinishedMatch.result?.score_b} {lastFinishedMatch.team_b?.code}
              </div>
              <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--win)', marginBottom: 5 }}>
                    ✓ Apostaram ({lastRoundBet.length})
                  </div>
                  {lastRoundBet.length === 0
                    ? <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>Ninguém.</div>
                    : lastRoundBet.map(m => (
                      <div key={m.user_id} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', padding: '2px 0' }}>{m.name}</div>
                    ))}
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--lose)', marginBottom: 5 }}>
                    ⚠ Faltaram apostar ({lastRoundNotBet.length})
                  </div>
                  {lastRoundNotBet.length === 0
                    ? <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--win)' }}>Todo mundo apostou! 🎉</div>
                    : lastRoundNotBet.map(m => (
                      <div key={m.user_id} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-1)', fontWeight: 700, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: 'var(--lose)' }}>!</span> {m.name}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* ── Link de convite + QR ── */}
      <div className="card mt-6 fade-in-3" style={{ padding: 'var(--s12) var(--s16)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Link de convite</span>
          {!inviteLink ? (
            <button className="btn btn-primary btn-sm" onClick={generateLink} disabled={linkLoading}>{linkLoading ? 'Gerando...' : '🔗 Gerar link'}</button>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <input readOnly value={inviteLink} style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-data)', fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text-1)' }} />
              <button className="btn btn-primary btn-sm" onClick={shareLink}>{copied ? '✓ Copiado' : '📤 Compartilhar'}</button>
              <button className="btn btn-ghost btn-sm" onClick={copyLink} title="Copiar link">📋</button>
              {qrDataUrl && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowQr(q => !q)} title="QR Code">⬛</button>
              )}
            </div>
          )}
        </div>
        {showQr && qrDataUrl && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <img
              src={qrDataUrl}
              alt="QR Code do convite"
              onClick={() => setQrEnlarged(true)}
              style={{ width: 180, height: 180, borderRadius: 10, border: '1px solid var(--border)', cursor: 'zoom-in' }}
            />
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>Compartilhe o QR para entrar no bolão · toque pra ampliar</span>
          </div>
        )}
        {qrEnlarged && qrDataUrl && createPortal(
          <div
            onClick={() => setQrEnlarged(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(3,8,14,0.82)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 360 }}
            >
              <img src={qrDataUrl} alt="QR Code do convite ampliado" style={{ width: '100%', maxWidth: 280, borderRadius: 8 }} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', textAlign: 'center' }}>Escaneie para entrar no bolão</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQrEnlarged(false)}>Fechar</button>
            </div>
          </div>,
          document.body
        )}
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-2)' }}>Qualquer pessoa com o link pode entrar no grupo.</div>
      </div>

      {joinRequests.length > 0 && !showJoinRequestsModal && (
        <button
          type="button"
          onClick={() => setShowJoinRequestsModal(true)}
          className="card mt-4 fade-in-3"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 'var(--s10) var(--s16)', width: '100%', border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-raised))', cursor: 'pointer' }}
        >
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
            🔔 {joinRequests.length} pedido{joinRequests.length !== 1 ? 's' : ''} de entrada aguardando aprovação
          </span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>Decidir →</span>
        </button>
      )}

      {showJoinRequestsModal && createPortal(
        <div
          onClick={() => setShowJoinRequestsModal(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(3,8,14,0.82)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>🔔 Pedidos de entrada</span>
              <button type="button" onClick={() => setShowJoinRequestsModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-2)', margin: 0 }}>
              Entraram por um link repassado por outro membro — não o seu link direto de dono. Aprove só quem você reconhece.
            </p>
            {joinRequests.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: '12px 0' }}>Nenhum pedido pendente. 🎉</p>
            ) : joinRequests.map(req => (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--bg-overlay)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {req.name || req.email_masked}
                  </div>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)' }}>
                    {req.invited_by_name ? `via ${req.invited_by_name}` : 'via link'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    disabled={joinReqActionId === req.id}
                    onClick={() => approveJoinRequest(req.id)}
                    style={{ width: 30, height: 30, padding: 0, borderRadius: 8, border: '1px solid var(--win)', background: 'color-mix(in srgb, var(--win) 12%, transparent)', color: 'var(--win)', fontSize: 14, cursor: 'pointer' }}
                  >
                    {joinReqActionId === req.id ? '·' : '✓'}
                  </button>
                  <button
                    type="button"
                    disabled={joinReqActionId === req.id}
                    onClick={() => rejectJoinRequest(req.id)}
                    style={{ width: 30, height: 30, padding: 0, borderRadius: 8, border: '1px solid var(--lose)', background: 'color-mix(in srgb, var(--lose) 12%, transparent)', color: 'var(--lose)', fontSize: 14, cursor: 'pointer' }}
                  >
                    {joinReqActionId === req.id ? '·' : '✕'}
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowJoinRequestsModal(false)}>
              {joinRequests.length > 0 ? 'Decidir depois' : 'Fechar'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ── Chat do bolão ── */}
      <div className="card mt-4 fade-in-4">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>💬 Chat do Bolão</span>
          <button onClick={() => setShowChat(c => !c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>
            {showChat ? 'Ocultar ▲' : `Ver (${messages.length}) ▼`}
          </button>
        </div>
        {showChat && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ maxHeight: 300, overflowY: 'auto', padding: 'var(--s3) var(--s4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.length === 0 ? (
                <div style={{ color: 'var(--text-2)', fontFamily: 'var(--font-cond)', fontSize: 12, textAlign: 'center', padding: 'var(--s4)' }}>
                  Nenhuma mensagem ainda. Mande a primeira provocação! 😄
                </div>
              ) : messages.map(m => (
                <div key={m.id} style={{ display: 'flex', flexDirection: m.is_me ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: m.is_me ? 'var(--accent)' : 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: m.is_me ? '#fff' : 'var(--text-2)', flexShrink: 0 }}>
                    {getInitials(m.name)}
                  </div>
                  <div style={{ maxWidth: '75%' }}>
                    {!m.is_me && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-2)', marginBottom: 2, fontWeight: 700 }}>{m.name}</div>}
                    <div style={{ padding: '8px 12px', borderRadius: m.is_me ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: m.is_me ? 'var(--accent)' : 'var(--bg-raised)', border: m.is_me ? 'none' : '1px solid var(--border)', fontFamily: 'var(--font-body)', fontSize: 13, color: m.is_me ? '#fff' : 'var(--text-1)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {m.content}
                    </div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-3)', marginTop: 2, textAlign: m.is_me ? 'right' : 'left' }}>
                      {m.created_at ? new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8, padding: 'var(--s3) var(--s4)', borderTop: '1px solid var(--border)' }}>
              <input
                type="text" placeholder="Mande uma provocação..." maxLength={500}
                value={msgText} onChange={e => setMsgText(e.target.value)}
                style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, padding: '8px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg-raised)', color: 'var(--text-1)', outline: 'none' }}
              />
              <button type="submit" disabled={sendingMsg || !msgText.trim()}
                style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: sendingMsg || !msgText.trim() ? 0.5 : 1 }}>
                {sendingMsg ? '...' : '→'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* ── Conquistas ── */}
      {ranking.length > 0 && (
        <div className="card mt-4 fade-in-4" style={{ padding: 'var(--s4) var(--s5)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
            Conquistas {myBadgeIcons.size > 0 && <span style={{ color: 'var(--accent)' }}>· você tem {myBadgeIcons.size}</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {BADGE_CATALOG.map((b, i) => {
              const unlocked = myBadgeIcons.has(b.icon)
              const holders = badgeHolderCount[b.icon] || 0
              return (
                <div key={b.label} className={unlocked ? 'badge-unlocked' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, background: unlocked ? `${b.color}18` : 'var(--bg-raised)', border: `1px solid ${unlocked ? `${b.color}50` : 'var(--border)'}`, opacity: unlocked ? 1 : 0.55, animationDelay: unlocked ? `${i * 90}ms` : undefined }}>
                  <span style={{ fontSize: 18 }}>{b.icon}</span>
                  <div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: unlocked ? b.color : 'var(--text-1)' }}>
                      {b.label} {unlocked && '✓'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-2)' }}>{b.desc}</div>
                    {holders > 0 && (
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-3)', marginTop: 1 }}>{holders} do grupo já tem</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Evolution Chart ───────────────────────────────────────────────────────────
function EvolutionChart({ data }) {
  const { labels, series } = data
  if (!labels?.length || !series?.length) return null
  const memberCount = Math.max(...series.map(s => s.positions?.length ? Math.max(...s.positions) : 1), 1)
  const W = 300, H = 120, PAD = { t: 10, b: 28, l: 20, r: 10 }
  const chartW = W - PAD.l - PAD.r
  const chartH = H - PAD.t - PAD.b
  const xPos = i => PAD.l + (i / Math.max(labels.length - 1, 1)) * chartW
  const yPos = pos => PAD.t + ((pos - 1) / Math.max(memberCount - 1, 1)) * chartH

  return (
    <div style={{ padding: 'var(--s3) var(--s4)' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block' }} aria-label="Evolução de posições">
        {/* Grid lines */}
        {Array.from({ length: memberCount }, (_, i) => (
          <line key={i} x1={PAD.l} x2={W - PAD.r} y1={yPos(i + 1)} y2={yPos(i + 1)}
            stroke="var(--bg-overlay)" strokeWidth="1" />
        ))}
        {/* Series lines */}
        {series.map((s, si) => {
          if (!s.positions?.length) return null
          const color = LINE_COLORS[si % LINE_COLORS.length]
          const pts = s.positions.map((pos, i) => `${xPos(i)},${yPos(pos)}`).join(' ')
          return (
            <g key={s.user_id}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={s.is_me ? 2.5 : 1.5} strokeLinecap="round" strokeLinejoin="round" opacity={s.is_me ? 1 : 0.6} />
              {s.positions.map((pos, i) => (
                <circle key={i} cx={xPos(i)} cy={yPos(pos)} r={s.is_me ? 3 : 2} fill={color} opacity={s.is_me ? 1 : 0.6} />
              ))}
            </g>
          )
        })}
        {/* X-axis labels */}
        {labels.filter((_, i) => i === 0 || i === labels.length - 1 || labels.length <= 5 || i % Math.ceil(labels.length / 4) === 0).map((label, i, arr) => {
          const origI = labels.indexOf(label)
          return (
            <text key={i} x={xPos(origI)} y={H - 4} textAnchor="middle" fill="var(--text-3)" style={{ fontSize: 8, fontFamily: 'monospace' }}>{label}</text>
          )
        })}
        {/* Y-axis labels */}
        {Array.from({ length: Math.min(memberCount, 5) }, (_, i) => (
          <text key={i} x={PAD.l - 4} y={yPos(i + 1) + 3} textAnchor="end" fill="var(--text-3)" style={{ fontSize: 8, fontFamily: 'monospace' }}>{i + 1}º</text>
        ))}
      </svg>
      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {series.map((s, i) => (
          <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 3, borderRadius: 2, background: LINE_COLORS[i % LINE_COLORS.length] }} />
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: s.is_me ? 'var(--text-1)' : 'var(--text-2)', fontWeight: s.is_me ? 700 : 400 }}>
              {s.name}{s.is_me ? ' ★' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── FormDots ─────────────────────────────────────────────────────────────────
function FormDots({ form }) {
  return (
    <div className="form-dots" title={form.join(' ')}>
      {form.map((f, i) => (
        <div key={i} className={`form-dot form-dot--${f}`} title={f === 'E' ? 'Exato' : f === 'C' ? 'Certo' : 'Errado'} />
      ))}
    </div>
  )
}

// ── Duelo ─────────────────────────────────────────────────────────────────────
function DuelCard({ me, them }) {
  const stats = [
    { label: 'Pontos', me: me.total_points, them: them.total_points },
    { label: 'Exatos', me: me.exact_scores, them: them.exact_scores },
    { label: 'Certos', me: me.correct_results, them: them.correct_results },
    { label: 'Apostas', me: me.total_bets, them: them.total_bets },
  ]
  function aprv(r) {
    if (!r.total_bets) return 0
    return Math.round(r.total_points / (r.total_bets * 3) * 100)
  }
  return (
    <div style={{ padding: 'var(--s4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 'var(--s3)', alignItems: 'center', marginBottom: 'var(--s4)' }}>
        <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>{me.name} <span style={{ fontSize: 10, color: 'var(--text-3)' }}>você</span></div>
        <span style={{ fontFamily: 'var(--font-display)', color: 'var(--text-2)', fontSize: 16 }}>VS</span>
        <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: '#9b5de8', textAlign: 'right' }}>{them.name}</div>
      </div>
      {stats.map(s => {
        const meWins = s.me > s.them, tie = s.me === s.them
        return (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: meWins ? 'var(--win)' : tie ? 'var(--text-2)' : 'var(--text-2)', textAlign: 'right' }}>{s.me}</div>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: !meWins && !tie ? 'var(--win)' : tie ? 'var(--text-2)' : 'var(--text-2)' }}>{s.them}</div>
          </div>
        )
      })}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: aprv(me) >= aprv(them) ? 'var(--win)' : 'var(--text-2)', textAlign: 'right' }}>{aprv(me)}%</div>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Aproveito</span>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: aprv(them) > aprv(me) ? 'var(--win)' : 'var(--text-2)' }}>{aprv(them)}%</div>
      </div>
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────
function StatPill({ icon, label, value, sub, accent }) {
  return (
    <div style={{ background: accent ? 'var(--accent-dim)' : 'var(--bg-raised)', border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent ? 'var(--accent)' : 'var(--text-3)' }}>{icon} {label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: accent ? 'var(--accent)' : 'var(--text-1)', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-2)' }}>{sub}</div>}
    </div>
  )
}

function TeamChip({ t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {t?.flag_url && <TeamCrestFlag src={t.flag_url} alt={t.code} style={{ width: 32, height: 22, objectFit: 'cover', borderRadius: 3 }} crestStyle={{ width: 30, height: 30, objectFit: 'contain', borderRadius: 5, background: 'var(--bg-overlay)' }} />}
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{t?.code}</span>
    </div>
  )
}

function getInitials(name = '') {
  return name.split(' ').filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function WaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}
