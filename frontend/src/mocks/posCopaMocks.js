// MOCK DATA — página paralela /pos-copa (feature/multi-competitions-beta)
//
// Tudo neste arquivo é fictício, usado só pra validar layout/UX da fase
// multi-competições. Nenhum destes objetos é lido pelo backend.
//
// Quando a integração real acontecer:
//  - competitions      -> GET /competitions (tabela `competition`)
//  - openMatches       -> GET /competitions/:slug/matches?status=open (tabela `match`)
//  - myPredictions     -> GET /me/predictions (tabela `user_prediction`)
//  - leaderboards      -> GET /leaderboards?competition=:slug (tabela `leaderboard`)
//  - newsImpact        -> GET /news?competition=:slug (tabela `news_item`)
// Os nomes de campo abaixo já seguem o modelo conceitual genérico
// (competitions/matches/leaderboards), evitando acoplamento com "Copa".

export const MOCK_FLAG = true

export const competitions = [
  {
    id: 'wc2026',
    slug: 'copa-do-mundo-2026',
    name: 'Copa do Mundo 2026',
    country: 'FIFA',
    status: 'ativa', // 'ativa' | 'em-breve' | 'historica'
    blurb: 'A competição que já está rodando no Predicts hoje — simulador, chaveamento e ranking ao vivo.',
    color: '#e8c44a',
    features: ['Simulador', 'Chaveamento', 'Ranking', 'Palpites', 'Notícias', 'Probabilidades', 'Histórico final'],
    cta: 'Ver Copa do Mundo',
  },
  {
    id: 'brasileirao',
    slug: 'brasileirao',
    name: 'Brasileirão',
    country: 'Brasil',
    status: 'em-breve',
    blurb: 'Pontos corridos, 38 rodadas — palpite rodada a rodada e acompanhe as chances de título, G4 e Z4.',
    color: '#2ec980',
    features: [
      'Rodadas', 'Classificação', 'Palpites por rodada', 'Ranking geral', 'Ranking por rodada',
      'Probabilidade de título', 'Probabilidade de G4/G6', 'Probabilidade de Libertadores',
      'Probabilidade de Sul-Americana', 'Probabilidade de rebaixamento', 'Simulação da tabela final',
    ],
    cta: 'Quero ser avisado',
  },
  {
    id: 'libertadores',
    slug: 'libertadores',
    name: 'Libertadores',
    country: 'CONMEBOL',
    status: 'em-breve',
    blurb: 'Grupos + mata-mata continental. Palpite de campeão e probabilidade de classificação em cada fase.',
    color: '#4a90e8',
    features: [
      'Fase de grupos', 'Mata-mata', 'Classificados', 'Chaveamento',
      'Probabilidade de classificação', 'Probabilidade de título', 'Palpite de campeão', 'Ranking da competição',
    ],
    cta: 'Quero ser avisado',
  },
  {
    id: 'copa-do-brasil',
    slug: 'copa-do-brasil',
    name: 'Copa do Brasil',
    country: 'Brasil',
    status: 'em-breve',
    blurb: 'Mata-mata nacional cheio de zebra — ida e volta quando aplicável, jogo único nas fases finais.',
    color: '#e85252',
    features: [
      'Mata-mata', 'Jogos de ida e volta', 'Jogos únicos', 'Chance de classificação',
      'Chance de zebra', 'Palpite de classificado', 'Palpite de campeão', 'Ranking da competição',
    ],
    cta: 'Quero ser avisado',
  },
]

