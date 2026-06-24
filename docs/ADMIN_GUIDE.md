# Guia Admin

## Areas do painel

### `/admin`

Painel operacional principal.

Contem:

- Insercao manual de resultados
- Sincronizacao de dados reais
- Limpeza de cache
- Promocao de usuario para admin
- Apostas recentes
- Cobertura por jogo

### Cobertura por jogo

Secao nova no admin para verificar cobertura de apostas por partida.

Mostra:

- partida
- grupo
- data
- quantos usuarios ja apostaram
- quantos usuarios ainda nao apostaram
- lista nominal de quem apostou com placar
- lista nominal de quem ainda nao apostou

Filtros:

- `Abertos`
- `Finalizados`
- `Todos`

## `/admin/options`

Painel de configuracoes do site.

### Layout (abas)

A pagina e dividida em 5 abas — sem scroll unico longo:

| Aba | Conteudo |
|-----|----------|
| Identidade | Credito publico, Titulo/Subtitulo do site, Banner de destaque |
| Paginas | Privacidade, Termos, Sobre, Contato + emails |
| Avisos & SEO | Aviso aos usuarios + meta tags SEO |
| Anuncios | Campos AdSense + manual passo-a-passo |
| Notificacoes | Telegram (token, chat id, webhook, teste) |

Comportamento:

- Cards-resumo no topo tambem trocam de aba (mostram estado: ativo/pendente).
- Cada aba exibe um badge com o numero de campos alterados nao salvos.
- Barra de salvar fixa no rodape (`.admin-save-bar`, sticky): segue a rolagem,
  mostra "N alteracoes nao salvas" e tem botoes `Salvar` e `Descartar`.
- Aviso `beforeunload`: alerta ao recarregar/fechar com alteracoes pendentes.
- No mobile a barra fixa sobe acima do dock; abas viram rolagem horizontal.

Salvar:

- `Salvar` envia todos os campos alterados de uma vez (`POST /site-config/bulk`).
- `Descartar` re-busca a config do servidor (`GET /site-config/all`) e limpa o estado.
- Campos de grupo tambem tem botao "Salvar apenas este" (`PUT /site-config/{key}`).

### Identidade e credito

Campos importantes:

- `Titulo do site`
- `Subtitulo`
- `Desenvolvido por`

O texto `Desenvolvido por` aparece publicamente no app e na landing.

### Paginas publicas editaveis

Paginas:

- `/privacidade`
- `/termos`
- `/sobre`
- `/contato`

Cada pagina possui:

- titulo
- introducao
- conteudo

Formato do conteudo:

- usar `## Titulo da secao` para criar secoes
- separar paragrafos com linha em branco

Campos adicionais:

- `Email geral`
- `Email de privacidade`

### AdSense

Campos relevantes:

- `AdSense ativo`
- `Publisher ID`
- `Auto Ads`
- slots opcionais

Observacoes:

- o publisher precisa estar no formato `ca-pub-...`
- o `ads.txt` publicado usa `pub-...`
- a verificacao depende de snippet, meta e `ads.txt`

### Notificacoes — Telegram

Aba `Notificacoes`. Campos e acoes:

- `Bot Token` e `Chat ID` — credenciais (salvas em `site-config`).
- `Testar envio agora` — dispara `POST /admin/daily-report/send` na hora.
- `Ativar bot/menu` — registra webhook (`POST /admin/telegram/setup-webhook`).
- `Status do bot` — `GET /admin/telegram/webhook-info`.

**Cron do relatorio diario — onde fica:**

NAO e cron do sistema (sem crontab) e NAO e configuravel pela pagina de
configuracoes nem pelo `/admin`. O agendamento vive no **codigo do backend**:

- `backend/main.py` -> `_daily_report_loop()` (loop asyncio).
- Iniciado no startup do FastAPI: `report_task = asyncio.create_task(_daily_report_loop())`.
- Horarios definidos na constante `_DAILY_REPORT_TIMES = [(7, 0), (14, 0)]` em
  `main.py` — envia o relatorio **as 07:00 e as 14:00 BRT**, todo dia.
- O loop calcula o proximo horario da lista e chama `push_daily_report`
  (`routers/report.py`).
- Para adicionar/mudar horario: editar a lista `_DAILY_REPORT_TIMES` (tuplas
  `(hora, minuto)`) e reiniciar o backend (`docker compose restart api`).

A pagina de configuracoes so guarda token/chat id e permite teste manual —
o disparo automatico e do processo do servidor.

### Notificacao de novo usuario

Alem do relatorio agendado, o admin recebe um aviso no Telegram **toda vez
que um novo usuario se cadastra** — automatico, sem configuracao extra.

- Disparado em `POST /auth/register` (`routers/auth.py`) via `BackgroundTask`,
  apos a resposta do cadastro (nao bloqueia/atrasa o registro).
- Funcao: `notify_new_user_telegram(name, email, username)` em
  `routers/report.py` — best-effort (engole erro, nunca quebra o cadastro).
