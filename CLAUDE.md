# CLAUDE.md — predicts.info

Guia completo para Claude Code trabalhar neste repositório.

## Identidade do projeto

**predicts.info** — Simulador estatístico Copa 2026: Poisson + Elo + Monte Carlo, bolão de palpites, ranking, grupos privados, Oracle LLM predictor, competições por fase, PWA.

- **URL:** https://predicts.info
- **Dir:** `/opt/predicts/`
- **Porta interna:** 8130 (nginx → proxy)
- **Admin:** `grupopeepconnect@gmail.com` / `PeepTV10203040`
- **GitHub:** https://github.com/Abel-Odorico/predicts.info
- **DB:** `predicts2026` (PostgreSQL 16, container `predicts_db`)

---

## Comandos essenciais

```bash
# Containers
docker compose up -d                              # sobe todos
docker compose restart api                        # recarrega código Python (sem recriar)
docker compose up -d api                          # recria container (necessário para vars .env novas)
docker compose logs -f api                        # logs em tempo real
docker compose ps                                 # status containers

# Frontend
cd /opt/predicts/frontend && npm run build        # build Vite → dist/  (inclui landing.html)

# Banco
docker exec predicts_db psql -U predicts -d predicts2026 -c "SELECT ..."

# Redis
docker exec predicts_redis redis-cli FLUSHALL     # flush cache (obrigatório após mudar engine)

# Rodar script no contexto da API
docker exec predicts_api python3 /tmp/script.py

# Alembic dentro do container
docker exec predicts_api alembic upgrade head
docker exec predicts_api alembic revision --autogenerate -m "descrição"
```

> ⚠️ `docker compose restart api` NÃO recarrega `env_file`. Vars novas no `.env` → `docker compose up -d api`.

---

## Arquitetura

```
Browser
  ↓
nginx
  ├── location = /        → dist/landing.html  (landing SEO pública)
  ├── location /api/      → 127.0.0.1:8130     (FastAPI)
  └── location /          → dist/index.html    (React SPA)

FastAPI (predicts_api container)
  ├── PostgreSQL (predicts_db)   porta 5432
  └── Redis (predicts_redis)     porta 6379
```

Frontend serve direto de `/opt/predicts/frontend/dist` (sem cópia extra via nginx).

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + Uvicorn, Python 3.11 |
| Frontend | React 18 + Vite + React Router (lazy loading) |
| Banco | PostgreSQL 16 (container `predicts_db`, DB `predicts2026`) |
| Cache | Redis 7 (container `predicts_redis`) |
| Migrations | Alembic (fonte de verdade) + DDL legado idempotente em `_run_migrations()` |
| Proxy | nginx → porta 8130 |
| SSL | certbot ativo |

---

## Estrutura de arquivos

