# Plano — Copa do Brasil 2026 + Libertadores 2026

> Documento de planejamento. **Nada implementado.** Levantamento feito e verificado contra as APIs/fontes reais em **2026-07-15**.
> Requisito do Abel: dados reais, escudos reais, data e local reais, horário de Brasília.

---

## 1. Veredito

| Competição | Fonte de dados | Escudos | Sede (local) | Viabilidade |
|---|---|---|---|---|
| **Libertadores** | ✅ football-data.org `CLI` (id 2152) — mesma API key da Copa/BSA, já acessível | ✅ 47/47 | ⚠️ derivada do estádio do mandante (40/47) | **Alta** — mesmo pipeline do Brasileirão |
| **Copa do Brasil** | ⚠️ **Não existe na football-data.org** → **Wikipédia EN** (parse validado, free) | ⚠️ ~106 dos 126 clubes exigem **colheita one-shot** (§3.6) | ✅ real, por jogo (139/139) | **Média** — dado ok, escudo é logística |

As duas competições **compartilham clubes com o Brasileirão**, e o schema atual **não suporta isso**. Esse é o trabalho de verdade — não o sync.

**Provavelmente sem custo de API** (reenquadramento §3.6): o dado recorrente sai da Wikipédia (free, ilimitado) e da football-data (key que já temos); escudo é asset estático, colhido uma vez e versionado. Nenhum plano recorrente necessário.

---

## 2. Evidências coletadas (verificado, não presumido)

### 2.1 Libertadores — football-data.org

```
GET /v4/competitions            → CLI (2152) presente na key atual
GET /v4/competitions/CLI        → HTTP 200, season 2026 (04/02–28/11)
GET /v4/competitions/CLI/teams  → HTTP 200, 47 times
GET /v4/competitions/CLI/matches→ HTTP 200, 147 jogos
```

| Dado | Situação |
|---|---|
| Times | 47 (Brasil 8, Argentina 7, resto 4 cada) |
| Escudos | `crest` = `https://crests.football-data.org/{id}.png` — **47/47** |
| Estádio do clube | campo `venue` no listão de times — **40/47** (1 request, não 47) |
| Jogos | 147 · 125 FINISHED · 21 SCHEDULED · 1 CANCELLED |
| Fases (`stage`) | `ROUND_1` (6), `ROUND_2` (16), `ROUND_3` (8), `PLAY_OFFS` (16), `GROUP_STAGE` (96), `QUARTER_FINALS` (2), `SEMI_FINALS` (2), `FINAL` (1) |
| Grupos | A–H, 12 jogos cada |
| Data | `utcDate` em UTC → `-3h` para BRT (mesmo padrão já existente) |

**Custo de request**: 2 por sync (times + jogos). Free tier = 10/min. BSA já usa 2. Total 4/min — folgado.

### 2.2 Libertadores — dois problemas no payload

**(a) `venue` do jogo é `null`.** Confirmado em `/v4/matches/553203`: a chave `venue` existe e vem `None`. Ou seja, **a API não dá o local do jogo**. Prova disso já no banco: Brasileirão tem **0/380** jogos com `venue` preenchido.

→ Solução: `match.venue = team_a.venue` (estádio do mandante), com `is_neutral=False`. Cobre 40/47 clubes. **Exceções que quebram**: a final da Libertadores é jogo único em sede neutra (desde 2019) → manual. Mando trocado por punição/obra também erra silenciosamente.

**(b) Bracket futuro vem sem times:**

```
557182 QUARTER_FINALS 2026-09-08 SCHEDULED  None x None
557184 SEMI_FINALS    2026-10-13 SCHEDULED  None x None
557186 FINAL          2026-11-28 SCHEDULED  None x None
```

`Match.team_a_id` é `nullable=False` (`models.py:123`) → **esses 5 jogos não podem ser inseridos**. Só entram quando a CONMEBOL sortear. O sync precisa pular `homeTeam.id is None` e criar depois (o sync já é "nunca deleta, só insere/atualiza", então funciona — mas a página não pode prometer bracket completo).