// Seleções (Copa do Mundo) usam bandeira real via flagcdn.com (mesma fonte do
// backend em seed_data.py). Clubes usam o escudo real via TheSportsDB (CDN
// pública, sem key) — troque por `flagUrl` da tabela `team` quando integrar.
export const openMatches = [
  {
    id: 'm1', competitionSlug: 'copa-do-mundo-2026', round: 'Grupo A · Rodada 2',
    home: { name: 'Brasil', code: 'BRA', flagUrl: 'https://flagcdn.com/w80/br.png' },
    away: { name: 'Japão', code: 'JPN', flagUrl: 'https://flagcdn.com/w80/jp.png' },
    kickoff: '2026-06-15T16:00:00-03:00', deadline: '2026-06-15T15:45:00-03:00',
    status: 'aberto', // aberto | encerrando | fechado | ao-vivo | finalizado
    probHome: 54, probDraw: 26, probAway: 20,
  },
  {
    id: 'm2', competitionSlug: 'brasileirao', round: 'Rodada 14',
    home: { name: 'Flamengo', code: 'FLA', flagUrl: 'https://r2.thesportsdb.com/images/media/team/badge/syptwx1473538074.png' },
    away: { name: 'Palmeiras', code: 'PAL', flagUrl: 'https://r2.thesportsdb.com/images/media/team/badge/vsqwqp1473538105.png' },
    kickoff: '2026-07-12T18:30:00-03:00', deadline: '2026-07-12T18:15:00-03:00',
    status: 'encerrando', probHome: 41, probDraw: 27, probAway: 32,
  },
  {
    id: 'm3', competitionSlug: 'libertadores', round: 'Oitavas · Ida',
    home: { name: 'River Plate', code: 'RIV', flagUrl: 'https://r2.thesportsdb.com/images/media/team/badge/03dmi31645539717.png' },
    away: { name: 'Grêmio', code: 'GRE', flagUrl: 'https://r2.thesportsdb.com/images/media/team/badge/uvpwyt1473538089.png' },
    kickoff: '2026-07-20T21:30:00-03:00', deadline: '2026-07-20T21:15:00-03:00',
    status: 'aberto', probHome: 46, probDraw: 28, probAway: 26,
  },
  {
    id: 'm4', competitionSlug: 'copa-do-brasil', round: 'Quartas · Jogo único',
    home: { name: 'Athletico-PR', code: 'CAP', flagUrl: 'https://r2.thesportsdb.com/images/media/team/badge/irzu1u1554237406.png' },
    away: { name: 'Fortaleza', code: 'FOR', flagUrl: 'https://r2.thesportsdb.com/images/media/team/badge/tosmdr1532853458.png' },
    kickoff: '2026-08-02T20:00:00-03:00', deadline: '2026-08-02T19:45:00-03:00',
    status: 'fechado', probHome: 38, probDraw: 30, probAway: 32,
  },
]

export const myPredictions = [
  {
    id: 'p1', competition: 'Copa do Mundo 2026', round: 'Grupo A · Rodada 1',
    home: 'Brasil', away: 'Japão', predHome: 2, predAway: 1,
    resultHome: 3, resultAway: 2, status: 'finalizado', pointsType: 'saldo', points: 15,
  },
  {
    id: 'p2', competition: 'Copa do Mundo 2026', round: 'Grupo A · Rodada 2',
    home: 'Brasil', away: 'Sérvia', predHome: 2, predAway: 0,
    resultHome: 2, resultAway: 0, status: 'finalizado', pointsType: 'exato', points: 25,
  },
  {
    id: 'p3', competition: 'Brasileirão', round: 'Rodada 13',
    home: 'Palmeiras', away: 'São Paulo', predHome: 1, predAway: 1,
    resultHome: null, resultAway: null, status: 'pendente', pointsType: null, points: null,
  },
]

export const leaderboardTypes = [
  { id: 'geral', label: 'Ranking geral' },
  { id: 'copa-do-mundo-2026', label: 'Copa do Mundo' },
  { id: 'brasileirao', label: 'Brasileirão' },
  { id: 'libertadores', label: 'Libertadores' },
  { id: 'copa-do-brasil', label: 'Copa do Brasil' },
  { id: 'semanal', label: 'Semanal' },
  { id: 'boloes', label: 'Bolões privados' },
]

