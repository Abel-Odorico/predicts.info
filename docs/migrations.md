# Migrations (Alembic)

Schema do banco é versionado com **Alembic**. A baseline (`a48a2805d933`) captura
o schema completo na adoção do Alembic. O banco de produção foi marcado com
`alembic stamp head`, então a migration baseline **não** roda nele (apenas em bancos novos).

No startup (`backend/main.py` → `lifespan`):
1. `_alembic_upgrade()` → `alembic upgrade head` (fonte de verdade do schema)
2. `_run_migrations()` → DDL legado idempotente (compat; remover quando tudo migrar)

`Base.metadata.create_all` foi **removido** — não criar tabelas fora do Alembic.

## Criar nova migration (mudou um model)

```bash
# 1. edite os models em backend/models.py
# 2. gere a migration (autogenerate compara models vs banco)
docker compose exec -w /app api alembic revision --autogenerate -m "descricao curta"

# 3. REVISE o arquivo gerado em backend/alembic/versions/ antes de aplicar
# 4. aplique (ou só reinicie a API — sobe no startup)
docker compose exec -w /app api alembic upgrade head
```

## Comandos úteis

```bash
docker compose exec -w /app api alembic current      # revisão atual do banco
docker compose exec -w /app api alembic history       # histórico
docker compose exec -w /app api alembic downgrade -1  # reverte 1 migration
```

## Como a baseline foi gerada

Autogenerate contra um banco temporário vazio (`predicts_baseline`), depois
`alembic stamp head` no banco real para não recriar tabelas existentes.
