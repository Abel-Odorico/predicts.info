---
name: melhorar-paginas-grupos
schema-version: 1
scope: project
status: ready
owner: human
max-iterations: 5
base-teorica: 2305.19118 (Self-Refine), 2502.19559 (Constitutional AI — separação gerador/avaliador)
---

# Melhorar páginas de grupos (predicts.info)

## Descrição
A cada volta, melhora cabeçalho e experiência visual/de engajamento de
`Groups.jsx`, `UserGroups.jsx` e `GroupRanking.jsx` (frontend/src/pages),
até um painel de dois avaliadores independentes aprovar as três páginas
contra uma rubrica congelada de design + retenção + motivação.

## Use quando
Rodar quando Abel pedir para deixar as páginas de grupos do predicts.info
mais bonitas/engajadoras. Não usar para mudar lógica de backend, regras de
pontuação, ou schema de API — o loop só mexe em frontend.

## Entradas
1. Arquivos-alvo: `frontend/src/pages/Groups.jsx`, `UserGroups.jsx`,
   `GroupRanking.jsx`.
2. Escopo liberado: os 3 arquivos acima + `frontend/src/components/` e
   `frontend/src/index.css` (CSS vars do tema), somente se usados por eles.
3. Fora de escopo: `backend/`, rotas, contratos de API, qualquer arquivo
   fora de `frontend/src/`.
4. Teto: 5 voltas.

## Meta
As 3 páginas de grupos têm: cabeçalho com hierarquia visual clara, visual
consistente com o design system do projeto (CSS vars em `index.css`, sem
cor hardcoded), pelo menos um mecanismo real de motivação/gamificação
ligado a dado da API (não decorativo/fake), e um gatilho de retenção
visível (razão concreta pro usuário voltar). Verificável? Não é numérico —
é juízo. Endurecido via rubrica congelada + painel de 2 avaliadores
independentes do gerador (ver Verificação).

## Verificação (o check que manda)

- Check primário: painel de 2 avaliadores independentes do gerador,
  aprovação unânime obrigatória —
  1. **Agente `gestor`** (sub-agente fresco, só lê diff + arquivos finais —
     nunca vê o raciocínio de quem implementou) pontua CADA página nos 6
     itens da rubrica abaixo, 1–5. Aprova a volta só se TODOS os itens de
     TODAS as 3 páginas ≥ 4.
  2. **Skill `code-review`** (effort medium) roda sobre o diff da volta.
     Aprova só se zero findings `CONFIRMED` de categoria correctness com
     severidade alta ou média.
  3. Volta aprovada = (1) E (2). Qualquer reprovação = reverter a volta
     inteira (`git checkout -- <arquivos tocados>`), registrar em
     `state.json` o motivo exato, tentar ângulo diferente na próxima volta.
- Evidência registrada: notas do gestor por critério/página (1–5 cada) +
  resultado do `code-review` + saída de `npx vite build`, tudo gravado em
  `state.json.attempts` a cada volta.

**Rubrica congelada (não reinventar a cada volta):**

| # | Critério | Pass (≥4) exige |
|---|----------|------------------|
| 1 | Cabeçalho | Hierarquia clara (contexto do grupo/usuário + posição/progresso em destaque + CTA visível); usa `var(--...)` do tema, não cor hardcoded |
| 2 | Consistência visual | Reusa padrões de componentes/Layout existentes; responsivo mobile-first (projeto é mobile-first); sem quebrar dark/tema atual |
| 3 | Motivação/gamificação real | Pelo menos 1 mecanismo novo ou reforçado (progresso visual, streak, comparação social, badge, milestone, contagem regressiva) ligado a dado real vindo da API — nunca estático/fake |
| 4 | Gatilho de retenção | Algo visível sem scroll excessivo que dá razão concreta pra voltar (próximo evento, meta clara, "sua posição mudou", etc.) |
| 5 | Sem regressão funcional | Toda chamada `api.get/post(...)` existente preservada; loading/error states mantidos; navegação/rotas intactas |
| 6 | Build limpo | `npx vite build` (dentro de `frontend/`) sai com código 0 |

