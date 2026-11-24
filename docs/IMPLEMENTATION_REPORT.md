# Final implementation report

## Delivered system

TelemetryFlow is a complete, local industrial telemetry demonstration: Python generates simulated machine observations, validates and batches them into PostgreSQL, and an Express/WebSocket service streams committed readings to a responsive React dashboard. It has actual database persistence and native WebSocket communication throughout; no frontend-only data pipeline or invented health metrics are used.

The source is in this repository. Git metadata is initialized; no remote or commit was created. `.env` contains generated local secrets and is ignored. The default Docker deployment is started with:

```bash
./scripts/setup.sh
docker compose up --build -d
```

Open `http://localhost:8080`. For this development session, an isolated QA deployment uses `http://127.0.0.1:18080`; its database and API are on loopback 15433 and 13001, and its Compose project is `telemetryflow-qa`. The [commands guide](COMMANDS.md) provides startup/shutdown commands for both configurations.

## Features and architecture

Delivered features include multi-machine simulation; UTC events; finite/range/type validation; transactional pipelined insertion; UUID idempotency; bounded buffering; retries/reconnection; PostgreSQL constraints/indexes; SQL alert detection/cooldowns; seven functional dashboard views; four live charts; machine filtering/details; historical dates/metrics/aggregation/pagination/CSV; alert acknowledgement; threshold/scenario controls; real pipeline diagnostics; dark/light mode; responsive mobile navigation; and Docker containerization.

Python owns collection. PostgreSQL owns persistent readings, derived alerts, controls and counters. Express owns REST/security/business operations; its dedicated listener and WebSocket hub query committed rows after cursors. React loads a consistent REST snapshot, merges replay/live data by UUID and renders bounded charts twice per second. This is polyglot architecture because independent Python and JavaScript services cooperate through the database contract.

Technologies: Python 3.11/psycopg, PostgreSQL 17, Node/Express/node-postgres/ws, React 19/Vite 7/Tailwind 4/Recharts/Lucide, nginx and Docker Compose. No additional broker, cache or orchestration platform was introduced. The [technology guide](TECHNOLOGIES.md) explains purpose, alternatives and limitations.

## Important files

| File/directory | Responsibility |
|---|---|
| `ingestion/simulator.py` | Mean-reverting multi-machine source and anomaly scenarios |
| `ingestion/validator.py` | Reject invalid numeric/status/UUID/UTC readings |
| `ingestion/collector.py` | Bounded queue, retry/backoff and shutdown policy |
| `ingestion/database.py` | Connection reuse, transaction lock, pipelined batches, metrics and retention |
| `database/01-schema.sql` | Relational constraints and transactional alert trigger |
| `database/02-indexes.sql`, `03-seed.sql` | Query indexes and five initial assets/configuration |
| `backend/src/controllers/api.js` | REST operations and constant-time control-token validation |
| `backend/src/services/telemetry.js` | Bounded parameterized SQL and measured statistics |
| `backend/src/websocket/hub.js` | Multi-client streaming, recovery, filtering and heartbeat |
| `backend/src/services/listener.js` | Dedicated reconnecting PostgreSQL LISTEN connection |
| `frontend/src/hooks/useTelemetry.js` | Snapshot/live transition, bounded merge, reconnect and pause |
| `frontend/src/components/TelemetryChart.jsx` | Memoized charts, machine comparison, threshold lines and sampling |
| `frontend/src/pages/` | History/export, alerts, simulation/threshold settings and diagnostics |
| `scripts/benchmark.py`, `stream-benchmark.mjs` | Reproducible actual measurements |
| `scripts/e2e.mjs`, `outage-check.mjs` | Browser and controlled service-failure validation |
| `docker-compose.yml`, `docker-compose.qa.yml` | Standard and isolated QA deployments |

## Engineering decisions

The main synchronization risks are solved with a repeatable-read bootstrap watermark, per-client database replay, UUID merging, and a transaction advisory lock before telemetry sequence allocation. This closes the history/live race and avoids the common mistake of assuming sequence numbers inherently follow commit order. NOTIFY is only a low-latency hint; the two-second scan is the recovery mechanism.

Writes are idempotent and atomic; memory buffering is explicitly finite. Alert creation occurs in the insertion transaction and cooldown checks include acknowledged alerts. UI data storage, rendering frequency, API pages, export size, messages, connections and socket backlog are bounded. Detailed alternatives, source snippets, trade-offs and tests are in [CHALLENGES.md](CHALLENGES.md).