### 2.3 Copa do Brasil — não tem API

Lista completa de competições da key atual (13): `BSA ELC PL CL EC FL1 BL1 SA DED PPL CLI PD WC`. **Copa do Brasil não está lá** — nem no free, nem no pago (football-data.org não cobre).

Wikipédia **existe e parseia bem**:

- PT: `Copa do Brasil de Futebol de 2026` · EN: `2026 Copa do Brasil` (usar EN — a infra atual já usa `en.wikipedia.org/w/index.php?action=raw`)
- Parse validado: **139/139** blocos `{{footballbox}}` com **stadium, location, date, time, score** preenchidos.

```
18 February 2026 20:30 | Ji-Paraná 2–0 Pantanal | Estádio Biancão / Ji-Paraná
18 February 2026 17:00 | Baré 0–3 Madureira     | Estádio Canarinho / Boa Vista
```

Também tem `{{TwoLegResult}}` (24) para os confrontos ida-e-volta e `{{football box collapsible}}`.

**Formato 2026** (mudou): **126 clubes** (era 92). Fases 1–4 jogo único; da 5ª fase até a semi ida-e-volta; **final em jogo único**. Clubes da Série A entram na 5ª fase.

⚠️ Fuso da Wikipédia: `time=19:00` é **hora local (BRT)**, não UTC. Banco é UTC → **somar 3h ao gravar**. Não confundir com o `utcDate` da football-data, que já é UTC.

---

## 3. Bloqueadores arquiteturais

### 3.1 🔴 CRÍTICO — `Team` só pertence a UMA competição

`Team.competition_id` é FK singular (`models.py:72`). Mas a **própria API modela o contrário**:

```
SE Palmeiras   runningCompetitions=['CLI', 'BSA']
CR Flamengo    runningCompetitions=['CLI', 'BSA']
```

Colisões medidas entre CLI e o banco atual:

| Tipo | Qtd | Exemplos |
|---|---|---|
| **Mesmo clube, `external_id` já no banco (comp 4)** | **8** | Flamengo, Palmeiras, Botafogo, Cruzeiro, Bahia, Corinthians, Fluminense, Mirassol |
| **Clube diferente, mesmo TLA** | 1 | Independiente Santa Fe (`SAN`) × Santos (`SAN`) |
| **TLA duplicado dentro da própria CLI** | 1 | Carabobo FC × Always Ready (ambos `CAR`) |
| Novos, sem colisão | 38 | — |

**Falha concreta se copiarmos `brasileirao_sync.py`:** `sync_teams` busca por `external_id` (linha 109) e, achando, faz **`existing.competition_id = comp_id`** (linha **127**). O guard das linhas 117–119 só protege o branch de time novo — **não** o branch de `external_id` encontrado.

> Resultado: o sync da CLI **arranca o Palmeiras do Brasileirão**. O cron do BSA (30min) devolve. O cron da CLI rouba de novo. **Dois crons brigando pelos mesmos 8 clubes, flip-flop a cada 30 minutos** — tabela do Brasileirão perdendo clube, Elo sendo recalculado em cima de lixo. Falha silenciosa, sem erro no log.

Com a Copa do Brasil é pior: **os 20 clubes da Série A inteiros** entram na 5ª fase.

**Constraints que travam:** `teams.code` UNIQUE **global** + `teams.external_id` UNIQUE **global** (`models.py:73-75`).

#### Opções

| | Opção A — N:N (`team_competitions`) | Opção B — linha de Team por competição ✅ |
|---|---|---|
| Mudança | Nova tabela de junção; `Team` vira global | Trocar UNIQUE global por UNIQUE `(competition_id, code)` e `(competition_id, external_id)` |
| Blast radius | **Alto** — todo `filter(Team.competition_id == X)` vira JOIN; quebra os 16 pontos da "Blindagem copa2026" | **Baixo** — o código **já filtra `competition_id` em todo lugar**; nada muda na leitura |
| Elo | Um Elo por clube (mistura BSA e CLI) | Elo por competição (isolado) |
| Custo | Refactor grande | 2 ALTERs + `TLA_FIX` por competição |

