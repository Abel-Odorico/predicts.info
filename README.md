# Predicts.info

Plataforma web para simulacao da Copa do Mundo 2026 (e Brasileirao) com previsoes estatisticas, apostas por placar, ranking de usuarios, grupos privados, bot WhatsApp, analytics e painel administrativo.

## Arquitetura

![Arquitetura do predicts.info](docs/arquitetura.svg)

Diagrama gerado com [archify](https://github.com/tt-a1i/archify) (SVG dual-theme, acompanha o tema claro/escuro do GitHub). Fonte: `docs/arquitetura.architecture.json` — editar o JSON e re-renderizar para atualizar.

## Stack

- Frontend: React + Vite
- Backend: FastAPI
- Banco: PostgreSQL
- Cache: Redis
- Proxy web: Nginx
- Deploy local do projeto: Docker Compose

## Estrutura

- `frontend/`: app React, landing publica, assets gerados em `dist/`
- `backend/`: API FastAPI, modelos, rotas, engine de simulacao
- `scripts/`: utilitarios do projeto
- `docker-compose.yml`: sobe API, PostgreSQL e Redis

## Principais features

- Simulacao de partidas por rota `/partida/:id`
- Simulacao de torneio e bracket oficial
- Grupos da Copa, resultados, ranking e painel de dashboard
- Apostas por placar com bloqueio automatico no inicio do jogo
- Ranking por acertos
- Analytics com filtros de periodo + mapa de calor de acessos/apostas por hora
- Configuracoes de site, SEO e AdSense via admin
- Paginas institucionais editaveis no admin
- Credito publico "Desenvolvido por" editavel no admin
- Grupos privados de usuarios com convite e aceite
- Painel admin para cobertura de apostas por jogo
- Widget flutuante de jogo ao vivo (global, todas as paginas)

## Rotas principais do frontend

- `/`: landing publica
- `/dashboard`: painel principal
- `/partida/:id`: simulacao individual de partida
- `/torneio`: simulacao do torneio
- `/grupos`: grupos da Copa
- `/resultados`: resultados
- `/apostas`: apostas do usuario
- `/ranking`: ranking geral
- `/meus-grupos`: grupos privados do usuario
- `/admin`: painel administrativo
- `/admin/options`: configuracoes do site
- `/admin/analytics`: analytics
- `/privacidade`, `/termos`, `/sobre`, `/contato`: paginas institucionais publicas

## Backend e servicos

- API publicada atras do Nginx em `/api`
- Nginx serve o frontend estatico a partir de `frontend/dist`
- Docker Compose expoe a API localmente na porta `8130`

## Comandos uteis

Na raiz do projeto:

```bash
docker compose up -d
docker compose restart api
docker compose logs -f api
```

No frontend:

```bash
npm install
npm run build
```

## Deploy atual

- O frontend precisa ser rebuildado para publicar mudancas do app React:
  - `cd /opt/predicts/frontend && npm run build`
- A landing publica usa `frontend/public/index-landing.html` e deve ser sincronizada para:
  - `frontend/dist/landing.html`
  - `frontend/dist/index-landing.html`
- Mudancas de backend exigem restart da API:
  - `cd /opt/predicts && docker compose restart api`

## AdSense

Implementacao atual:

- snippet do AdSense no HTML publico
- metatag `google-adsense-account`
- `ads.txt` publicado na raiz do dominio
- configuracao do publisher e opcoes no painel admin

## Grupos privados de usuarios

O sistema possui dois conceitos diferentes:

1. `Grupos da Copa`
   - rota `/grupos`
   - representa os grupos oficiais do torneio

2. `Meus Grupos`
   - rota `/meus-grupos`
   - grupos privados de usuarios do bolao
   - dono cria grupo
   - convida por busca de usuario ou email
   - convidado precisa aceitar

## Observacoes tecnicas

- As tabelas novas de grupos privados sao criadas no startup da API via `Base.metadata.create_all(bind=engine)`.
- Endpoints autenticados retornam `401` sem token, o que ajuda a validar rapidamente se a rota esta registrada.
- O frontend usa persistencia local para auth e tema visual.

## Widget de jogo ao vivo (LiveFloating)

Componente `frontend/src/components/LiveFloating.jsx`, montado globalmente no `Layout.jsx` — aparece em todas as paginas do app.

- Fonte de dados: `GET /api/live/world-cup` (router `backend/routers/live.py`, feed `fg.peepstreaming.com`), poll a cada 10s.
- Filtra apenas jogos com `status === 'live'`. Sem jogo ao vivo, nao renderiza (`return null`).
- Pilula fixa no topo-centro (`position: fixed`, `top: env(safe-area-inset-top) + 70px`, `z-index: 8000`): bandeiras + placar + minuto/`status_raw` + dot pulsante vermelho.
- Permanece visivel ao rolar/tocar (sem auto-hide). Clique abre modal (portal `z-index 9000`) com todos os jogos ao vivo: placar, canais de transmissao, local e botao "Abrir partida" -> `/partida/:id`.

> Historico: era montado so em `/resultados` e sumia ao rolar (auto-hide por inatividade). Em 2026-06-23 virou global e fixo, com pilula maior.

## Mapa de calor por hora (Analytics)

Em `/admin/analytics` (visão geral), card "🔥 Mapa de Calor por Hora" com toggle Acessos / Apostas.

- Backend: `GET /api/analytics/stats` retorna `access_heatmap` e `bets_heatmap` — matrizes 7×24 (linha 0 = segunda … 6 = domingo; coluna = hora 0-23).
- Fontes: `page_views.created_at` (acessos) e `bets.created_at` (apostas), filtradas pelo período (`days`).
- Horário convertido para **Brasília (UTC-3)** no backend antes de agrupar por dia-da-semana × hora.
- Frontend: componente `HourHeatmap` em `Analytics.jsx` — intensidade da célula proporcional ao máximo, exibe total e hora de pico.

## Documentacao complementar

- [Guia Admin](./docs/ADMIN_GUIDE.md)
- [Contexto de Desenvolvimento](./docs/DEVELOPMENT_CONTEXT.md)
