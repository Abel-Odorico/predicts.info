# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**predicts.info** — Copa do Mundo 2026 simulator: Poisson + Elo + Monte Carlo, apostas por placar, ranking, grupos privados, Oracle LLM predictor.

- **URL:** https://predicts.info — porta interna 8130
- **Admin:** `grupopeepconnect@gmail.com` / `PeepTV10203040`
- **Dir:** `/opt/predicts/`

## Commands

```bash
# Backend (dentro de /opt/predicts/)
docker compose up -d                             # sobe API + DB + Redis
docker compose restart api                       # recarrega código Python (volumes montados)
docker compose logs -f api                       # logs da API
docker exec predicts_api python3 /tmp/script.py # rodar script no contexto da API

# Frontend
cd frontend && npm run build                     # build Vite → dist/
# O build já copia index-landing.html para dist/landing.html (veja package.json)

# Banco
docker exec predicts_db psql -U predicts -d predicts2026 -c "SELECT ..."

# Redis
docker exec predicts_redis redis-cli FLUSHALL   # flush cache (necessário após mudar engine)

# Forçar recálculo de simulações após mudar weights.py ou poisson.py:
# 1. FLUSHALL no Redis
# 2. POST /api/matches/{id}/simulate?force=true para cada partida scheduled
```

> ⚠️ `docker compose restart api` NÃO recarrega `env_file`. Para vars novas no `.env`: `docker compose up -d api` (re-cria container).

## Architecture

### Request Flow

```
nginx → 127.0.0.1:8130 → FastAPI (predicts_api)
                        → PostgreSQL (predicts_db)
                        → Redis (predicts_redis, cache simulações)
nginx → /opt/predicts/frontend/dist  (arquivos estáticos React)
```

A landing pública (`/`) é servida de `dist/landing.html` (gerado do `public/index-landing.html` no build). O app React serve todas as outras rotas via SPA.

### Backend (`backend/`)

**Entrypoint:** `main.py` — registra todos os routers, executa migrations no startup, dispara 4 loops assíncronos:
1. `_auto_sync_loop` — Wikipedia sync a cada `AUTO_SYNC_INTERVAL_HOURS` (padrão 1h)
2. `_daily_report_loop` — relatório Telegram às 07:00 e 14:00 BRT
3. `_oracle_predictor_loop` — Oracle LLM a cada 10min, dispara 60min antes de cada jogo
4. `_football_data_sync_loop` — football-data.org sync a cada 6h

**Schema / Migrations:** dois sistemas paralelos:
- **Alembic** — fonte de verdade para novas tabelas; `alembic upgrade head` roda no startup
- **`_run_migrations()` em `main.py`** — DDL legado idempotente (`CREATE TABLE IF NOT EXISTS`) para tabelas mais antigas; ainda necessário para compatibilidade

**Engine de simulação (`engine/`):**
- `poisson.py` — `GLOBAL_AVG_GOALS=1.50` (calibrado vs 64 jogos reais), Dixon-Coles ρ=-0.13, `analytical_probabilities()` retorna dict com prob_a/draw/b e top_scores
- `weights.py` — `compute_weighted_lambdas(team_a, team_b, phase)` → (lambda_a, lambda_b). Pesos calibrados: odds=45%, xG=25%, elo=20%, form=5%, mv=3%, wc=2%. Phase factor: group=1.0, r32/r16=0.88, qf/sf/final=0.82
- `monte_carlo.py` — `simulate_match(lambda_a, lambda_b, n=1_000_000)` via NumPy vetorizado; também `simulate_tournament()`
- `elo.py` — `elo_win_probabilities()`, `elo_to_attack_multiplier()`, K=32

**Fluxo simulação (`routers/matches.py`):**
1. Busca time_a, time_b como `TeamInput`
2. `compute_weighted_lambdas(ta, tb, phase=m.phase.value)` → lambdas
3. `simulate_match(la, lb)` → resultado
4. Cache duplo: Redis (TTL) + `SimulationCache` no PostgreSQL
5. Force-recalc via `?force=true`