**Recomendação: Opção B.** A arquitetura inteira do projeto já é "filtra por `competition_id`" (é a Blindagem copa2026). A Opção B segue o grão do código; a A rema contra.

**Preço da Opção B, explícito:** `Team.code` deixa de identificar clube globalmente. Impacta:
- `team_head_to_head.team_a_code` (string solta, sem FK) — H2H all-time por code continua funcionando (é o mesmo clube), **mas** `SAN` fica ambíguo (Santos × Santa Fe).
- `team_names_pt.py::PT_NAMES` (code → nome PT) — mesma ambiguidade.
- Parse de aposta por WhatsApp (casa por nome/código).

### 3.2 🔴 `Team.code` é `String(3)` — pequeno demais para 126 clubes

126 clubes brasileiros em 3 letras é insustentável: Atlético-MG / Atlético-GO / Athletico-PR competem por `ATL`; América-MG / América-RN por `AME`. Já há TLA duplicado com só 47 times da CLI.

→ Ampliar para `String(6)` (ex.: `CAM`, `ACG`, `CAP`) ou slug. **Migration + revisão de todo lugar que assume 3 chars.**

### 3.3 🟡 Enum `matchphase` não cobre as fases novas

Hoje no PG: `group, r32, r16, qf, sf, third, final`.

| Competição | Fases faltando |
|---|---|
| Libertadores | prévia 1/2/3, play-offs (oitavas ida-volta) |
| Copa do Brasil | 1ª, 2ª, 3ª, 4ª, 5ª fase |

→ `ALTER TYPE matchphase ADD VALUE ...`. ⚠️ **Gotcha PG**: `ADD VALUE` não pode ser usado na mesma transação em que é criado; Alembic autogenerate não detecta mudança de enum. Fazer em migration manual, fora de transação.

### 3.4 🟡 Ida-e-volta não existe no modelo

Não há conceito de confronto agregado. Afeta Libertadores (play-offs→semi) e Copa do Brasil (5ª fase→semi).

| Escopo | O quê | Custo |
|---|---|---|
| **Mínimo** ✅ | Cada jogo é independente; palpite por jogo. Sem bracket, sem "quem avança" | Baixo — `_score_points_v2` já é genérico |
| Completo | Tabela `ties` (agregado, gol fora, pênaltis), bracket, palpite de quem avança | Alto |

Começar pelo mínimo. `Bet.et_winner_pick` (que existe) só faz sentido em jogo único — na volta de um confronto, "quem avança" é agregado, não do jogo.

### 3.5 🟡 Elo com amostra pequena = número sem significado

Não há clubelo para a América do Sul (gotcha já documentado) → hoje o BR usa **replay próprio da temporada** (380 jogos, base 1500).

| Competição | Jogos por time | Qualidade do replay |
|---|---|---|
| Brasileirão | 38 | OK (já em produção) |
| **Libertadores** | ~6–12 | **Fraco** — 6 jogos de grupo saindo de 1500 não separa Palmeiras de Always Ready |
| **Copa do Brasil** | **1–2** para clube pequeno | **Inútil** — mata-mata, clube eliminado na 1ª fase tem 1 jogo |

→ **Semear**, não replayar do zero: clube com linha no BSA herda o Elo de lá; resto entra em base por país/divisão. Sem isso, a projeção Monte Carlo dessas competições é ruído com cara de precisão. **Decidir antes de expor projeção ao usuário.**

### 3.6 🟢 Escudos da Copa do Brasil — *não* é bloqueador (reenquadrado 2026-07-15)

126 clubes. football-data.org só tem Série A (~20) + os da CLI. **Faltam ~106.**

