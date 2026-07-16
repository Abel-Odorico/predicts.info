---
name: loop-melhorar-paginas-grupos
description: Executa, só sob pedido explícito, o loop melhorar-paginas-grupos em loops/melhorar-paginas-grupos/melhorar-paginas-grupos-loop.md; valida, retoma state.json, para por sucesso/sem-progresso/bloqueio/esgotamento.
---

# Loop melhorar-paginas-grupos

NÃO executar automaticamente. Só rodar os passos abaixo quando o usuário pedir explicitamente
(ex: "roda o loop melhorar-paginas-grupos", "/loop-melhorar-paginas-grupos"). Descrever a existência do loop não é pedido de execução.

1. Localizar e ler `loops/melhorar-paginas-grupos/melhorar-paginas-grupos-loop.md` (relativo à raiz do Git em escopo project; caminho absoluto em escopo global).
2. Validar a especificação.
3. Carregar `state.json` ao lado, reconciliar com repositório.
4. Executar uma volta por vez, persistindo evidência após cada check.
5. Parar apenas em estado terminal ou quando aprovação humana for necessária.
6. Nunca ampliar permissões, tratar erro como sucesso, ou alterar código fora do escopo.
7. Relatar: estado terminal, evidência final, voltas consumidas, mudanças aceitas.
