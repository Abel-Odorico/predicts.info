---
name: predicts-seo
schema-version: 1
scope: project
status: ready
owner: human
max-iterations: 5
base-teorica: 2305.19118 (Self-Refine), 2502.19559 (Constitutional AI — separação gerador/avaliador)
---

# SEO Predicts.info até 95+ (skill seo-mestre)

## Descrição
A cada volta, aplica UMA correção reversível de SEO técnico/performance no
site vivo (https://predicts.info/, código em `/opt/predicts/frontend/` e
`/etc/nginx/sites-available/predicts.info`), até a nota geral da auditoria
`seo-mestre` (`/root/.claude/skills/seo-mestre/`) atingir 95+, medida por
avaliador independente com evidência real (curl + Lighthouse ao vivo).

## Use quando
Rodar quando Abel pedir para continuar subindo a nota SEO do predicts.info.
Não usar para mudar lógica de produto/pontuação/apostas, schema de API, ou
qualquer coisa em `backend/` — este loop só mexe em SEO/performance
(frontend estático + nginx).

## Entradas
1. URL viva: `https://predicts.info/`.
2. Escopo liberado: `frontend/public/` (landing, `llms.txt`, `404.html`,
   `vendor/`), `frontend/src/` só se a mudança for puramente de performance
   de carregamento (ex: lazy-load, defer, split), e
   `/etc/nginx/sites-available/predicts.info`.
3. Fora de escopo: `backend/`, banco, regras de pontuação/apostas, qualquer
   rota de API. Mudança de arquitetura de i18n (separar `/en/` como URL
   própria) fica FORA de escopo automático — exige aprovação explícita do
   Abel antes (é decisão de produto, não fix técnico), tratar como
   `bloqueado` se for a única alavanca restante.
4. Teto: 5 voltas.

## Meta
Nota geral da auditoria seo-mestre em `https://predicts.info/` ≥ 95/100,
usando os pesos de `references/config/scoring-rubric.md` da skill.
Verificável? Sim (número, avaliador independente).

## Verificação (o check que manda)

- **Check primário:** agente `gestor` fresco (só recebe URL + lista do que
  mudou nesta volta — nunca vê o raciocínio de quem implementou) roda,
  do zero, a cada volta:
  1. `curl` real contra `https://predicts.info/`: headers, `<head>` (title/
     description/canonical/robots/hreflang), `robots.txt`, sitemaps,
     `/llms.txt` (status+content-type+corpo), 404 real numa URL inventada.
  2. `lighthouse` real (`npm install -g lighthouse` já instalado; Chrome em
     `/usr/bin/chromium-browser`) contra a URL viva —
     `--chrome-flags="--headless=new --no-sandbox --disable-gpu"` —
     categorias performance/seo/accessibility/best-practices.
  3. Recalcula a nota dos agentes tocados por este loop (01 técnico, 02
     pagespeed — agora com Lighthouse REAL, não estimado —, 03 semântica,
     06 GEO/AIO, 07 LLM/robots/llms.txt, 08 schema/trust) contra a rubrica
     congelada de `references/agents/NN-*.md` + `scoring-rubric.md`; os
     agentes não tocados por este loop (04, 05, 09, 10, 11, 12) mantêm a
     nota da última auditoria completa registrada em `state.json.baseline`.
  4. Smoke-test: `/dashboard /brasileirao /admin /partida/880
     /meus-grupos/5 /usuarios/1/historico` continuam `200`. Qualquer uma
     quebrando = reprovação automática da volta, independe da nota SEO.
  5. Devolve: nota geral consolidada, nota por agente, achados novos,
     resultado do smoke-test.
- Evidência registrada: saída bruta do curl e do Lighthouse (métricas
  numéricas: LCP/CLS/TBT/performance/seo/a11y/best-practices), nota por
  agente, resultado smoke-test — tudo em `state.json.attempts`.
- **Pronto = nota geral do gestor ≥ 95 E smoke-test 100% ok na mesma volta.**
- Regressão: `nginx -t` (config) antes de qualquer `reload`; smoke-test das
  6 rotas acima depois. Falha em qualquer um = reverter a volta inteira.
- Timeout/erro: registrar falha em `state.json`. Nunca tratar como sucesso.

## Passos da volta
1. Reconciliar `state.json` com `git -C /opt/predicts log --oneline -10` e
   `git -C /opt/predicts status` (deve estar limpo ao iniciar) + conferir
   se o nginx atual bate com o último backup registrado.
2. Fotografar baseline: rodar o check primário completo (curl + Lighthouse
   real) ANTES de mexer em nada, se ainda não tiver baseline desta volta.