```
/opt/predicts/
├── docker-compose.yml
├── .env                         # vars de ambiente (não commitar)
├── backend/
│   ├── main.py                  # entrypoint: routers + migrations + 4 loops async
│   ├── models.py                # todos os ORM models (SQLAlchemy)
│   ├── schemas.py               # Pydantic schemas
│   ├── database.py              # engine + SessionLocal + get_db
│   ├── config.py                # Settings (pydantic-settings)
│   ├── auth_utils.py            # JWT + bcrypt + get_current_user + require_admin
│   ├── mail.py                  # send_email() STARTTLS/SSL
│   ├── world_cup_sync.py        # sync Wikipedia: grupos/jogos/convocados/Elo/form
│   ├── seed_data.py             # dados iniciais (grupos, times, partidas)
│   ├── alembic/                 # migrations versionadas
│   │   └── versions/            # 2 migrations: baseline + referred_by
│   ├── engine/
│   │   ├── poisson.py           # GLOBAL_AVG_GOALS=1.50, Dixon-Coles ρ=-0.13
│   │   ├── weights.py           # compute_weighted_lambdas(ta, tb, phase)
│   │   ├── monte_carlo.py       # simulate_match(la, lb, n=1_000_000) NumPy
│   │   └── elo.py               # elo_win_probabilities(), K=32
│   └── routers/
│       ├── achievements.py
│       ├── admin.py             # /admin/results, /admin/users, /admin/stats/growth, /admin/engagement
│       ├── analysis.py          # análises IA partidas — dual provider OpenRouter + Gemini
│       ├── analytics.py         # /api/analytics/* — page_views analytics
│       ├── audit.py             # log_action() + GET /admin/audit
│       ├── auth.py              # /auth/* — login, register, profile, theme, forgot/reset pw
│       ├── awards.py            # /tournament/awards — artilheiros/stats Wikipedia (Redis 30min)
│       ├── bets.py              # /bets/* — apostas por placar
│       ├── bot.py               # /admin/bot/* — Oracle LLM predictor + apostador bot (1111 linhas)
│       ├── champion.py          # /champion/* — pick campeão+vice, award bônus
│       ├── competition.py       # /competition/* — competição paralela por fase
│       ├── config.py            # /site-config/* — chave-valor admin
│       ├── football_data_sync.py# /admin/football-data/* — sync football-data.org
│       ├── groups.py            # /groups/* — grupos gerais
│       ├── health.py            # /health
│       ├── knockout.py          # /admin/knockout/* — mata-mata + run_knockout_sync()
│       ├── live.py              # /live/* — widget ao vivo global
│       ├── match_comments.py    # /matches/{id}/comments
│       ├── matches.py           # /matches/* — listagem + simulação por partida
│       ├── notifications.py     # /notifications/* + /admin/notifications/remind
│       ├── poll.py              # /poll/* — pesquisas (poll)
│       ├── push.py              # /push/* — Web Push VAPID
│       ├── pwa_icon.py          # /admin/pwa-icon
│       ├── ranking.py           # /ranking
│       ├── referral.py          # /me/referral — link convite ?ref=ID
│       ├── report.py            # relatório diário + notify_new_user/group_telegram
│       ├── sync.py              # /admin/sync-elo + /admin/sync-status
│       ├── teams.py             # /teams
│       ├── telegram.py          # /telegram/webhook — bot interativo
│       ├── tournament.py        # /tournament/* — grupos, bracket, bracket-sides
│       ├── user_groups.py       # /user-groups/* — bolões privados
│       ├── version.py           # /version/* — changelog de versões
│       └── videoupload.py       # /video/upload — token em site_config.video_upload_token
└── frontend/
    ├── index.html               # script init tema (evita flash)
    ├── public/
    │   ├── sw.js                # PWA service worker (cache predicts-v2)
    │   └── manifest.json
    └── src/
        ├── App.jsx              # rotas lazy-loaded
        ├── api.js               # fetch helpers get/post/put/patch/delete
        ├── stores/authStore.js  # Zustand persist
        ├── components/
        │   ├── Layout.jsx           # sidebar desktop + topbar mobile + dock + drawer + tema
        │   ├── AppPopups.jsx        # central de popups (versão + campeão), z-index 9500
        │   ├── NotificationBell.jsx # bell + painel slide + tabs lidas/não lidas
        │   ├── LiveFloating.jsx     # widget jogo ao vivo — fixo em todas as páginas
        │   ├── LiveClassificationCard.jsx
        │   ├── MyChampionCard.jsx   # compact=true (linha) / compact=false (2 cols)
        │   ├── ShareModal.jsx
        │   ├── ShareCompetitionButton.jsx
        │   ├── LigaFlowModal.jsx
        │   ├── ImageEditorModal.jsx
        │   ├── MatchComments.jsx
        │   ├── Onboarding.jsx
        │   ├── ProbBar.jsx
        │   ├── ScoreGrid.jsx        # prop highlightFirst destaca #1
        │   ├── Spinner.jsx
        │   └── VotacaoBanner.jsx
        ├── hooks/
        │   ├── useTrack.js
        │   ├── useAdSense.js
        │   ├── useInstallPrompt.js      # beforeinstallprompt + iOS/standalone
        │   └── usePushNotifications.js  # Web Push subscribe/unsubscribe
        ├── utils/teamNames.js
        └── pages/
            ├── Admin.jsx        # painel admin (11 abas)
            ├── AdminOptions.jsx # configurações site (5 abas)
            ├── Analytics.jsx
            ├── Bets.jsx         # apostas (3 abas: abertas / meus palpites / anteriores)
            ├── ChampionPick.jsx # /campeao — pick + tabela pública
            ├── Changelog.jsx    # /changelog — timeline de versões
            ├── Decisivos.jsx    # /decisivos — classificação ao vivo + artilheiros
            ├── Dashboard.jsx
            ├── ForgotPassword.jsx
            ├── GroupRanking.jsx # /meus-grupos/:groupId
            ├── Groups.jsx       # /grupos
            ├── JoinGroup.jsx    # /bolao/:token
            ├── Login.jsx
            ├── MatchSim.jsx     # /partida/:id
            ├── Profile.jsx
            ├── Ranking.jsx
            ├── Results.jsx      # /resultados (busca + filtro)
            ├── ResetPassword.jsx
            ├── Tournament.jsx   # /torneio — 2 abas: Chaveamento | Simulação
            ├── UserGroups.jsx   # /meus-grupos
            ├── UserHistory.jsx  # /usuarios/:userId/historico
            ├── Votacao.jsx      # /votacao
            └── (About/Contact/Privacy/Terms/Regras)
```

