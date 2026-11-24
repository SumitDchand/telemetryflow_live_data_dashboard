# Technologies and concepts

The stack has one job: turn sensor observations into durable, inspectable, live information. Each tool has a concrete boundary in the codebase.

## Major technologies

| Technology | What it is / use here | Why selected | Alternatives and limits |
|---|---|---|---|
| Python 3.11 | General-purpose language; `ingestion/` collector | Clear validation, simulation and retry logic; mature hardware/API ecosystem | Node, Go; a single synchronous loop is not ideal for thousands of blocking sensors |
| JavaScript | Browser/server language; React and `backend/src/` | Native web platform and asynchronous I/O | TypeScript adds static contracts; Go/Rust backends have different throughput/complexity trade-offs |
| React 19 | Component/state UI library; `frontend/src/App.jsx`, hooks, pages | Incremental visual updates, reusable components | Vue/Svelte; careless state updates can increase rendering work |
| Vite 7 | Local server and production bundler; `vite.config.js` | Fast development and proxy support | Webpack, framework bundlers; it is not the production backend |
| Tailwind CSS 4 | Utility compiler and theme base, imported by `styles.css` via `@tailwindcss/vite` | Shared reset/utilities with explicit CSS tokens for a consistent dark/light theme | CSS modules, vanilla CSS, component systems; design still requires authored CSS |
| Recharts 3 | React charts; `TelemetryChart.jsx` | Tooltips, axes, multi-machine lines and threshold references | ECharts, uPlot, custom canvas; SVG cost grows with points, so this app samples |
| Lucide React | SVG icon components | Consistent, restrained navigation/metric icons | Inline SVG or another icon set; icons need accessible text/labels |
| Express 5 | HTTP router/middleware framework; `app.js`, `routes/`, `controllers/` | Small, understandable REST surface | Fastify, Nest; validation/security are explicit application responsibilities |
| PostgreSQL 17 | Relational database; schema, SQL trigger, LISTEN/NOTIFY | ACID transactions, indexing, analytics, persistent event recovery in one system | SQLite for single-process apps, TimescaleDB for larger time series; NOTIFY is not a queue |
| psycopg 3 | Python PostgreSQL driver; `database.py` | Parameter binding, transactions, pipeline-enabled executemany | SQLAlchemy, asyncpg; synchronous calls can block the collection loop during failure |
| node-postgres (`pg`) | Node database driver; pool and listener | Async pooled queries plus dedicated LISTEN connection | ORM libraries; SQL stays explicit and must be reviewed |
| REST APIs | Resource-oriented HTTP requests | Snapshot, filters, pagination, acknowledgement, controls | GraphQL, RPC; REST alone does not push updates |
| WebSocket / `ws` | Persistent bidirectional connection | Low-overhead pushes, subscriptions and ping/pong | SSE/polling; reconnect/backpressure/replay need application code |
| Docker / Compose | Runtime packaging and local orchestration | Repeatable four-service setup, network DNS, volumes and health dependencies | Manual runtimes; not a replacement for backups or production orchestration |
| Pytest / Vitest / Supertest / Playwright | Unit, integration and browser tests | Exercise real DB transactions, HTTP, streams and UI behavior | Other runners; short tests cannot prove long-term availability |
| Git | Versioned source history | Reviewable changes and reproducible source checkpoints | Other VCS; ignored credentials are not a secret-management system |

## Concepts in the actual implementation

| Concept, intuitively | Concrete location and behavior |
|---|---|
| Polyglot architecture: different languages cooperate through a contract | Python writes SQL rows; JavaScript reads them; [ARCHITECTURE](ARCHITECTURE.md) |
| Separation of concerns: each layer has one primary job | Collector, database, REST/hub, React pages are separate directories/processes |
| Loose coupling: replace a producer without rewriting consumers | A real sensor adapter can replace `Simulator.collect()` while preserving row fields |
| Telemetry: timestamped measurements of a system | `telemetry` retains source/sensor IDs, four values, operating state and times |
| Data pipeline: observations move through stages | Generate → validate → transaction → notify → query → socket → chart |
| ETL versus ELT: transform before or after loading | Python validates before insertion; SQL performs historical aggregation afterwards |
| Client-server: a browser asks a service for information | `services/api.js` calls Express; Python is not a browser server |
| HTTP versus WebSocket | Bootstrap/history use request-response; `/ws` uses an ongoing stream |
| TCP and upgrade handshake | `Hub` accepts an HTTP Upgrade; `ws` manages framing over TCP; nginx forwards upgrade headers |
| Stateless versus stateful | REST page cursor is supplied per request; each socket holds `cursor`, `machine`, `alive` |
| Synchronous versus asynchronous | Python's collection loop waits for DB completion; Node awaits I/O while other callbacks can run |
| Node event loop | `listener.js` and `hub.js` schedule callbacks; a `busy` flag prevents overlapping replay per client |
| ACID and transactions | `Database.write_batch()` commits rows, alert trigger effects and counters atomically |
| Connection pooling | `pool.js` reuses up to 12 SQL connections; LISTEN is separate |
| B-tree and composite indexes | Machine/time index narrows a sorted history range; ID index supports replay |
| SQL execution plans | Benchmark uses EXPLAIN ANALYZE/BUFFERS before and after a real index creation |
| LISTEN/NOTIFY | Commit wakes the hub; timer/cursor queries supply durability |
| Batch processing | Psycopg pipelines up to 500 statements under one transaction/lock |
| Idempotency | Stable UUID plus unique constraint makes retried inserts harmless |
| Race conditions | Snapshot watermark and serialized writer commit order prevent missed history/live transitions |
| Event-driven architecture | SQL notifications schedule reads and socket messages; timer is the recovery path |
| Exponential backoff | Collector retries 1,2,4,8,16,30 seconds; browser adds jitter |
| Fault tolerance | Python holds a bounded queue; Node reconnects LISTEN; browsers replay persisted rows |
| Throughput versus latency | Longer intervals/bigger batches reduce commit overhead but delay visualization |
| Backpressure | Hub closes clients with >1 MiB queued; buffers/pages/clients are bounded |
| React state management | `App` owns view/filter/theme/token; `useTelemetry` owns data and connection lifecycle |
| Component lifecycle / useEffect | Open subscriptions on mount/filter change and cancel timers/socket on cleanup |
| useState | UI-visible data, loading, connection, pause and alerts |
| useRef | Bounded live buffer and latest readings can change without immediate rendering |
| useMemo and memo | Reuse chart transformation/props between unrelated rerenders; bounded work remains necessary |
| Docker image versus container | Dockerfiles describe a built filesystem; Compose runs containers from it |
| Compose | Startup health dependencies, loopback ports, service DNS and a persistent named volume |
| Horizontal versus vertical scale | This release scales resources within one stack; replicas require coordination not implemented here |

No Kafka, Kubernetes, Redis, authentication service, or cloud provider is installed. Those belong to specific future requirements, not this local system.
