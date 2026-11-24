# Engineering challenges and solutions

The ten design risks below were **anticipated**, then addressed and tested. They are not claims that ten production incidents occurred. Observed development issues are listed separately at the end. Each snippet names the actual source file.

## 1. Decoupling collection from visualization

**Problem and effect:** direct Python-to-browser coupling would make a frontend change affect collection and lose data when no dashboard is open. The system needs a stable interface between independently restartable services.

**Alternatives:** a Python HTTP server, direct socket pushes, MQTT, or a message broker. **Selection:** persisted PostgreSQL rows plus lightweight notifications. Existing storage doubles as a recovery log, avoiding another service.

```python
# ingestion/database.py:Database.write_batch
conn.execute("SELECT pg_notify('telemetry_committed', %s)", (str(count),))
```

**Trade-off:** schemas must stay compatible and PostgreSQL becomes the common dependency. **Validation:** real QA backend-stop test verified telemetry count still increased while Express was stopped; restarting restored readiness (`scripts/outage-check.mjs`).

## 2. Reliable database writes

**Problem and effect:** interrupted commits have ambiguous outcomes; blindly generating replacement UUIDs can duplicate a reading, while dropping a failed batch loses data.

**Alternatives:** discard failures, use disk spooling, or use a durable queue. **Selection:** stable event UUIDs, SQL uniqueness, atomic transactions, a bounded memory queue, reconnection and exponential retry.

```python
# ingestion/database.py:INSERT
INSERT = f"INSERT INTO telemetry ({','.join(FIELDS)}) VALUES ({','.join(['%s']*len(FIELDS))}) ON CONFLICT(event_id) DO NOTHING RETURNING id"
```

Parameters prevent value interpolation into SQL. `Collector.flush()` removes buffered readings only after success. **Trade-off:** oldest readings are dropped and logged at 5,000 queued events; process loss also loses memory. The process does not collect before initial registration can connect. **Validation:** Pytest verifies duplicates, rollback, invalid values, retained retry buffers, and graceful shutdown. A real DB outage recovered with no duplicate UUIDs.

## 3. Real-time synchronization

**Problem and effect:** emitting data before commit could show rows that later roll back. Notifications can disappear when the listener disconnects.

**Alternatives:** HTTP polling, CDC, transactional outbox and broker. **Selection:** PostgreSQL delivers NOTIFY after commit; Node reads actual rows and falls back to a two-second cursor scan.

```js
// backend/src/websocket/hub.js:Hub.pump
const {rows}=await this.db.query('SELECT * FROM telemetry WHERE id>$1 ORDER BY id LIMIT 500',[ws.cursor]);
```

**Trade-off:** missed notifications increase latency to the next poll; each client creates replay queries. **Validation:** a test inserts without NOTIFY and observes timer recovery; Python integration confirms notification after committed ingestion. The stream benchmark measures actual client receipt.

## 4. WebSocket connection failure

**Problem and effect:** TCP connections silently break through network failures; browser state can fall behind persisted history.

**Alternatives:** manual refresh or polling-only UI. **Selection:** ping/pong, automatic backoff with jitter, and resubscribe from the last merged cursor.

```js
// frontend/src/hooks/useTelemetry.js
export function reconnectDelay(attempt){return Math.min(30000,1000*2**Math.min(attempt,5));}
```

**Trade-off:** data older than database retention cannot be recovered, and no durable per-browser acknowledgement ledger exists. **Validation:** backend reconnect test verifies only later IDs are replayed; browser test toggles offline/online and observes a live connection returning; hook tests verify scheduling.

## 5. High-frequency ingestion

**Problem and effect:** one transaction per sensor incurs repeated network/commit overhead; unchecked producer speed can exhaust memory.

**Alternatives:** row inserts, COPY bulk loads, async workers, Kafka. **Selection:** one reused connection, pipelined parameterized `executemany`, bounded batches and queue.

```python
# ingestion/database.py:Database.write_batch
cursor.executemany(INSERT, [tuple(reading[k] for k in FIELDS) for reading in readings], returning=True)
```

**Trade-off:** a synchronous connection can delay collection during a timeout; bigger batches reduce overhead but increase commit latency and lock occupancy. Defaults are five machines every two seconds, up to 500 rows per flush. **Validation:** the benchmark runs 5/25/100 machines at 0.1/0.5-second intervals and separately compares individual versus batched writes with identical transaction logic.

## 6. Query optimization

**Problem and effect:** scanning all historical rows for one machine becomes more expensive as retention grows.

**Alternatives:** sequential scans, a latest-state cache, partitions, TimescaleDB. **Selection:** B-tree composite and timestamp indexes plus bounded REST queries.

```sql
-- database/02-indexes.sql
CREATE INDEX telemetry_machine_time_idx ON telemetry(machine_id, recorded_at DESC, id DESC);
```