---

## Models (`backend/models.py`)

| Model | Tabela | Descrição |
|-------|--------|-----------|
| `Team` | `teams` | Seleção (name, code, flag_url, elo, avg_goals, xg, form_5, form_10…) |
| `Player` | `players` | Convocado (name, position, club, team_id) |
| `Match` | `matches` | Partida (team_a_id, team_b_id, match_date UTC naive, phase, status, venue, city) |
| `MatchResult` | `match_results` | Placar oficial (score_a, score_b) |
| `SimulationCache` | `simulations_cache` | Cache simulação (prob_a, prob_draw, prob_b, top_scores JSONB) |
| `TournamentSimulation` | `tournament_simulations` | Simulação torneio inteiro |
| `User` | `users` | Usuário (email, username, phone, name, password_hash, role, theme, referred_by FK) |
| `PasswordResetToken` | `password_reset_tokens` | Token reset senha (64 chars, expira 60min) |
| `Bet` | `bets` | Aposta (user_id, match_id, score_a, score_b, status, points_earned, evaluated_at) |
| `BotDecisionLog` | `bot_decision_logs` | Log decisões Oracle |
| `Ranking` | `rankings` | Pontuação (user_id unique, total_points, exact_scores, correct_results, total_bets) |
| `UserGroup` | `user_groups` | Bolão privado (name, owner_user_id, invite_token) |
| `UserGroupMember` | `user_group_members` | Membro do bolão (group_id, user_id, is_owner) |
| `UserGroupInvite` | `user_group_invites` | Convite pendente |
| `Poll` / `PollOption` / `PollVote` | polls… | Sistema de pesquisa |
| `GroupMessage` | `group_messages` | Mensagens no grupo |
| `AuditLog` | `audit_logs` | Ações (action, user_id, data JSONB) |
| `SiteConfig` | `site_config` | Chave-valor de configurações |
| `PageView` | `page_views` | Analytics (path, ip, country, device, browser) |
| `Notification` | `notifications` | Notificações in-app |
| `AppVersion` | `app_versions` | Changelog de versões |
| `PhaseCompetition` | `phase_competitions` | Competição paralela por fase (bolão âmbar) |
| `ChampionPick` | `champion_picks` | Pick campeão+vice por usuário |
| `ChampionAward` | `champion_awards` | Registro de bônus creditado (idempotente) |

> `PushSubscription` — definida em `routers/push.py` (não em `models.py` — inconsistência conhecida).

**Enums:**
```python
MatchPhase: group | r32 | r16 | qf | sf | third | final
MatchStatus: scheduled | live | finished
UserRole:    user | admin
```

