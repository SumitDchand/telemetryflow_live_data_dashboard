# REST API reference

Base URL: `http://127.0.0.1:3001/api` for local development, or `/api` on the frontend origin. Every request/response is JSON. Read routes are local-demo unauthenticated. Every PATCH and POST below requires `Authorization: Bearer <ADMIN_TOKEN>`.

Success envelopes use `{ "data": ... }`. Paged lists also contain `next_cursor` (string or null). Errors use `{ "error": { "message": "..." } }`, optionally with validation `details`. BIGINT IDs/counters from PostgreSQL are strings. Numeric aggregates may also be PostgreSQL numeric strings; clients should convert before arithmetic.

| HTTP code | Meaning |
|---|---|
| 200 | Successful read/update |
| 400 | Invalid query, path, JSON or body |
| 401 | Missing/incorrect control token |
| 403 | Browser Origin not allowed |
| 404 | Unknown route, machine or alert |
| 413 | Request JSON exceeds 16 KiB |
| 429 | More than 600 requests/minute per client IP |
| 503 | Database unavailable, query timeout, or other internal service error |

## Shared query contract

`backend/src/middleware/validation.js:querySchema` validates:

| Parameter | Allowed values / default | Used by |
|---|---|---|
| `machine_id` | `MCH-001` style; absent = fleet | Bootstrap, latest, history, summary, alerts |
| `start`, `end` | ISO 8601 with UTC Z or offset | History, summary, bootstrap history |
| `range` | `15m`, `1h` (default), `6h`, `24h`, `7d` | History, summary, bootstrap; explicit start overrides lower bound |
| `metric` | temperature (default), pressure, vibration, power | Summary |
| `severity` | warning, critical | Alerts |
| `status` | active, acknowledged | Alerts |
| `limit` | integer 1–1,000; default 100 | History, alerts |
| `cursor` | positive/zero decimal string, max 18 digits | History and alerts: IDs strictly less than cursor |

Unsupported fields are ignored; a shared parameter is applied only to the endpoints listed. Date bounds are inclusive and capped to 31 days ending at `end` or now. If only `end` is supplied, the default relative lower bound still applies; supply both dates for explicit past intervals. Pagination is by ingestion ID, not timestamp. Do not reuse an alert cursor as a telemetry cursor.

## Health

`GET /health` and `GET /ready` check database/schema access:

```json
{"data":{"status":"ready","database":true}}
```

Readiness concerns the API's database dependency, not whether the collector is currently alive. See system stats for the collector heartbeat.

## Machines

`GET /machines` returns registered assets with the current persisted scenario.

```json
{"data":[{"id":"MCH-001","name":"Atlas Press","type":"Hydraulic press","location":"Assembly · Zone A","registered_at":"2026-11-24T07:00:00Z","scenario":"normal"}]}
```

`GET /machines/:id` returns one machine and `latest` (a full reading, or null). Unknown machine = 404; invalid ID format = 400.

## Initial snapshot

`GET /bootstrap?machine_id=MCH-001&range=1h` returns a consistent snapshot:

```json
{"data":{"cursor":"125","readings":[],"latest":[],"machines":[],"thresholds":[]}}
```

Empty arrays above illustrate the envelope. The actual response contains at most 1,000 newest history rows plus latest readings, all machines, and all thresholds. The cursor is the maximum committed telemetry ID in the same repeatable-read transaction. History is reverse ingestion order. Subscribe to WebSockets **after this cursor**; see [WEBSOCKETS.md](WEBSOCKETS.md).

## Telemetry

- `GET /telemetry/latest?machine_id=MCH-001`: latest event-time reading per selected machine; uses `{data:[...]}`.
- `GET /telemetry/history?machine_id=MCH-001&range=1h&limit=100`: descending ingestion-ID page, with `next_cursor`. Pass that cursor for the next page. A query with no matching data returns an empty array and null cursor.
- `GET /telemetry/summary?machine_id=MCH-001&metric=temperature&range=24h`: minute buckets and full-selection summary.

```json
{
  "data":[{"bucket":"2026-11-24T07:00:00Z","machine_id":"MCH-001","min":51.2,"max":55.8,"avg":53.4,"count":30}],
  "aggregate":{"min":51.2,"max":55.8,"avg":53.4,"count":30},
  "truncated":false
}
```

Examples in this document are illustrative response shapes. The backend computes every real value from PostgreSQL. Summary limits plotted groups to 2,000, ordered by bucket time; `truncated` conservatively becomes true at the cap. No readings means null min/max/avg and zero count.