**Trade-off:** indexes increase insert/disk cost; a full fleet latest query can still scan substantial history. **Validation:** a separate 100,000-row benchmark table is queried before/after index creation with actual EXPLAIN ANALYZE/BUFFERS plans, preserving production indexes. Results are in [PERFORMANCE.md](PERFORMANCE.md).

## 7. Frontend rendering cost

**Problem and effect:** pushing every reading directly into React state can produce frequent renders and ever-growing chart arrays.

**Alternatives:** render every event, canvas charts, web workers. **Selection:** ref-backed bounded merge, 500-ms state cadence, memoized chart transformation, approximately 180 sampled time points and no per-tick animation.

```js
// frontend/src/hooks/useTelemetry.js:mergeReadings
return [...map.values()].sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at)||Number(BigInt(a.id)-BigInt(b.id))).slice(-limit);
```

**Trade-off:** intermediate points are omitted from charts and UI latency includes up to 500 ms scheduling; full rows remain in database history. **Validation:** unit tests check bounded deduplication and pause/resume; real browser tests confirm updates without reload. Comparative render-frequency profiling has not been executed.

## 8. Consistency, ordering and duplicates

**Problem and effect:** reading history then opening a live stream can miss commits in between. A sequence ID can also be allocated by an uncommitted writer before another writer commits a larger ID.

**Alternatives:** overlap time windows with deduplication, commit LSNs, durable outbox. **Selection:** bootstrap repeatable-read snapshot and its cursor, plus serialized writer allocation/commit order.

```python
# ingestion/database.py:Database.write_batch, before INSERT
conn.execute('SELECT pg_advisory_xact_lock(74101)')
```

**Trade-off:** all telemetry writers must honor this advisory lock; PostgreSQL does not enforce the protocol for arbitrary external SQL. It intentionally limits concurrent write scaling. **Validation:** bootstrap/cursor and reconnect integration tests, duplicate transaction tests, and live browser transitions. A distributed-writer stress test is not claimed.

## 9. Alert flooding

**Problem and effect:** a persistent high reading every two seconds could create dozens of identical alerts per minute, hiding other incidents.

**Alternatives:** frontend suppression, hysteresis, incident open/close state machines. **Selection:** database cooldown per machine/metric/severity, independent of acknowledgement. Severity escalation remains immediately eligible.

```sql
-- database/01-schema.sql:detect_alerts
AND created_at > now() - make_interval(secs=>t.cooldown_seconds)
```

**Trade-off:** a persistent anomaly can alert again when cooldown expires; returning to normal does not automatically resolve earlier alerts. Offline events use a fixed 60-second cooldown. **Validation:** two critical inserts create one temperature alert; controls generate real anomalies, acknowledgement persists, and simulation reset returns readings to baseline.

## 10. Independent service failures

**Problem and effect:** one failure should not silently imply all other services are healthy or destroy persisted data.

**Alternatives:** restart the entire stack or add an orchestrator/queue. **Selection:** Compose restart policy, stale collector heartbeat, API dependency readiness, reconnecting listener, bounded retry queue, socket reconnect, and explicit unknown/error UI.

```python
# ingestion/collector.py:Collector.flush
self.retry_at = time.monotonic() + min(30, 2 ** min(self.attempt-1,5))
```

**Trade-off:** DB outage metrics cannot themselves be persisted until recovery; memory buffering is finite, and there is no automatic disk failover. **Validation:** `docs/outage-results.json` records collector, backend and DB stop/start checks on a dedicated Compose project. Browser network interruption is checked separately. Retention-expiry recovery and prolonged disk failures are not claimed as tested.

## Issues actually observed and resolved

- The host's Docker Desktop credential helper and Compose plugin paths were broken. Testing used an isolated temporary Docker configuration and standalone Compose binary; no user Docker configuration was changed.
- Colima did not mount the host SQL directory. The database Docker image now copies initialization scripts, and the manual initializer handles local PostgreSQL.
- Node 25 exposes a global `localStorage` incompatible with the test environment. Test setup provides deterministic storage; the production browser uses its native storage.
- A screen-reader-only table label escaped the mobile scroll container and enlarged the page. The header now has an accessible attribute; browser checks confirm no horizontal page overflow at 390 px.
- Cross-host timestamp subtraction was slightly negative on the local host/VM topology. The UI identifies clock skew; same-VM Compose metrics and host-monotonic transaction timing are available separately.
- The original test dependencies had published security advisories. Updating to Vitest 4.1.12 yielded a zero-vulnerability npm audit at verification time.
- Browser test selectors initially matched hidden select options or included changing alert counts. Controls now have explicit accessible names; assertions target visible UI. Those were test-harness failures, not claimed production outages.