// Mock por filtro — quando integrar, troca por
// useEffect(() => api.get(`/leaderboards?competition=${filter}`), [filter])
// mantendo o mesmo shape (rank/name/points/exactHits/evolution) pra não
// mexer no componente, só na origem do dado.
export const leaderboardsByFilter = {
  geral: [
    { rank: 1, name: 'Marcos T.', points: 1420, exactHits: 18, evolution: 3 },
    { rank: 2, name: 'Ana Beatriz', points: 1385, exactHits: 15, evolution: -1 },
    { rank: 3, name: 'Diego R.', points: 1340, exactHits: 14, evolution: 1 },
    { rank: 4, name: 'Carla M.', points: 1290, exactHits: 12, evolution: 0 },
    { rank: 5, name: 'Pedro L.', points: 1255, exactHits: 11, evolution: 2 },
  ],
  'copa-do-mundo-2026': [
    { rank: 1, name: 'Diego R.', points: 610, exactHits: 9, evolution: 2 },
    { rank: 2, name: 'Marcos T.', points: 590, exactHits: 8, evolution: 0 },
    { rank: 3, name: 'Pedro L.', points: 545, exactHits: 7, evolution: 1 },
    { rank: 4, name: 'Ana Beatriz', points: 520, exactHits: 6, evolution: -2 },
    { rank: 5, name: 'Carla M.', points: 505, exactHits: 6, evolution: 0 },
  ],
  brasileirao: [
    { rank: 1, name: 'Ana Beatriz', points: 380, exactHits: 5, evolution: 1 },
    { rank: 2, name: 'Carla M.', points: 365, exactHits: 5, evolution: 2 },
    { rank: 3, name: 'Marcos T.', points: 340, exactHits: 4, evolution: -1 },
    { rank: 4, name: 'Pedro L.', points: 310, exactHits: 3, evolution: 0 },
    { rank: 5, name: 'Diego R.', points: 295, exactHits: 3, evolution: -1 },
  ],
  libertadores: [
    { rank: 1, name: 'Pedro L.', points: 210, exactHits: 3, evolution: 1 },
    { rank: 2, name: 'Diego R.', points: 195, exactHits: 2, evolution: 0 },
    { rank: 3, name: 'Ana Beatriz', points: 180, exactHits: 2, evolution: 1 },
    { rank: 4, name: 'Marcos T.', points: 165, exactHits: 2, evolution: -1 },
    { rank: 5, name: 'Carla M.', points: 150, exactHits: 1, evolution: 0 },
  ],
  'copa-do-brasil': [
    { rank: 1, name: 'Carla M.', points: 175, exactHits: 2, evolution: 2 },
    { rank: 2, name: 'Marcos T.', points: 160, exactHits: 2, evolution: 0 },
    { rank: 3, name: 'Ana Beatriz', points: 150, exactHits: 1, evolution: 1 },
    { rank: 4, name: 'Diego R.', points: 140, exactHits: 1, evolution: -1 },
    { rank: 5, name: 'Pedro L.', points: 130, exactHits: 1, evolution: 0 },
  ],
  semanal: [
    { rank: 1, name: 'Pedro L.', points: 85, exactHits: 2, evolution: 4 },
    { rank: 2, name: 'Carla M.', points: 80, exactHits: 1, evolution: 1 },
    { rank: 3, name: 'Marcos T.', points: 75, exactHits: 1, evolution: -2 },
    { rank: 4, name: 'Diego R.', points: 70, exactHits: 1, evolution: 0 },
    { rank: 5, name: 'Ana Beatriz', points: 65, exactHits: 0, evolution: 1 },
  ],
  boloes: [
    { rank: 1, name: 'Marcos T.', points: 340, exactHits: 6, evolution: 0 },
    { rank: 2, name: 'Diego R.', points: 320, exactHits: 5, evolution: 1 },
    { rank: 3, name: 'Carla M.', points: 300, exactHits: 4, evolution: 2 },
    { rank: 4, name: 'Ana Beatriz', points: 285, exactHits: 4, evolution: -1 },
    { rank: 5, name: 'Pedro L.', points: 270, exactHits: 3, evolution: 0 },
  ],
}

