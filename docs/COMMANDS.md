# Commands and execution order

Run commands from the repository root unless a different directory is stated. Shell examples use Bash/Zsh, or Ubuntu/WSL on Windows. No published Git remote exists yet; use your real remote URL when cloning a published copy, rather than a fabricated repository link.

## Docker workflow

```bash
./scripts/setup.sh
docker compose up --build -d
docker compose ps
docker compose logs -f ingestion backend
```

Open `http://localhost:8080`. The setup script generates random credentials into `.env` only if it does not exist. Docker's initial build downloads runtimes and dependencies. `-d` starts services in the background. The database becomes healthy before collection/API start; nginx starts after backend readiness.

```bash
docker compose down
```

Stops/removes service containers and network while retaining the PostgreSQL named volume. Do not add `-v` unless you explicitly intend to erase the project's database.

## Local development

Prerequisites: Node 22.12+ (Node 22 is used in containers), Python 3.11, PostgreSQL 17, and npm. Docker Compose can supply just PostgreSQL:

```bash
./scripts/setup.sh
docker compose up --build -d db
npm ci
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r ingestion/requirements.lock.txt
python scripts/with-env.py python scripts/init-db.py
```

When using an independently installed PostgreSQL server, create a database/user and edit private `.env` with its actual connection URL before running `init-db.py`.

Use three terminals:

```bash
# Terminal 1, repository root
python3 scripts/run-local.py backend
# Terminal 2, repository root
python3 scripts/run-local.py ingestion
# Terminal 3, repository root
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/ws` to the backend on port 3001. The environment launcher reads `.env` without echoing secrets. Stop each process with Ctrl-C. For backend file watching, use `npm run dev -w backend`, which reads `.env` using Node's environment-file flag.

## Command reference

| Command | Directory | Purpose / expected result |
|---|---|---|
| `./scripts/setup.sh` | root | Creates private random local credentials if missing |
| `docker compose up --build -d` | root | Builds and starts all four services; frontend port 8080 |
| `docker compose up --build -d db` | root | Database only on loopback 5433 |
| `docker compose ps` | root | Container state and health |
| `docker compose logs -f` | root | Live structured application and database logs |
| `docker compose down` | root | Stop containers; preserve data volume |
| `npm install` | root | Resolve dependency changes and update lockfile |
| `npm ci` | root | Reproduce the committed JS dependency lockfile |
| `npm run dev` | root | Start React/Vite at port 5173 |
| `npm run dev -w backend` | root | Watch-mode Express server, loading root `.env` |
| `npm start -w backend` | root | Run Express without watch mode |
| `npm run build` | root | Emit production static assets to `frontend/dist` |
| `npm test` | root | Backend + frontend tests; DB cases skip if DATABASE_URL absent |
| `python3 scripts/with-env.py npm test` | root | All JS tests, including isolated PostgreSQL integration |
| `python3.11 -m venv .venv` | root | Create a Python 3.11 virtual environment |
| `source .venv/bin/activate` | root, Bash/Zsh | Use the virtual environment for this terminal |
| `pip install -r requirements.lock.txt` | ingestion, activated venv | Install exact Python dependencies |
| `python main.py` | ingestion, env set | Start continuous collection; DATABASE_URL must already be exported |
| `python3 scripts/run-local.py ingestion` | root | Equivalent collector launcher with private `.env` loaded |
| `python3 scripts/with-env.py .venv/bin/pytest ingestion/tests -q` | root | Python unit and actual database integration tests |
| `python3 scripts/with-env.py node scripts/e2e.mjs` | root, running stack | Browser pipeline test; requires installed Chrome |
| `python3 scripts/with-env.py .venv/bin/python scripts/benchmark.py` | root, running API/DB | Isolated DB/API benchmark, overwrites measured JSON report |
| `node scripts/stream-benchmark.mjs` | root, running API/collector | 30-second real WebSocket latency measurement |
| `bash scripts/demo.sh` | root, running API | Read-only cURL health/latest/history/stats requests |
| `make test` | root | JS + Python tests with .env loaded |
| `npm audit` | root, network access | Check currently known dependency advisories |
| `docker compose exec db psql -U telemetryflow -d telemetryflow` | root | Interactive SQL shell with default generated configuration |

If POSTGRES_USER or POSTGRES_DB were changed, use those names in psql. Useful SQL commands: `\dt` lists tables, `\d telemetry` describes constraints/indexes, `SELECT count(*) FROM telemetry;` counts retained rows. SQL examples are in [queries.sql](queries.sql). Never print a database URL containing credentials in a shared log.

## Dedicated outage QA

`scripts/outage-check.mjs` only accepts a project named `telemetryflow-qa` (or a suffix under that prefix). It stops/restarts QA services, so do not run it against a valuable deployment. Supply QA port overrides for DB 15433, API 13001, frontend 18080. Its checked-in override is [`docker-compose.qa.yml`](../docker-compose.qa.yml):

```bash
docker compose -p telemetryflow-qa -f docker-compose.yml -f docker-compose.qa.yml up --build -d
python3 scripts/with-env.py node scripts/outage-check.mjs
BASE_URL=http://127.0.0.1:18080 python3 scripts/with-env.py node scripts/e2e.mjs
docker compose -p telemetryflow-qa -f docker-compose.yml -f docker-compose.qa.yml down
```

The QA named volume is independent of the default stack. `down` retains it. Alternative API/DB ports can be passed as `QA_API` and `QA_DB_PORT`; the browser uses `BASE_URL`. Browser checks accept `BROWSER_CHANNEL`, default `chrome`.