**A pergunta certa não é "que API assinar", é "escudo é dado recorrente?".** Não é. **Escudo é asset estático** — o do Ferroviária não muda entre uma rodada e outra. Então separa:

| Necessidade | Frequência | Fonte | Custo |
|---|---|---|---|
| Jogo, data, hora, **sede**, placar | recorrente (cron) | **Wikipédia** — validado 139/139 | **free, sem limite** |
| **Escudo** | **uma vez, e pronto** | colheita one-shot → `assets/` local | **free** — 1–3 requests cabem em qualquer tier |

→ **Provavelmente não precisa pagar nada.** Nenhum plano recorrente é necessário: o dado vem da Wikipédia (já validado), e os 126 logos se colhem numa tacada só e ficam versionados no repo.

#### Por que NÃO usar api-sports.io como fonte de runtime

Free = **100 req/dia**. Cron de 30min = 48 syncs × 2 req = **96/dia por competição**. Copa do Brasil + Libertadores = **192 > 100**. Não fecha. Teria que cair pra 1h+ só pra caber no limite — enquanto a Wikipédia não tem limite nenhum e a football-data (10/min) já roda a CLI folgada. Usar api-sports em runtime é pagar (em dinheiro ou em latência de cron) por algo que já temos de graça.

#### Fontes de escudo (só a colheita one-shot)

| Fonte | Prós | Contras |
|---|---|---|
| **api-sports.io** (free, one-shot) | logos de todos os 126 | ⚠️ **ToS** — baixar e reservir pode ser redistribuição proibida. **Ler os termos antes** |
| Site da CBF | tem todos, oficial | scraping, sem contrato, quebra fácil; mesma dúvida de ToS |
| football-data.org | já temos key | só ~20 (Série A) + os da CLI — cobre os grandes, não os 106 |
| Wikipédia/Commons | já usamos wiki | escudo BR é **non-free (fair use)** no en.wiki, **não** está no Commons → risco de licença |
| Sem escudo pros pequenos | zero custo/risco | contraria o pedido explícito ("escudos reais") |

#### ⚠️ Não verificado (resolver antes de contar com api-sports)

- **League id da Copa do Brasil: desconhecido.** `73` é **Piauiense**, não Copa do Brasil — não hardcodar de memória.
- **Cobertura de temporada no free: contraditória nas fontes.** Uns dizem "historical seasons are limited" (free não pega 2026), outros dizem que a temporada atual entra. Site deles bloqueia fetch (403).
- **Como fechar em 2 min**: criar key free e chamar `GET /leagues?search=Copa do Brasil` → devolve o id e o array `seasons` com a cobertura real. Só depois disso decidir.
- **TheSportsDB: beco sem saída** — testado, o free (key `3`) capa em **5 resultados** em qualquer endpoint.
- **football-data.org: confirmado que não tem** Copa do Brasil (13 comps na key, não está lá; nem no pago).

> Nota: a doc do api-sports confirma, pra copa, "fixtures are automatically added when the two participating teams are known" — mesmo comportamento do bracket `null` da football-data (§2.2b). Trocar de fonte não resolve isso.

---

## 4. Decisões pendentes (Abel)

1. **Escudos da Copa do Brasil** — de onde colher os ~106 (§3.6)? api-sports free one-shot (checar ToS), scraping CBF, ou lançar sem escudo pros pequenos. **Não é mais decisão de assinar plano** — é de origem e licença do asset.
2. **Escopo** — Libertadores primeiro (caminho limpo) e Copa do Brasil depois? Ou as duas juntas?
3. **Ida-e-volta** — mínimo (palpite por jogo) ou bracket completo com agregado?
4. **Sede** — Libertadores com estádio do mandante derivado (erra final e mando trocado) serve, ou só local 100% confirmado?
5. **Elo semeado** — aceita herdar Elo do BSA, ou prefere não expor projeção nessas competições?

---

## 5. Plano de execução (após decisões)

### Fase 0 — Fundação (bloqueia todo o resto)

