# Contexto de Desenvolvimento — predicts.info

Este documento resume o estado técnico do `predicts.info` para retomada de desenvolvimento. Ele consolida a leitura do projeto em `/opt/predicts`, a skill local do Claude em `/root/.claude/skills/predicts` e as memórias de manutenção em `/root/.claude/projects/-root/memory/*predicts*.md`.

Não copie credenciais para este arquivo. Segredos devem ficar apenas em `.env`, `site_config` ou no painel administrativo apropriado.

## Identidade

`predicts.info` é uma plataforma de simulação estatística e bolão da Copa 2026. O produto combina previsão esportiva, apostas por placar, ranking, grupos privados, analytics, notificações, PWA, Oráculo LLM, Telegram e WhatsApp.

Stack principal:

- Backend: FastAPI + Uvicorn, Python 3.11.
- Frontend: React 18 + Vite + React Router, com lazy loading.
- Banco: PostgreSQL 16.
- Cache: Redis 7.
- Deploy: Docker Compose, nginx como proxy em `/api` e frontend estático em `frontend/dist`.
- Diretório de produção/desenvolvimento: `/opt/predicts`.

## Mapa Mental Do Produto

O sistema pode ser entendido em quatro blocos:

- Motor esportivo: Elo, Poisson/Dixon-Coles, Monte Carlo, pesos calibrados, H2H e projeções.
- Bolão e social: apostas, ranking, grupos privados, comentários, campeão/vice, conquistas.
- Operação e administração: resultados, syncs, analytics, auditoria, versões, configurações, WhatsApp, SEO e AdSense.
- Engajamento: PWA push, Telegram, WhatsApp, Oráculo LLM, e-mails de ativação, popups e banners.

Ao mexer no produto, preservar a consistência entre `Match`, `MatchResult`, `Bet`, `Ranking`, Redis e notificações é a prioridade. Essa cadeia define pontuação, confiança do usuário e comportamento do ranking.

## Arquivos Centrais

- `backend/main.py`: entrypoint FastAPI, inclui routers, migrations legadas e loops automáticos.
- `backend/models.py`: modelos SQLAlchemy.
- `backend/schemas.py`: schemas Pydantic.
- `backend/routers/bets.py`: criação, bloqueio e avaliação de apostas.
- `backend/routers/matches.py`: listagem e simulação por partida.
- `backend/routers/tournament.py`: grupos, bracket e simulação de torneio.
- `backend/routers/analytics.py`: page views, métricas, retenção, cohort e auditoria de apostas.
- `backend/routers/bot.py`: Oráculo LLM e bot apostador.
- `backend/routers/notifications.py`: notificações in-app e routing de push por tipo.
- `backend/routers/push.py`: Web Push VAPID.
- `backend/routers/whatsapp.py`: webhook, bot de palpites por WhatsApp, campanhas, grupos e painel admin.
- `backend/engine/weights.py`: pesos da engine estatística.
- `backend/projections.py`: mensagens de projeção, H2H via LLM e análise para Telegram/Oráculo.
- `backend/h2h_lookup.py`: leitura cache-only de confrontos diretos.
- `frontend/src/App.jsx`: rotas do app.
- `frontend/src/api.js`: helper de chamadas HTTP e tratamento de auth.
- `frontend/src/components/Layout.jsx`: layout global, navegação e componentes fixos.
- `frontend/src/components/NotificationBell.jsx`: sino e modal de notificação completa.
- `frontend/src/components/LiveFloating.jsx`: widget global de jogo ao vivo.
- `frontend/src/pages/Admin.jsx`: painel admin geral.
- `frontend/src/pages/AdminWhatsapp.jsx`: painel admin WhatsApp.
- `frontend/src/pages/MatchSim.jsx` e `MatchSimV2.jsx`: experiência da partida.
- `frontend/src/pages/Analytics.jsx`: analytics admin.

## Estado Atual Do Repositório

Na última leitura, o repositório estava na branch `feature/multi-competitions-beta`, com base no commit `778a963`.

Havia muitas alterações locais não commitadas, incluindo:

- módulos novos de WhatsApp;
- migrations Alembic novas;
- H2H e projeções;
- `MatchSimV2`;
- telas de alteração de e-mail e telefone;
- página `/pos-copa`;
- mudanças em analytics, notificações, auth, engine, frontend e admin.

Trate esse estado como trabalho ativo existente. Antes de refatorar ou reorganizar, revise o diff por tema e evite reverter mudanças que não foram feitas por você.

## Comandos Operacionais

Na raiz do projeto:

```bash
cd /opt/predicts
docker compose ps
docker compose logs -f api
docker compose restart api
```

Quando adicionar ou alterar variáveis de ambiente:

```bash
cd /opt/predicts
docker compose up -d api
```

