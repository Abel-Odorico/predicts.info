---
name: loop-predicts-seo
description: Executa, só sob pedido explícito, o loop predicts-seo em loops/predicts-seo/predicts-seo-loop.md; valida, retoma state.json, para por sucesso (nota seo-mestre >=95)/sem-progresso/bloqueio/esgotamento.
---

# Loop predicts-seo

NÃO executar automaticamente. Só rodar os passos abaixo quando o usuário pedir explicitamente
(ex: "roda o loop predicts-seo", "/loop-predicts-seo", "continua o loop de SEO do predicts"). Descrever a existência do loop não é pedido de execução.

1. Localizar e ler `loops/predicts-seo/predicts-seo-loop.md` (relativo à raiz do Git em escopo project).
2. Validar a especificação.
3. Carregar `state.json` ao lado, reconciliar com repositório (`git log`, `git status`, backup do nginx mais recente).
4. Executar uma volta por vez, persistindo evidência (curl + Lighthouse real + smoke-test) após cada check.
5. Parar apenas em estado terminal (sucesso/sem-progresso/bloqueado/esgotado) ou quando aprovação humana for necessária (nginx que não passa `nginx -t`, mudança de arquitetura de i18n, `git push`).
6. Nunca ampliar permissões, tratar erro como sucesso, ou alterar código fora do escopo (`backend/`, rotas de API).
7. Relatar: estado terminal, evidência final (nota geral + por agente + Lighthouse), voltas consumidas, mudanças aceitas, mudanças revertidas.