CSV is a frontend export using consecutive history pages, capped at 10,000 readings. There is no separate export endpoint. A visible message explains truncation. Export uses the last applied filters, not unsubmitted input changes.

## Alerts

`GET /alerts?severity=critical&status=active&machine_id=MCH-001&limit=50` returns newest alert IDs first, with a pagination cursor. Each row has `id`, `machine_id`, nullable `reading_id`, `metric`, `observed_value`, `threshold_value`, `severity`, `status`, `created_at`, and nullable `acknowledged_at`.

`PATCH /alerts/:id/acknowledge` requires the control token; no body is necessary. It returns the updated row and emits `alert_acknowledged`. The operation is idempotent, preserving the first acknowledgement time. It does not fix a physical condition or change the simulator. Normal measurements do not generate alert rows; active alerts do not auto-resolve when readings normalize.

## Pipeline statistics

`GET /system/stats` returns measured/persisted values:

| Field | Definition |
|---|---|
| `successful_writes` | Lifetime newly inserted rows, not transaction count |
| `failed_attempts` | Failed flush attempts persisted on a later successful flush |
| `dropped_readings` | Cumulative oldest-first memory overflow drops reported on recovery |
| `buffered_readings` | Remaining queue size at the last successful write |
| `heartbeat_at`, `last_success_at`, `started_at` | Database timestamps for collector heartbeat, nonempty insert and latest process start |
| `last_batch_ms` | Last batch work duration measured by Python before health update/commit; may differ from total transaction log duration |
| `total_machines`, `active_machines` | Registered assets; recent (<15 s) non-offline latest readings |
| `average_temperature` | Mean of latest per-machine temperatures |
| `active_alerts` | All unacknowledged alerts across the fleet |
| `ingestion_rate` | Rows inserted in the last 30 database seconds / 30 |
| `ingestion_latency_ms` | Mean database insert timestamp minus source timestamp for the last 30 seconds; requires synchronized clocks |
| `ingestion_online` | A prior successful insert exists and heartbeat is newer than 15 s |
| `database_connected` | True when the statistics query succeeded |
| `connected_clients`, `backend_uptime` | Current hub connections and Node process uptime seconds |
| `measured_at` | Node UTC response time |

Statistics are fleet-wide even when a machine filter is active. The overview labels fleet-wide alerts/counters. During a database outage the endpoint returns 503; it cannot report current in-memory collector counters. The pipeline page treats unavailable statistics as unknown, never fabricates zero uptime or healthy connectivity. Negative cross-clock latency is shown as “Clock skew detected.”

## Simulation and thresholds

`POST /simulation`:

```json
{"machine_id":"MCH-001","scenario":"temperature_spike"}
```

Scenarios: `normal`, `temperature_spike`, `excessive_vibration`, `pressure_anomaly`, `machine_failure`. Returns the persisted control with `updated_at`. A connected Python collector applies it on its next cycle. `normal` returns to baseline behavior, which includes rare seeded anomalies.

`GET /thresholds` lists metric warning/critical values and cooldown seconds.

`PATCH /thresholds/:metric`:

```json
{"warning":80,"critical":95,"cooldown_seconds":60}
```

Both limits must be positive and at most 1,000, with critical greater than warning; cooldown 5–3,600 seconds. These are **upper** thresholds. The SQL trigger creates one alert per machine/metric/severity per cooldown, including already acknowledged alerts in deduplication. Escalating from warning to critical is a distinct severity and can alert immediately. Offline status has a fixed 60-second cooldown.

## cURL examples

From any directory while the backend is running:

```bash
curl --fail http://127.0.0.1:3001/api/health
curl --fail 'http://127.0.0.1:3001/api/telemetry/history?machine_id=MCH-001&limit=5'
curl --fail 'http://127.0.0.1:3001/api/alerts?severity=critical&status=active'
```

For mutating requests, use a private Postman environment or the Settings token input. Avoid pasting secrets into shared shell transcripts. [`scripts/demo.sh`](../scripts/demo.sh) runs a set of read-only examples.

The default stale threshold is 15 seconds. When INGEST_INTERVAL is increased, the backend reports `stale_after_seconds = max(15, interval × 3)` (up to 180 seconds); the dashboard uses this value. Keep backend and collector interval configuration aligned.

The pipeline UI also measures `Source → browser receipt` locally from the newest reading timestamp in each received WebSocket batch to browser receipt time. This is not an API field, excludes chart paint, and includes backlog age during replay.
