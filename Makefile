.PHONY: setup up down test build logs
setup:
	./scripts/setup.sh
up: setup
	docker compose up --build -d
down:
	docker compose down
test:
	python3 scripts/with-env.py npm test
	python3 scripts/with-env.py .venv/bin/pytest ingestion/tests -q
build:
	npm run build
logs:
	docker compose logs -f
