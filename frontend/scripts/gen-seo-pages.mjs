// Gera shells SEO por rota a partir do dist/index.html buildado.
// Cada shell tem title/description/canonical/og próprios — corrige o problema
// de todas as rotas da SPA declararem canonical https://predicts.info/.
// Rodado automaticamente no `npm run build` (ver package.json).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const base = readFileSync(join(dist, 'index.html'), 'utf8')

const ROUTES = {
  dashboard: {
    title: 'Predicts.info — Estatísticas e Palpites: Copa 2026 e Brasileirão ao Vivo',
    description:
      'Probabilidades ao vivo da reta final da Copa 2026 e do Brasileirão Série A, com simulação Monte Carlo, Elo e xG. Dê seu palpite de placar e dispute o ranking. Grátis.',
  },
  torneio: {
    title: 'Quem vai ganhar a Copa 2026? Probabilidades das 48 Seleções | Predicts.info',
    description:
      'Probabilidades de título da Copa do Mundo 2026 para todas as 48 seleções: chances de oitavas, quartas, semifinal e final, recalculadas a cada rodada com Elo + Monte Carlo.',
  },
  grupos: {
    title: 'Classificação dos Grupos da Copa 2026 — Tabela Atualizada | Predicts.info',
    description:
      'Tabela completa dos 12 grupos da Copa do Mundo 2026 com pontos, saldo de gols e classificados para o mata-mata. Atualizada automaticamente após cada jogo.',
  },
  resultados: {
    title: 'Resultados da Copa do Mundo 2026 — Placares de Todos os Jogos | Predicts.info',
    description:
      'Todos os resultados da Copa 2026: placares, estádios e cidades de cada partida, da fase de grupos à final. Acompanhe o progresso do torneio jogo a jogo.',
  },
  ranking: {
    title: 'Ranking do Bolão da Copa 2026 — Quem Está na Frente | Predicts.info',
    description:
      'Ranking geral do bolão da Copa do Mundo 2026. Veja quem mais acertou palpites de placar, dispute o pódio e crie seu grupo privado com amigos. Grátis.',
  },
  sobre: {
    title: 'Sobre o Predicts.info — Como Funciona o Simulador da Copa 2026',
    description:
      'Conheça o Predicts.info: simulador estatístico da Copa 2026 com ratings Elo, modelo de Poisson e Monte Carlo, além de bolão gratuito com palpites de placar.',
  },
  historia: {
    title: 'A História das 4 Semifinalistas da Copa 2026 — Argentina, Inglaterra, França e Espanha',
    description:
      'Argentina, Inglaterra, França e Espanha somam 7 títulos mundiais entre si. Relembre os momentos que marcaram a história de cada seleção antes das semifinais da Copa 2026.',
  },
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

mkdirSync(join(dist, 'seo'), { recursive: true })

for (const [route, meta] of Object.entries(ROUTES)) {
  const url = `https://predicts.info/${route}`
  let html = base
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"/,
      `<meta name="description" content="${esc(meta.description)}"`,
    )
    .replace(
      /<link rel="canonical" href="[^"]*"/,
      `<link rel="canonical" href="${url}"`,
    )
    .replace(/<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`)
    .replace(
      /<meta property="og:title" content="[^"]*"/,
      `<meta property="og:title" content="${esc(meta.title)}"`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*"/,
      `<meta property="og:description" content="${esc(meta.description)}"`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*"/,
      `<meta name="twitter:title" content="${esc(meta.title)}"`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*"/,
      `<meta name="twitter:description" content="${esc(meta.description)}"`,
    )
  writeFileSync(join(dist, 'seo', `${route}.html`), html)
}

console.log(`SEO shells geradas: ${Object.keys(ROUTES).join(', ')}`)