3. Escolher, entre os achados abertos (ver `state.json.attempts` — não
   repetir abordagem já tentada e reprovada do mesmo jeito), o de maior
   impacto esperado na nota. Prioridade sugerida por peso da rubrica:
   PageSpeed (12) e GEO/AIO (12) > Técnico (12) > Conteúdo (14, mas já alto)
   > Schema (10) > IA (10) > LLM/robots (8) > Semântica (8) > Conversão (4).
4. Se a mudança tocar `/etc/nginx/`: copiar backup pra
   `/root/predicts.info.nginx.bak-$(date +%Y%m%d%H%M%S)` ANTES de editar.
5. Implementar UMA mudança coesa e reversível.
6. Se tocou nginx: `nginx -t`. Falhou → reverter do backup, ir pro passo 9.
   Se ok: `systemctl reload nginx` (nunca `restart`).
   Se tocou `frontend/public/` ou `frontend/src/`: `cd frontend && npm run
   build` (build COMPLETO — vite + SEO shells + páginas geradas; nunca
   `vite build` isolado, que apaga `dist/copa`, `dist/jogos`, `dist/noticias`
   e derruba produção).
7. Rodar smoke-test (6 rotas). Alguma não-200 → reverter (nginx: restaurar
   backup + reload; frontend: `git checkout -- <arquivos>` + rebuild) e ir
   pro passo 9.
8. Smoke-test ok → rodar check primário completo (gestor). Nota subiu (ou
   achado crítico resolvido) sem regressão → aceitar: `git -C /opt/predicts
   add <arquivos>` + commit (1 por volta aceita, describe o achado
   corrigido). Nota não subiu / gestor reprova → reverter tudo da volta.
9. Persistir `state.json` (volta N, achado tentado, resultado, evidência,
   nota antes/depois).
10. Avaliar parada.

## Estados de parada
- **sucesso:** nota geral do gestor ≥ 95 E smoke-test ok, mesma volta.
- **sem-progresso:** 2 voltas seguidas sem aumento de nota geral.
- **bloqueado:** (a) próxima alavanca de maior impacto exige decisão fora
  de escopo (ex: separar `/en/` como URL própria pro conteúdo bilíngue —
  pedir aprovação explícita do Abel, não decidir sozinho); (b) smoke-test
  falha E o revert também falha — parar, não tentar mais mudanças, alertar;
  (c) teto matemático: se PageSpeed real + GEO real não derem pra fechar 95
  mesmo corrigindo tudo que está em escopo, declarar o teto alcançável e
  por quê (não fingir que chegou).
- **esgotado:** 5 voltas rodadas sem sucesso.

## Guardrails
- Teto: 5 voltas. Parar e reportar ao chegar em 5 sem sucesso.
- Escopo travado: ver "Entradas" acima. Tocar `backend/` ou mudar URL/
  arquitetura de i18n sem pedir antes = abortar a volta, marcar `bloqueado`.
- Backup do nginx ANTES de editar, sempre. `nginx -t` antes de todo reload.
- Nunca `restart` do nginx (zero-downtime só com `reload`).
- Build do frontend sempre completo (`npm run build`, nunca `vite build`
  isolado) — produção é servida direto de `dist/`.
- Smoke-test das 6 rotas depois de QUALQUER mudança, antes de aceitar.
- Nunca `git push` sozinho. Commits ficam locais até Abel revisar e mandar
  subir.
- Uma mudança reversível por volta; commit por volta aceita; revert
  completo e imediato se reprovada ou se regredir qualquer coisa.
- Nunca inventar métrica (PageSpeed, dado de terceiro) — só usar o que o
  Lighthouse/curl real devolveu nesta volta.

## Memória / estado
`state.json` ao lado desta especificação, em
`/opt/predicts/loops/predicts-seo/state.json`. Campos: `iteration`,
`max_iterations`, `baseline` (nota por agente da última auditoria
completa, agentes 04/05/09/10/11/12 congelados dali), `last_check`
(evidência bruta da última volta: curl+Lighthouse+notas por agente),
`accepted_changes`, `attempts` (lista de {iteration, achado, resultado,
nota_antes, nota_depois}), `status`, `terminal_reason`.

## Sub-loops (opcional)
Não se aplica.

## Como acionar
- `/goal Use o loop predicts-seo em
  /opt/predicts/loops/predicts-seo/predicts-seo-loop.md. Continue até
  sucesso (nota ≥95), sem-progresso 2x seguidas, bloqueado, ou 5 voltas
  (esgotado). Sempre reconciliar state.json antes da volta.`

## Métrica de saúde
custo/mudança aceita = tokens gastos na volta / 1 (se aceita) ou tokens
gastos / 0 (se revertida, registrar como custo perdido).