`docker compose restart api` recarrega código Python, mas não recarrega novas variáveis de `.env`.

Build do frontend:

```bash
cd /opt/predicts/frontend
npm run build
```

Banco:

```bash
docker exec predicts_db psql -U predicts -d predicts2026 -c "SELECT ..."
```

Scripts dentro do container:

```bash
docker exec predicts_api python3 /app/update_world_cup_data.py
```

Depois de mudar a engine de simulação, limpe o cache:

```bash
docker exec predicts_redis redis-cli FLUSHALL
```

## Deploy E Servir Frontend

O nginx serve:

- `/` como landing pública gerada em `frontend/dist/landing.html`;
- `/api/*` para a API FastAPI;
- demais rotas para `frontend/dist/index.html`.

O frontend é servido diretamente de `frontend/dist`. Depois de mudanças em React, o publish efetivo é o `npm run build`; não há etapa extra de cópia para outro diretório.

## Loops Automáticos

`backend/main.py` cria tarefas de background no lifespan:

- auto-sync periódico;
- relatório diário Telegram;
- Oráculo Predictor antes dos jogos;
- sync football-data.org;
- push de lembrete para quem já apostou;
- WhatsApp de lembrete para quem ainda não apostou;
- e-mail D+1 para usuários sem aposta;
- avaliação automática de conquistas.

Esses loops rodam no processo da API. Alterações neles exigem restart da API.

## Sync De Resultados E Pontuação

O cron principal chama `scripts/update_world_cup_data.sh`, que executa `backend/update_world_cup_data.py`.

Fluxo importante:

1. `sync_finished_from_live_feed()` tenta preencher resultados de mata-mata via feed tropatech como fallback.
2. `apply_world_cup_snapshot()` sincroniza grupos via Wikipedia, reavalia apostas e reconstrói ranking.
3. `sync_team_stats()` atualiza força/forma.
4. `sync_knockout_matches()` atualiza mata-mata via Wikipedia.

Cuidados:

- O fallback de live feed só deve inserir resultado, nunca sobrescrever fonte autoritativa.
- A Wikipedia muda estrutura com frequência; parser frágil pode apagar ou deixar de recriar `match_results`.
- Diagnóstico útil para jogo finalizado sem resultado:

```sql
SELECT m.id
FROM matches m
LEFT JOIN match_results mr ON mr.match_id = m.id
WHERE m.status = 'finished'
  AND mr.match_id IS NULL;
```

Para correção manual, sempre confirme a ordem `team_a` e `team_b` antes de inserir resultado ou aposta.

## Engine Estatística

A engine fica em `backend/engine`.

- `poisson.py`: Dixon-Coles, média global de gols e scores recomendados.
- `monte_carlo.py`: simulação vetorizada NumPy.
- `elo.py`: probabilidade e multiplicadores Elo.
- `weights.py`: combinação dos fatores em `lambda_a` e `lambda_b`.

Estado atual dos pesos:

- `market_odds`: 53,7%.
- `xg`: 41,3%.
- `h2h`: 5%.
- demais fatores: 0%.

Observação importante: `market_odds` hoje não usa odds reais, porque `TeamInput.odds_win` não é populado. Na prática, esse fator cai no fallback baseado em Elo, por uma transformação diferente do fator Elo puro.

Ao alterar a engine:

- reinicie a API;
- limpe Redis;
- verifique simulação de partida;
- confira se `_data_hash` inclui qualquer novo dado que deve invalidar cache.

## Oráculo E Projeções

O Oráculo em `routers/bot.py` usa LLM como camada de decisão em cima do baseline estatístico.

Regra crítica:

- `ORACLE_CONFIDENCE_GATE = 85`.
- A IA só deve divergir do baseline com confiança suficiente ou ausência relevante.

Motivo: histórico real mostrou que permitir divergência fraca piorou a taxa de acerto do placar exato.

`projections.py` concentra a análise usada em mensagens Telegram e também reaproveitada pelo Oráculo. Evite duplicar cálculo de lambdas/H2H em vários lugares.

## H2H

`team_head_to_head` guarda confrontos diretos em cache.

Regras:

- A engine usa apenas leitura cache-only via `h2h_lookup.get_h2h_cached`.
- Não chamar LLM dentro de `/matches/{id}/simulate`, porque essa rota precisa baixa latência.
- Busca LLM e salvamento ficam no fluxo de projeções.
- H2H deve entrar no hash de cache de simulação, senão mudanças não invalidam Redis.

## WhatsApp

A frente de WhatsApp está avançada e deve ser tratada como área sensível.

Componentes:

- `backend/routers/whatsapp.py`: webhook, parser de mensagens, sessões de aposta, admin endpoints.
- `backend/whatsapp_client.py`: cliente Evolution API.
- `backend/whatsapp_campaign_worker.py`: processamento de campanhas.
- `frontend/src/pages/AdminWhatsapp.jsx`: painel admin.