**Datetime:** sempre UTC naive via `_utcnow()` — nunca `datetime.utcnow()` direto.

---

## Background loops (`main.py → lifespan`)

| Loop | Intervalo | Função |
|------|-----------|--------|
| `_auto_sync_loop` | 1h (delay 30s startup) | Wikipedia sync + Elo + Redis flush + knockout |
| `_daily_report_loop` | 07:00 e 14:00 BRT | Relatório Telegram |
| `_oracle_predictor_loop` | 10min (janela 120min antes do jogo) | Oracle LLM aposta + push |
| `_football_data_sync_loop` | 6h (delay 60s startup) | resultados FINISHED + bracket R32 |

Alterar intervalo do auto-sync: `AUTO_SYNC_INTERVAL_HOURS` em `.env` + `docker compose up -d api`.

---

## Migrations (`main.py → lifespan → startup`)

Execução no startup:
1. `_alembic_upgrade()` — `alembic upgrade head` (fonte de verdade para novas tabelas)
2. `_run_migrations()` — DDL legado idempotente (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`) para colunas antigas

Migrations Alembic existentes:
- `a48a2805d933` — baseline schema
- `0585e211e64e` — `referred_by` em users

Ao criar nova tabela/coluna: **usar Alembic** (`alembic revision --autogenerate`), não adicionar ao DDL legado.

---

## Engine de simulação

### Fluxo por partida (`routers/matches.py`)
1. Busca `team_a`, `team_b` como `TeamInput`
2. `compute_weighted_lambdas(ta, tb, phase=m.phase.value)` → `(lambda_a, lambda_b)`
3. `simulate_match(la, lb, n=1_000_000)` → `{prob_a, prob_draw, prob_b, top_scores}`
4. Cache duplo: Redis (TTL) + `SimulationCache` PostgreSQL
5. Force-recalc via `?force=true`

### Pesos (`engine/weights.py`)
```python
# pesos calibrados vs 64 jogos reais Copa 2026
WEIGHTS = {odds: 0.45, xg: 0.25, elo: 0.20, form: 0.05, mv: 0.03, wc: 0.02}

# phase factor reduz gols esperados em fases eliminatórias
PHASE_FACTOR = {group: 1.0, r32: 0.88, r16: 0.88, qf: 0.82, sf: 0.82, final: 0.82}

# base lambda usa GLOBAL_AVG_GOALS (não avg_goals do time) → evita double-counting
GLOBAL_AVG_GOALS = 1.50
```

### Poisson (`engine/poisson.py`)
- `GLOBAL_AVG_GOALS = 1.50` (calibrado vs 64 jogos)
- Dixon-Coles correction `ρ = -0.13` (ajusta 0-0 e 1-0)
- `analytical_probabilities()` retorna `{prob_a, prob_draw, prob_b, top_scores}`

### Após mudar `weights.py` ou `poisson.py`
```bash
docker compose restart api
docker exec predicts_redis redis-cli FLUSHALL
# forçar recálculo das partidas scheduled:
curl -X POST http://localhost:8130/api/matches/{id}/simulate?force=true
```

---

## Pontuação de apostas — V2 (ativo desde 2026-06-21, retroativo)

| Resultado | Pontos |
|-----------|--------|
| Placar exato | 25 |
| Vencedor + gols do vencedor | 18 |
| Vencedor + saldo de gols | 15 |
| Vencedor + gols do perdedor | 12 |
| Resultado correto (sem gols) | 10 |
| Errado | 0 |
| Acertar campeão | +100 |
| Acertar vice-campeão | +50 |

Implementado em `world_cup_sync.py → _score_points_v2()` e `admin.py → _calc_points()`.
`POST /api/admin/recalculate-bets-v2` — recalcula todas as apostas avaliadas (idempotente).

---

## Sync de dados

### Wikipedia (`world_cup_sync.py`)
- Parseia grupos, convocados, Elo, form, resultados
- Apaga e recria `MatchResult` do zero a cada run (rebuild completo)
- Avalia TODAS as bets + reconstrói `rankings`
- Notificações criadas só para bets recém-avaliadas (não duplica)
- Histórico em memória: últimos 10 runs

### football-data.org (`routers/football_data_sync.py`)
- **Token:** `site_config.football_data_api_key` (limite 100 req/dia, plano free)
- **TLA codes:** batem 1:1 com `team.code` (sem mapeamento)
- **Deduplication:** `sync_knockout` deleta conflitos (mesmo time, mesma fase, oponente diferente)
- **Endpoints admin:** `POST /api/admin/football-data/sync-results`, `POST /api/admin/football-data/sync-knockout`, `GET /api/admin/football-data/status`

---

## Oracle LLM predictor (`routers/bot.py`)

- **Loop:** `_oracle_predictor_loop` a cada 10min — dispara 120min antes de cada jogo
- **Provider chain (forçada):** OpenRouter (`anthropic/claude-sonnet-4-5`) → Gemini 2.5 Flash
  - Nota: `_oracle_decide()` força esta ordem, ignorando `_get_provider_chain()` (que colocaria Gemini primeiro)
- **Config:** chaves `oracle_openrouter_key`, `oracle_openrouter_model`, `oracle_gemini_key`, `oracle_gemini_model` em `site_config`
- **Prompt:** convocados (12/pos), xG, form_10, form_5, avg_goals, xGA, h2h Copa, top 8 MC scores, 7 resultados recentes, 5 regras de decisão, hint de fase
- **Push:** notifica usuários 2h antes do jogo com o palpite do Oracle
- **Telegram:** botão "🔮 Oráculo IA" no bot gerencial
- **Apostador bot:** cria bet automaticamente com o palpite Oracle; log em `bot_decision_logs`
- **Endpoints:** `GET /api/admin/bot/status`, `POST /api/admin/bot/bet`, `GET /api/admin/bot/bets`

---

## Análises IA por partida (`routers/analysis.py`)

- **Provider chain padrão:** Gemini (se key) → OpenAI → OpenRouter
- `_call_llm(cfg, prompt, chain=None)` — aceita chain override (usado pelo Oracle)
- **Config em `site_config`:** `analysis_provider`, `openrouter_api_key`, `openrouter_model`, `gemini_api_key`, `gemini_model`
- **Output JSON:** `overview`, `team_a.{tactical,key_players,form,strengths,weaknesses}`, `team_b`, `matchup`, `prediction`, `verdict`
- **Cache:** tabela `match_analyses` (unique por match_id)
- **Admin:** aba 🤖 Análises IA — config dual-provider, status por partida, gerar individual ou todas

---

## Sistema de notificações

### Tipos
| type | quando |
|------|--------|
| `bet_exact` | placar exato (+25 pts) |
| `bet_correct` | resultado correto (+10 pts) |
| `bet_wrong` | errado (0 pts) |
| `ranking_top3` | top 3 no ranking (dedup 1x/dia por posição) |
| `bet_reminder` | jogo próximo sem aposta |
| `version_update` | nova versão publicada |
| `poll_reminder` | pesquisa ativa sem voto |
| `champion_remind` | prazo campeão aberto, sem pick |
| `champion_bonus` | bônus campeão/vice creditado |

### Endpoints
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/notifications/unread-count` | poll a cada 60s no bell |
| GET | `/api/notifications?unread_only&type&limit&offset` | lista paginada |
| PATCH | `/api/notifications/{id}/read` | marca lida |
| PATCH | `/api/notifications/read-all` | marca todas lidas |
| POST | `/api/admin/notifications/remind?hours_ahead=` | cria lembretes |
| POST | `/api/admin/notifications/champion-remind` | lembra pick campeão (idempotente) |
| POST | `/api/admin/poll/notify-pending` | lembra votação |

---

## Telegram

### Relatório diário (`routers/report.py`)
- `push_daily_report(db)` — gera e envia; chamado pelo loop e por `POST /api/admin/daily-report/send`
- **Seções:** Usuários · Acessos · Apostas · Bolões · Último resultado · Próxima partida · Ranking top 10 · Destaque do dia
- **Bolões:** total, criados na semana, top 5 mais ativos (por apostas da semana)
- **parse_mode: HTML** (não MarkdownV2 — caracteres especiais quebravam)
- **Horários:** 07:00 e 14:00 BRT (`_DAILY_REPORT_TIMES = [(7,0),(14,0)]`)

### Notificações automáticas
- `notify_new_user_telegram(name, email, username)` — disparado em `BackgroundTask` no `POST /auth/register`
- `notify_new_group_telegram(group_name, owner_name)` — disparado em `BackgroundTask` no `POST /api/user-groups`

### Bot interativo (`routers/telegram.py`)
- **Webhook:** `POST /api/telegram/webhook` — auth por header `X-Telegram-Bot-Api-Secret-Token`
- **Comandos:** `/start`, `/menu` — painel com consultas inline (usuários, acessos, logins, apostas, ranking, geo, resumo, 🔮 Oráculo IA)
- **Setup:** `POST /api/admin/telegram/setup-webhook`, `GET /api/admin/telegram/webhook-info`

### Configuração (`site_config`)
- `telegram_bot_token` — token do @BotFather
- `telegram_chat_id` — chat destino (Abel: `167374464`)

---

## Web Push (VAPID)

- **Status:** ✅ ativo — chaves VAPID no `.env`, `pywebpush 2.0.0`
- **Endpoint público:** `GET /api/push/vapid-key` — retorna chave pública
- **Subscribe:** `POST /api/push/subscribe` (user autenticado)
- **Enviar push:** `send_push_to_all(db, title, body, url)` em `routers/push.py`
- **UI:** Profile.jsx — toggle ativar/desativar notificações
- **`PushSubscription` model:** definida em `routers/push.py` (não em models.py)

---

## Sistema de Campeão/Vice

- **Deadline:** dinâmica — `GET /api/champion/status` retorna `{can_change, deadline, ...}`
  - Frontend usa `canChange` da API, não deadline hardcoded
  - Admin pode reabrir via endpoint dedicado
- **Pick:** `POST /api/champion/pick` — campeão e vice independentes
- **Restrição:** vice deve estar no lado oposto do chaveamento (`/api/tournament/bracket-sides`)
- **Bônus:** `POST /api/admin/champion/award` — +100pts campeão / +50pts vice (idempotente, 409 se já creditado)
- **Prazo encerrado:** executar award quando Copa terminar (~18/07/2026)

---

## Competição paralela por fase (`routers/competition.py`)

- **Model:** `PhaseCompetition` — name, description, start_date, end_date, active, promo_text
- **Público:** `GET /api/competition/active`, `GET /api/competition/list`
- **Admin:** `GET/POST/PATCH/DELETE /api/admin/competitions`
- **Frontend:** popup de lançamento, card no Dashboard, ranking com tema âmbar, aba na Admin

---

## Sistema de referral (`routers/referral.py`)

- Campo `referred_by` (FK para users.id) em `User`
- `GET /api/me/referral` — retorna `{invite_url: "https://predicts.info?ref={user.id}", invited_count}`
- Cadastro via `?ref=ID` → `referred_by` salvo no registro do novo usuário

---

## Video upload (`routers/videoupload.py`)

- `POST /api/video/upload` — token via header `x-token`
- **Token:** `site_config.video_upload_token` (padrão: `peep2026`; configurável em `/admin/options` → aba Notificações)
- Arquivos salvos em `/tmp/predicts_uploads` (perdidos em restart — sem volume declarado)
- `GET /api/video/status` — lista últimos 5 uploads

---

## site_config — chaves de integração

| Chave | Uso |
|-------|-----|
| `telegram_bot_token` | Bot Telegram |
| `telegram_chat_id` | Chat destino relatório |
| `telegram_webhook_secret` | Segredo do webhook interativo |
| `telegram_allowed_chats` | Chats autorizados (vírgula-separados) |
| `video_upload_token` | Token header x-token para upload de vídeo |
| `football_data_api_key` | Token football-data.org (100 req/dia) |
| `analysis_provider` | Provider análises IA |
| `openrouter_api_key` / `openrouter_model` | OpenRouter análises |
| `gemini_api_key` / `gemini_model` | Gemini análises |
| `oracle_openrouter_key` / `oracle_openrouter_model` | OpenRouter Oracle (chaves separadas) |
| `oracle_gemini_key` / `oracle_gemini_model` | Gemini Oracle |
| `adsense_enabled` / `adsense_publisher_id` | Google AdSense |
| `banner_enabled` / `banner_text` | Banner de destaque |

Todos os valores via `GET /api/site-config/all` (admin) ou `GET /api/site-config/public` (público).
Salvar: `PUT /api/site-config/{key}` ou `POST /api/site-config/bulk`.

---

## Frontend — padrões

### Autenticação
- `stores/authStore.js` — Zustand persist: `user`, `token`, `login`, `logout`, `setUser`
- `api.js` — helpers `get/post/put/patch/delete` injetam `Authorization: Bearer {token}` automático

### Tema
- Modos: `light` | `dark` | `system`
- `localStorage('predicts_theme')` — modo salvo (não o resolvido)
- `index.html` script aplica tema antes do React montar (sem flash)
- Logado: `PATCH /api/auth/theme` sincroniza entre devices
- `system` escuta `matchMedia('(prefers-color-scheme: dark)')` em tempo real

### Navegação mobile
- **Topbar:** logo + ícone tema SVG + NotificationBell + avatar/Entrar
- **Dock:** grid 5 cols — Dashboard | Apostas | [FAB bola] | Ranking | Histórico
- **FAB:** bola de futebol SVG 24×24 + pulse; abre drawer; gira 90° + vermelho ao abrir
- **Drawer:** Torneio, Resultados, Grupos, Meus Grupos + seção Admin condicional + Sair/Entrar

### Design system
```css
--accent: #0f7a78   /* teal principal */
--win:    #2ec980   /* verde vitória */
--lose:   #e85252   /* vermelho derrota */
--amber:  #e8c44a   /* âmbar competição */
--font-display: Bebas Neue
--font-cond:    Barlow Condensed
--font-data:    JetBrains Mono
```

### Safe area (iPhone)
- `viewport-fit=cover` em `index.html`
- `.mobile-dock` e `.mobile-drawer` usam `env(safe-area-inset-bottom)`

### PWA
- `sw.js`: cache-first assets Vite, network-first API/navegação; versão `predicts-v2`
- `main.jsx`: registra SW globalmente no load
- `useInstallPrompt.js`: `beforeinstallprompt` + iOS standalone detect
- Pull-to-refresh em standalone, update banner automático

---

## Admin (`pages/Admin.jsx`) — 11 abas

| Aba | Conteúdo |
|-----|---------|
| 📈 Crescimento | GrowthChart (recharts) — cadastros/período |
| 🔥 Engajamento | streaks, top apostadores, inativos, próx/últ partida |
| 👥 Usuários | lista/busca/atualização de role |
| ⚽ Resultados | inserir resultado manual → avalia bets + notificações |
| 🔄 Sincronização | status sync + log 10 runs + forçar sync manual |
| 🎯 Apostas | cobertura de apostas por partida |
| 📋 Cobertura | stats de cobertura |
| 📊 Pesquisa | poll ativo + notify pendentes |
| 🔖 Versões | criar versão, notificar usuários, link changelog |
| 🖼 Ícone PWA | upload ícone PWA |
| ⚔️ Mata-Mata | sync Wikipedia, criar partida manual, award campeão/vice |

Layout: `flex-wrap` em 2 linhas. 641-1100px → icon-only. ≥1100px → icon+label.

## AdminOptions (`pages/AdminOptions.jsx`) — 5 abas

| Aba | Conteúdo |
|-----|---------|
| 🏷 Identidade | título, subtítulo, crédito, banner destaque |
| 📄 Páginas | privacidade, termos, sobre, contato (editores rich) |
| 🔔 Avisos & SEO | aviso usuários + meta tags |
| 💰 Anúncios | Google AdSense (publisher ID, slots) |
| ✈️ Notificações | Telegram (token + chat_id + webhook) + Token de vídeo |

Barra salvar fixa (sticky bottom): `Salvar` + `Descartar`. Badge por aba mostra campos sujos.

---

## Rotas frontend (`App.jsx`)

```
/               Dashboard
/dashboard      Dashboard
/partida/:id    MatchSim
/torneio        Tournament (Chaveamento | Simulação)
/grupos         Groups
/decisivos      Decisivos
/resultados     Results
/apostas        Bets
/ranking        Ranking
/meus-grupos    UserGroups
/meus-grupos/:groupId  GroupRanking
/bolao/:token   JoinGroup
/usuarios/:userId/historico  UserHistory
/admin          Admin
/admin/options  AdminOptions
/admin/analytics Analytics
/login          Login
/entrar         Login (modo register)
/privacidade    Privacy
/termos         Terms
/sobre          About
/contato        Contact
/perfil         Profile
/esqueci-senha  ForgotPassword
/redefinir-senha ResetPassword
/votacao        Votacao
/regras         Regras
/changelog      Changelog
/campeao        ChampionPick
```

---

## Armadilhas conhecidas

### `GET /api/user-groups` retorna objeto, não array
```js
// ERRADO — crasha com TypeError: v.map is not a function
setGroups(res || [])

// CORRETO
setGroups(Array.isArray(res) ? res : (res?.groups || []))
```
Retorna `{ groups: [...], pending_invites: [...], next_match: {...}, my_bet_next: bool }`.

### `sw.js` — não usar `w.navigate()` no `activate`
`self.clients.matchAll(...).then(wins => wins.forEach(w => w.navigate(w.url)))` força reload de todas as abas — causa navegação inesperada. Usar só `clients.claim()`.

### `match_date` sem timezone
API retorna UTC naive sem `Z`. Sempre: `new Date(v.endsWith('Z') ? v : v + 'Z')` antes de formatar.

### `SimulationCache` — colunas corretas
Tabela usa `prob_a`, `prob_draw`, `prob_b` direto — não tem coluna `data`.

### `db.rollback()` obrigatório após exceção em background task
Sem rollback → cascade `InFailedSqlTransaction` trava a session. Sempre `db.rollback()` no `except`.

### `docker compose restart api` não recarrega `.env`
Para vars novas: `docker compose up -d api` (recria o container).

### Token video_upload hardcoded (corrigido 2026-06-27)
Token agora em `site_config.video_upload_token`. Configurável em `/admin/options` → Notificações.

---

## SMTP (reset de senha)

- `mail.py`: `send_email()` via STARTTLS 587 ou SSL 465
- `multipart/alternative` com `text/plain` + `text/html` (crítico para entrega Gmail)
- Expiração token: 60 min; cada novo pedido deleta tokens anteriores não usados

```
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=noreplypeep@gmail.com
MAIL_PASSWORD=iijeudvgcwwrbbuc
```

---

## nginx

```nginx
location = / { root /opt/predicts/frontend/dist; try_files /landing.html =404; }
location /api/ { proxy_pass http://127.0.0.1:8130; ... }
location / { root /opt/predicts/frontend/dist; try_files $uri $uri/ /index.html; }
```

---

## Pendências

- **Creditar bônus campeão/vice:** executar `POST /api/admin/champion/award` quando Copa terminar (~18/07/2026)
- **Migrar DDL legado para Alembic:** `_run_migrations()` em `main.py` tem ~20 DDLs manuais; substituir e remover a função
- **Volume para `/tmp/predicts_uploads`:** vídeos perdidos em restart do container
- **`PushSubscription` para `models.py`:** model definido em `routers/push.py` — inconsistente