## Executed validation

| Check | Observed result |
|---|---|
| Python Pytest, including actual PostgreSQL isolated schemas | 21 passed |
| Backend Vitest/Supertest, actual SQL and WebSockets | 12 passed |
| Frontend Vitest/Testing Library | 10 passed |
| Browser end-to-end | 12 checks passed; no page errors |
| Production Vite build | Passed; chart code split into a separate bundle |
| Full Docker Compose build/start | All four services built and started; DB/backend healthy |
| Collector outage | Heartbeat became stale; restart resumed ingestion |
| Backend outage | Collection persisted readings while API was down; restart recovered |
| Database outage | Readiness returned 503; retry buffer drained after recovery |
| Duplicate check after outage recovery | Zero duplicate event IDs |
| Dependency audit | Zero reported npm vulnerabilities at verification |
| Desktop/mobile inspection | Real screenshots captured at 1440 px and 390 px; mobile page has no horizontal overflow |

The browser suite checks real bootstrap and live updates, all four charts, pause/resume, machine details, historical CSV, token-protected controls/threshold save, anomaly-induced alerts, acknowledgement, pressure/vibration/failure scenarios, pipeline health, offline/online recovery, theme switching and mobile navigation. Raw browser and outage evidence is saved in [e2e-results.json](e2e-results.json) and [outage-results.json](outage-results.json). Test schemas are unique and dropped after use.

The host's Docker credential helper and Compose plugin were broken. Validation used a temporary isolated Docker configuration and a temporary Compose binary; user Docker settings were not changed. SQL is packaged in the DB image to avoid the observed Colima host-mount issue. Browser tests exposed and helped fix mobile overflow. Cross-host clock skew is displayed explicitly instead of being hidden by clamping measurements.

## Measured performance

The final local benchmark measured about **953.12 records/s** for 100 machines at a 0.1-second interval, with **21.867 ms median / 24.551 ms p95** batch transaction latency and zero failures. A separate 1,000-row comparison measured **818.26 records/s** for individual transactions and **12,024.17 records/s** in 100-reading transactions. This latter burst is not a sustained whole-pipeline capacity claim.

On a separate 100,000-row table, the selected machine-history query measured **3.254 ms median** without its composite index and **0.305 ms median** with it. A 30-second real stream run received 75 new readings with **14 ms median / 18 ms p95** generation-to-local-WebSocket-client latency. That excludes React's rendering delay.

Hardware, software versions, intervals, sample counts, percentile definition, API results, resource measurements and full EXPLAIN plans are in [PERFORMANCE.md](PERFORMANCE.md) and raw JSON. No long-duration soak or render-frequency comparison was executed. Resource snapshots do not establish long-term memory stability.

## Known limitations

- All sensor readings are simulated; the source interface is ready to be replaced, but physical IoT integration is not implemented.
- One collector/backend instance is the supported topology. Every writer must honor the same ordering lock; arbitrary concurrent SQL inserts can break replay assumptions.
- Buffering is in memory. Overflow drops oldest rows, process loss drops pending memory, and initial database unavailability delays collection startup. There is no durable message broker or disk spool.
- Recovery is limited to retained rows. Default retention is seven days with incremental deletion; this is not a strict storage quota.
- Queries, chart memory, CSV exports and WebSocket clients are capped. Historical chart aggregation can be truncated with an explicit flag; live plots sample intermediate readings.
- Read APIs/streams are unauthenticated for a trusted local demonstration. Mutation tokens do not replace production identity, authorization, TLS, audit records, backups or least-privilege DB roles.
- Alerts require explicit acknowledgement and do not auto-resolve; threshold rules are high-side only.
- Timestamp-derived latency needs clock synchronization. Backend/collector interval configuration must agree for correct stale-state detection.
- Windows/WSL and Linux setup instructions follow the containerized design, but those host platforms were not independently tested in this session.

## Potential improvements

Add physical sensor/MQTT adapters, disk spooling, user identity and per-machine permissions, incident lifecycle/hysteresis, automated backups, partitioned retention/TimescaleDB, materialized latest readings, shared socket replay batches, browser performance profiling, and sustained/load/failure testing. Introduce Kafka/Redis/cloud services only where measured scaling or delivery requirements justify them.