Fluxo de aposta:

1. Usuário com opt-in manda texto, exemplo: `Brasil 2x1 Argentina`.
2. O parser casa times contra partidas próximas.
3. O sistema cria `WhatsappBetSession`.
4. Em mata-mata, pergunta quem avança se empatar no tempo normal.
5. Só grava `Bet` depois de confirmação explícita com `SIM`.
6. Sessão expira em 10 minutos.

Cuidados:

- Nunca gravar aposta por WhatsApp sem confirmação explícita.
- Número brasileiro pode ter ou não DDI `55` e nono dígito; usar `normalize_jid`, `resolve_number` e `_phone_core`.
- Evolution/Baileys pode retornar sucesso HTTP sem a mensagem chegar ao usuário.
- Menus interativos do WhatsApp podem não renderizar em todos os clientes; manter fallback textual.
- Campanhas em massa devem ter preview, confirmação e fila, não envio síncrono direto.
- Opt-in precisa ser respeitado para mensagens ativas.

## Frontend

Padrões importantes:

- Rotas ficam em `App.jsx` com lazy loading.
- Auth usa Zustand persist em `stores/authStore.js`.
- Componentes globais ficam no `Layout` ou logo abaixo dele em `App`.
- O service worker precisa ter cache versionado em `public/sw.js`.
- Use CSS variables existentes em `index.css`.

Armadilhas conhecidas:

- Não usar `Promise.all` para dados independentes quando uma falha parcial não deve apagar a tela; prefira `Promise.allSettled`.
- Tratar `401` com token presente, limpando sessão local.
- Não assumir que endpoint retorna array; exemplo: `/user-groups` retorna objeto com `groups`.
- Componentes que retornam `null` durante refetch causam flash visual; use cache de módulo ou skeleton de altura fixa.

## Notificações

Há dois canais:

- notificação persistente in-app na tabela `notifications`;
- push do sistema operacional via Web Push.

Nem todo push gera linha persistente. Alguns fluxos mandam push direto. Se a mensagem precisa ser recuperável depois, use criação de `Notification`.

O sino busca um limite finito de notificações. Se o volume crescer, será necessário paginação real na UI.

## Analytics

`routers/analytics.py` e `Analytics.jsx` cobrem:

- overview;
- usuários;
- páginas;
- geo;
- tech;
- recentes;
- apostas;
- retenção;
- cohort;
- auditoria.

Campos recentes em `page_views` incluem UTM e standalone/PWA. Ao alterar tracking, verificar backend, hook `useTrack.js` e dashboard admin juntos.

## Migrations

O projeto tem Alembic, mas também mantém DDL legado idempotente em `_run_migrations()`.

Antes de mexer em banco:

- prefira Alembic para mudanças novas;
- verifique se a cadeia de migrations tem um único head;
- confira se `_run_migrations()` não está duplicando ou mascarando a mudança;
- rode upgrade dentro do container quando necessário.

Comando:

```bash
docker exec predicts_api alembic upgrade head
```

## Regras De Segurança E Manutenção

- Não documentar senhas, tokens, chaves VAPID, SMTP, API keys ou secrets.
- Não apagar dados de apostas; o histórico é parte da confiança do bolão.
- Alterações em pontuação devem ser explícitas sobre serem retroativas ou forward-only.
- Antes de inserir resultado manual, confirmar `team_a` e `team_b`.
- Antes de mexer em sync, entender se a fonte é Wikipedia, live feed tropatech ou football-data.org.
- Antes de mexer em frontend logado, testar com token válido e expirado.
- Antes de publicar PWA, aumentar versão de cache em `sw.js` quando houver mudança relevante de assets.

## Checklist Para Retomar Desenvolvimento

1. Rodar `git status --short` e separar mudanças por tema.
2. Ler `CLAUDE.md`, este documento e as memórias relacionadas se o tema for uma área já problemática.
3. Validar se a alteração toca pontuação, ranking, cache ou notificações.
4. Implementar com escopo pequeno.
5. Rodar build ou teste mais próximo do ponto alterado.
6. Se backend mudou, reiniciar API.
7. Se engine/simulação mudou, limpar Redis.
8. Validar fluxo autenticado e deslogado quando a tela tiver comportamento diferente.

## Próximas Frentes Prováveis

Prioridade recomendada para estabilização:

- consolidar as alterações locais por tema;
- validar migrations Alembic;
- testar fluxo crítico de aposta/ranking;
- finalizar e testar WhatsApp com opt-in, webhook, campanha e aposta por mensagem;
- validar `MatchSimV2` antes de trocar a rota principal;
- decidir se `/pos-copa` e multi-competições beta ficam na branch atual ou viram branch separada.