**Sync de dados:**
- `world_cup_sync.py` — scraping Wikipedia: grupos, convocados, resultados, Elo, form. Fonte primária para dados de time.
- `routers/football_data_sync.py` — football-data.org API (token em `site_config.football_data_api_key`). Fonte primária para resultados FINISHED e bracket mata-mata. TLA codes batem 1:1 com `team.code`. Deduplication automática ao criar partidas.

**Pontuação apostas (V2, ativo desde 2026-06-21):**
- Placar exato → 5 pts
- Acerto vencedor → 1 pt (base)
- Acerto vencedor + placar do vencedor → +2 pts
- Acerto vencedor + placar do perdedor → +1 pt
- Empate errado (apostou empate mas não houve, ou vice-versa) → 0 pts

**Oracle LLM (`routers/bot.py`):**
- Prompt enriquecido: convocados, xG, form_10, h2h Copa, top 8 MC scores, 7 resultados recentes, 5 regras de decisão, hint de fase
- Provider chain: OpenRouter (claude-sonnet-4-5) → Gemini 3.5 Flash
- `_oracle_decide()` força OpenRouter primeiro (ignora ordem padrão de `_get_provider_chain`)
- `_call_llm()` em `analysis.py` aceita `chain` param para override

**LLM analysis (`routers/analysis.py`):**
- `_get_provider_chain(cfg)` — lê `site_config` para OpenRouter, OpenAI, Gemini keys
- `_call_llm(cfg, prompt, chain=None)` — itera chain até sucesso
- Ordem padrão da chain: Gemini primeiro (se key existir) → OpenAI → OpenRouter. Bot override esta ordem.

### Frontend (`frontend/src/`)

- **State:** Zustand (`stores/authStore.js`) — `user`, `token`, `login`, `logout`, `setUser`
- **API:** `api.js` — helpers `get/post/put/patch/delete` com token automático
- **Routing:** React Router; lazy loading em todas as páginas (`App.jsx`)
- **Tema:** light/dark/system; preferência salva no banco via `PATCH /api/auth/me`; script no `index.html` aplica antes do React montar (evita flash)

**Navegação mobile:**
- Dock bottom 5 colunas: Dashboard | Apostas | [FAB] | Ranking | Histórico
- FAB abre drawer com: Torneio, Resultados, Grupos, Meus Grupos + seção Admin condicional
- Topbar: logo + tema SVG + NotificationBell + avatar

**Tokens CSS:** `--accent: #0f7a78` · `--win: #2ec980` · `--lose: #e85252` · `--amber: #e8c44a`

### Key Patterns

**Enums do banco:**
```python
class MatchPhase(str, enum.Enum):
    group="group", r32="r32", r16="r16", qf="qf", sf="sf", third="3rd", final="final"
class MatchStatus(str, enum.Enum):
    scheduled="scheduled", live="live", finished="finished"
```

**Datetime:** sempre UTC naive via `_utcnow()` helper — nunca `datetime.utcnow()` direto.

**Admin protegido:** `Depends(require_admin)` em `auth_utils.py`.

**SimulationCache:** duplo — Redis para velocidade, PostgreSQL para persistência entre restarts. Invalidar ambos ao mudar engine.

**`GET /api/user-groups`** retorna objeto `{groups, pending_invites, next_match, my_bet_next}` — não array. Cuidado com `.map()` direto.

## Data Sources

| Dado | Fonte | Frequência |
|------|-------|-----------|
| Grupos, convocados, Elo | Wikipedia (world_cup_sync.py) | a cada 1h (auto) |
| Resultados FINISHED | football-data.org API | a cada 6h (auto) |
| Bracket mata-mata | football-data.org API | a cada 6h (auto) |
| Oracle pré-jogo | OpenRouter → Gemini | 60min antes do jogo |

Token football-data.org: `site_config.football_data_api_key` (limite: 100 req/dia).

## After Changing the Engine

Quando `weights.py` ou `poisson.py` mudam:
1. Restart da API: `docker compose restart api`
2. `docker exec predicts_redis redis-cli FLUSHALL`
3. Forçar recálculo das partidas scheduled via `POST /api/matches/{id}/simulate?force=true`
