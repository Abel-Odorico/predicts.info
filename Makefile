up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --no-cache

logs:
	docker compose logs -f api

seed:
	docker compose exec api python seed_data.py

shell:
	docker compose exec api bash

psql:
	docker compose exec db psql -U copa -d copa2026

reset:
	docker compose down -v && docker compose up -d && sleep 5 && docker compose exec api python seed_data.py

test:
	curl -s http://localhost:8110/api/health | python3 -m json.tool
	curl -s "http://localhost:8110/api/teams?limit=5" | python3 -m json.tool