- Usa o mesmo bot/chat do relatorio (`telegram_bot_token` / `telegram_chat_id`
  em `site-config`; fallback `settings.telegram_*`). Se nao houver token/chat,
  apenas nao envia.
- Mensagem (HTML): nome, email, @username (se houver) e total de usuarios.

```
🆕 Novo usuário no Predicts

👤 [nome]
✉️ [email]
🔖 @[username]

📊 Total de usuários: [N]
```

## `/admin/analytics`

Painel de analytics.

Filtros de periodo:

- `Hoje`
- `7 dias`
- `14 dias`
- `30 dias`
- `90 dias`
- `1 ano`

Afeta:

- KPIs
- views por dia
- paginas
- geografico
- tecnologia
- visitas recentes

## Operacao de apostas

### Tela publica `/apostas`

Comportamento atual:

- jogos abertos mostram formulario inline de aposta
- usuario pode atualizar aposta enquanto a partida nao iniciou
- card da aposta possui botao `Ver Simulacao`

### Regras

- `3 pts`: placar exato
- `1 pt`: resultado correto
- `0 pt`: sem acerto

## Grupos privados dos usuarios

### Rota do frontend

- `/meus-grupos`

### Fluxo

1. usuario autenticado cria um grupo
2. criador vira dono do grupo
3. dono pode convidar:
   - por busca de usuario
   - por email
4. usuario convidado recebe convite pendente
5. convite precisa ser aceito ou recusado

### Estado atual

Disponivel:

- criar grupo
- listar membros
- listar convites pendentes
- buscar usuarios
- convidar por email
- aceitar convite
- recusar convite

Ainda nao implementado:

- remover membro
- cancelar convite
- ranking isolado por grupo privado
- link magico de convite

## Endpoints novos

### Admin

- `GET /api/admin/bets/coverage`

### Grupos privados

- `GET /api/user-groups`
- `POST /api/user-groups`
- `GET /api/user-groups/users/search?q=...`
- `POST /api/user-groups/{group_id}/invites`
- `POST /api/user-groups/invites/{invite_id}/accept`
- `POST /api/user-groups/invites/{invite_id}/reject`

## Deploy de mudancas

### Mudancas de frontend

```bash
cd /opt/predicts/frontend
npm run build
```

### Sincronizar landing

```bash
cp /opt/predicts/frontend/public/index-landing.html /opt/predicts/frontend/dist/landing.html
cp /opt/predicts/frontend/public/index-landing.html /opt/predicts/frontend/dist/index-landing.html
```

### Mudancas de backend

```bash
cd /opt/predicts
docker compose restart api
```

## Validacao rapida

Sem autenticar:

- rotas protegidas devem responder `401`

Com admin autenticado:

- abrir `/admin`
- abrir `/admin/options`
- abrir `/admin/analytics`
- validar nova secao de cobertura de apostas

Com usuario autenticado:

- abrir `/meus-grupos`
- criar grupo
- enviar convite
- aceitar convite com o usuario convidado

## Atalhos do painel admin (v2.4.0)

Header do `/admin`:

- `🎯 Apostas` -> `/apostas`
- `📋 Resultados` -> `/resultados`
- `📊 Analytics` -> `/admin/analytics`
- `🔐 Auditoria` -> `/admin/analytics?tab=audit` (abre direto na aba; `Analytics` le `?tab=` da URL)
- `⚙️ Config` -> `/admin/options`

Tabela de usuarios: botao `📜 Historico` por linha -> `/usuarios/<id>/historico` (palpites do usuario).

## Auditoria de apostas

Tentativas de aposta bloqueadas sao registradas em `audit_logs` com `action='bet.rejected'`.

- Motivos: `bets_closed` (prazo encerrado / jogo `finished`), `match_not_found`.
- Detalhes gravados: `match_id`, `score_a/score_b` tentados, `match_status`, `match_date`, IP.
- Ver em `/admin/analytics` -> aba `🔐 Auditoria`, filtro de acao `bet.rejected`.

Util quando usuario diz "apostei mas nao salvou": se houver `bet.rejected`, a aposta foi enviada apos o prazo (kickoff). Sem registro = aposta nunca chegou ao servidor.

## Sincronizacao de jogos / pontuacao

- Cron a cada 5 min: `/opt/predicts/scripts/update_world_cup_data.sh`. Re-parseia Wikipedia, recria `match_results`, reavalia todas as apostas e reconstroi `rankings`.
- Apostas fecham no `match_date` (kickoff, UTC) OU quando o jogo vira `finished`.
- Jogo que ganha artigo proprio na Wikipedia (`{{#lst:...}}`) e seguido ate o sub-artigo pelo parser (corrigido em v2.4.0). Antes era pulado em silencio -> apostas nao pontuavam.
- Re-pontuar manualmente apos editar dados: `docker compose exec api python3 /app/update_world_cup_data.py`.