// Regra de pontuação — copiada 1:1 do sistema atual, sem alterar valores.
// "labelSuggestions" é só cosmético (texto de exibição); a regra em si não muda.
export const scoringRules = [
  { key: 'exato', label: 'Placar exato', points: 25, example: { pred: [2, 1], result: [2, 1], team: ['Brasil', 'Japão'] } },
  { key: 'vencedor-gols', label: 'Vencedor + gols', points: 18, example: { pred: [2, 1], result: [2, 0], team: ['Brasil', 'Japão'] } },
  { key: 'saldo', label: 'Saldo correto', points: 15, example: { pred: [3, 1], result: [2, 0], team: ['Brasil', 'Japão'] } },
  {
    key: 'perdedor', label: 'Perdedor correto', points: 12,
    // nomenclatura original da regra: "PERDEDOR". Labels alternativos sugeridos
    // para validar com usuários antes de trocar em produção: "Acertou quem perdeu",
    // "Leitura do derrotado", "Derrotado correto". Mantendo "Perdedor correto" por ora.
    example: { pred: [0, 2], result: [1, 3], team: ['Brasil', 'Japão'] },
  },
  { key: 'resultado', label: 'Resultado correto', points: 10, example: { pred: [1, 0], result: [3, 2], team: ['Brasil', 'Japão'] } },
  { key: 'campeao', label: 'Campeão', points: 100, bonus: true, example: null },
  { key: 'vice', label: 'Vice-campeão', points: 50, bonus: true, example: null },
]

export const simulators = [
  {
    competition: 'Brasileirão', slug: 'brasileirao',
    cards: ['Simular tabela final', 'Chance de título', 'Chance de G4/G6', 'Chance de Libertadores', 'Chance de Sul-Americana', 'Chance de rebaixamento'],
  },
  {
    competition: 'Libertadores', slug: 'libertadores',
    cards: ['Simular fase de grupos', 'Simular mata-mata', 'Chance de classificação', 'Chance de título', 'Palpite de campeão'],
  },
  {
    competition: 'Copa do Brasil', slug: 'copa-do-brasil',
    cards: ['Simular chaveamento', 'Chance de classificação', 'Chance de zebra', 'Chance de campeão'],
  },
  {
    competition: 'Copa do Mundo', slug: 'copa-do-mundo-2026',
    cards: ['Simulador atual', 'Chaveamento', 'Histórico de palpites', 'Ranking final', 'Probabilidades finais'],
  },
]

export const newsImpact = [
  {
    id: 'n1', team: 'Argentina', headline: 'Jogador importante está fora por lesão',
    impact: 'Chance de vitória caiu de 54% para 48%', direction: 'down',
  },
  {
    id: 'n2', team: 'Flamengo', headline: 'Time deve poupar titulares no meio de semana',
    impact: 'Modelo reduz probabilidade de vitória fora de casa', direction: 'down',
  },
  {
    id: 'n3', team: 'Palmeiras', headline: 'Clube vem de sequência de 5 jogos sem perder',
    impact: 'Probabilidade de pontuar subiu na rodada', direction: 'up',
  },
]

export const pollOptions = ['Brasileirão', 'Libertadores', 'Copa do Brasil', 'Todos']

export const futureNav = [
  { label: 'Início', to: '/' },
  { label: 'Jogos de hoje', to: '/resultados' },
  {
    label: 'Competições', to: '/pos-copa',
    children: [
      { label: 'Copa do Mundo 2026', slug: 'copa-do-mundo-2026' },
      { label: 'Brasileirão', slug: 'brasileirao' },
      { label: 'Libertadores', slug: 'libertadores' },
      { label: 'Copa do Brasil', slug: 'copa-do-brasil' },
    ],
  },
  { label: 'Palpites', to: '/apostas' },
  { label: 'Ranking', to: '/ranking' },
  { label: 'Simulador', to: '/torneio' },
  { label: 'Notícias', to: '/pos-copa#noticias' },
  { label: 'Entrar', to: '/login' },
]