- Regressão: `cd frontend && npx vite build` — falha = reprovação automática, nem chega no painel.
- Falha/timeout: registrar como falha da volta em `state.json`. Nunca tratar como sucesso.
- Pronto = 3 páginas aprovadas nas 6 linhas da rubrica na MESMA volta, pelo painel completo (gestor + code-review), E o gestor escrever explicitamente que considera o resultado "verdadeiramente bom" (não só "passou na rubrica no limite").

## Passos da volta
1. Reconciliar `state.json` com `git log --oneline -10` (voltas já commitadas) e `git status` (deve estar limpo ao iniciar).
2. Fotografar baseline: ler os 3 arquivos-alvo + componentes/CSS que eles importam, no estado atual.
3. Escolher, entre os 6 critérios da rubrica, o de maior gargalo ainda não tentado nesta rodada de voltas (consultar `attempts` em `state.json` — não repetir abordagem já rejeitada da mesma forma).
4. Implementar UMA mudança coesa (pode tocar as 3 páginas se for o mesmo conceito, ex: "cabeçalho" nas 3) — usar a skill `frontend-craft` como guia de qualidade visual/anti-genérico.
5. Rodar `cd frontend && npx vite build` (regressão). Se falhar, reverter e ir pro passo 7.
6. Se build ok: rodar painel — agente `gestor` (rubrica) + skill `code-review`. Aceitar só se ambos aprovarem TODAS as 3 páginas.
7. Aceitar → `git add <arquivos tocados>` + commit (1 commit por volta aprovada, mensagem descrevendo o critério trabalhado). Reprovar/erro → `git checkout -- <arquivos tocados>` (reverter tudo da volta).
8. Persistir `state.json` (volta N, critério tentado, resultado, motivo se reprovado, notas do gestor).
9. Avaliar parada.

## Estados de parada
- **sucesso:** painel aprova as 3 páginas nos 6 critérios na mesma volta E gestor confirma "verdadeiramente bom".
- **sem-progresso:** 2 voltas seguidas reprovadas sem nenhum critério novo passar de <4 pra ≥4 em nenhuma página.
- **bloqueado:** falta decisão de produto que só Abel resolve (ex: ambiguidade sobre que dado real usar pra um mecanismo de motivação que a API não expõe ainda).
- **esgotado:** 5 voltas rodadas sem atingir sucesso.

## Guardrails
- Teto: 5 voltas. Parar e reportar ao chegar em 5 sem sucesso — não continuar sozinho.
- Escopo travado: só os 3 arquivos-alvo + componentes/CSS compartilhados por eles. Tocar `backend/` = abortar a volta e marcar `bloqueado`.
- Nunca fazer `git push` sozinho. Commits ficam locais até Abel revisar.
- Nunca inventar dado (número de participantes, ranking, streak) que a API não retorna — motivação tem que vir de dado real.
- Uma mudança reversível por volta; commit por volta aprovada; revert imediato se reprovada.

## Memória / estado
`state.json` ao lado desta especificação, em `/opt/predicts/loops/melhorar-paginas-grupos/state.json`.
Campos: `round` (N atual), `attempts` (lista de {round, criterio, resultado, motivo}), `approved_criteria` (por página, quais dos 6 já passam), `status` (draft/running/sucesso/sem-progresso/bloqueado/esgotado), `last_gestor_notes`.

## Sub-loops (opcional)
Não se aplica.

## Como acionar
- `/goal Use o loop melhorar-paginas-grupos em /opt/predicts/loops/melhorar-paginas-grupos/melhorar-paginas-grupos-loop.md. Continue até sucesso, sem-progresso 2x seguidas, bloqueado, ou 5 voltas (esgotado). Sempre reconciliar state.json antes da volta.`

## Métrica de saúde
custo/mudança aceita = tokens gastos na volta / 1 (se aprovada) ou tokens gastos / 0 (se reprovada, registrar como custo perdido).