> ⏸️ **Gate acordado com o Abel (2026-07-15): só começar APÓS a final da Copa (19/07/2026).**
> Motivo: a Fase 0 altera constraints e o tamanho de `teams.code` — exatamente a tabela que o cron da Copa (5min) e o do BSA (30min) escrevem sem parar. Migration nessa tabela na semana da final = risco no produto vivo, no pico de tráfego e de pontuação. Depois de 19/07 o custo cai pra perto de zero.
>
> Ordem é obrigatória: **não dá pra começar pela Libertadores e migrar depois** — os 8 clubes brasileiros colidem já no primeiro sync (§3.1).

- Migration: UNIQUE `(competition_id, code)` e `(competition_id, external_id)`; dropar as UNIQUE globais
- Migration: `Team.code` → `String(6)`
- Migration manual: `ALTER TYPE matchphase ADD VALUE` para as fases novas
- Revisar consumidores de `code` global: `team_names_pt.py`, `h2h_lookup.py`, parse de aposta do WhatsApp
- **Teste de regressão obrigatório**: rodar o cron do BSA e o da Copa e confirmar que os 20 clubes do BR não mudam de `competition_id`

### Fase 1 — Libertadores
- `competitions`: `libertadores2026`, kind `cup`, status `upcoming`
- `routers/libertadores_sync.py` — clone do `brasileirao_sync.py` **com o bug da linha 127 corrigido** (nunca reatribuir `competition_id` de time existente de outra competição)
- `TLA_FIX` para `CAR` (Carabobo × Always Ready) e `SAN` (Santa Fe × Santos)
- Mapear `stage` → `phase`; **pular jogos com `homeTeam.id is None`**
- `venue` = estádio do mandante; final marcada manual
- Elo semeado do BSA para os 8 brasileiros
- `routers/libertadores.py`: tabela dos 8 grupos + rodada + ranking
- Página `/libertadores` (padrão `Brasileirao.jsx`) — aplicar o override de escudo quadrado (`.duel-bar__flag`)
- Cron 30min com `flock`, log próprio
- Prompt de análise IA dedicado (`_build_prompt_lib`) — clubes de 10 países, sem tabela na fase de mata-mata; **escopar `_auto_generate_analyses`** (gotcha já conhecido)

### Fase 2 — Copa do Brasil
- Depende da decisão de escudos
- `copa_do_brasil_sync.py` — parser do wikitext (`{{footballbox}}` + `{{TwoLegResult}}`), identidade por **nome** (não há `external_id`) → tabela de-para dos 126 clubes
- **`time` da wiki é BRT → +3h ao gravar em UTC**
- `venue`/`city` direto do `stadium=`/`location=`
- Elo semeado; clube sem histórico entra em base por divisão

### Fase 3 — Produto
- Link no menu, teaser, `status='active'`
- Comunicação (versão/notify) — **só com pedido explícito** (regra no-fan-out)

---

## 6. Gotchas novos (candidatos à skill depois)

| Problema | Nota |
|---|---|
| `sync_teams` reatribui `competition_id` de time existente (`brasileirao_sync.py:127`) | Com 2+ competições compartilhando clube, vira flip-flop entre crons. Guard das linhas 117-119 não cobre o branch de `external_id` achado |
| football-data.org: `venue` do **jogo** é sempre `null`; `venue` do **time** existe | Local do jogo só derivando do mandante — erra sede neutra (final da Libertadores) |
| Bracket da CLI vem com `homeTeam: null`, mas `Match.team_a_id` é `nullable=False` | Pular no sync, inserir quando sortear |
| Wikipédia `time=` é **hora local (BRT)**; football-data `utcDate` é **UTC** | Fontes com convenção oposta no mesmo banco (UTC) |
| Copa do Brasil não existe na football-data.org | Nem free, nem pago |
| `ALTER TYPE ... ADD VALUE` não roda na mesma transação; Alembic não autogera enum | Migration manual |
| Elo por replay exige amostra; mata-mata não tem | 1–2 jogos = Elo decorativo |
