# The life of a reading

A reading is a timestamped observation, not a current value that gets overwritten. Keeping observations lets us reconstruct a machine's history.

1. `ingestion/main.py:main()` loads `Config`, opens PostgreSQL, registers extra machines when `MACHINE_COUNT > 5`, and creates `Simulator` with a reproducible seed.
2. On each interval, `Database.configuration()` reads persistent scenarios and thresholds. On a database failure, the collector keeps the last known controls.
3. `Simulator.collect()` moves each metric gradually towards its machine-specific baseline with Gaussian fluctuations. Rare deterministic anomalies and explicit persistent scenarios produce spikes or an offline machine. UUIDs and UTC times are deliberately not deterministic.
4. `Collector.enqueue()` calls `validator.validate()`. Finite numeric ranges, valid status, UUID, machine/sensor IDs, and timezone-aware UTC are checked. Invalid data is logged and rejected. The oldest buffered reading is removed and counted if the queue is full.
5. `Collector.flush()` passes at most `BATCH_SIZE` readings to `Database.write_batch()`. One PostgreSQL connection is reused. Psycopg `executemany(..., returning=True)` pipelines parameterized statements inside one transaction.
6. SQL acquires advisory lock `74101`; telemetry rows use `ON CONFLICT(event_id) DO NOTHING`. See `ingestion/database.py:INSERT`. New rows invoke `database/01-schema.sql:detect_alerts()`; duplicates do not.
7. The transaction updates `ingestion_health` and executes `SELECT pg_notify('telemetry_committed', %s)`. A rollback removes all readings, alerts, counter changes, and the notification from that batch. The queue is popped only after commit succeeds.
8. `backend/src/services/listener.js:listen()` receives a notification on its dedicated connection and invokes `Hub.wake()`. A two-second timer does the same work if the notification is lost.
9. `backend/src/websocket/hub.js:Hub.pump()` executes:
   ```sql
   SELECT * FROM telemetry WHERE id > $1 ORDER BY id LIMIT 500;
   ```
   It filters the batch by subscription, reads associated alerts, sends `telemetry_update` and optional `alert_triggered`, and advances the per-client cursor. It scans all machine IDs before filtering so filtered clients still advance their global watermark.
10. `frontend/src/hooks/useTelemetry.js:useTelemetry()` initially fetches `/api/bootstrap?range=1h`. After loading that consistent snapshot, it opens native WebSocket `/ws` and sends:
    ```json
    {"type":"subscribe","cursor":"125","machine_id":null}
    ```
11. A message handler deduplicates by `event_id` into the bounded buffer. Every 500 ms, React state receives the buffer unless visualization is paused. Pause does not stop ingestion or recovery. Reconnection resends the last merged cursor.
12. `TelemetryChart` groups readings into two-second buckets, samples at most roughly 180 chart points, and renders Recharts lines for each machine. `Machines` uses the newest **event-time** reading and shows stale status after 15 seconds.

## Example event

Example structure only; values below are explanatory, not fake dashboard data:

```json
{
  "id": "126",
  "event_id": "526c6038-a16c-4eb5-b739-3415d5682370",
  "machine_id": "MCH-001",
  "sensor_id": "MCH-001-S01",
  "temperature": 54.6,
  "pressure": 4.12,
  "vibration": 1.24,
  "power": 25.7,
  "status": "running",
  "recorded_at": "2026-11-24T07:00:00.000Z",
  "ingested_at": "2026-11-24T07:00:00.006Z"
}
```

| Field | Meaning |
|---|---|
| `id` | Database BIGINT ingestion/recovery position, represented as a JSON string |
| `event_id` | Stable UUID for deduplication through retries |
| `machine_id` | Foreign key to the registered asset |
| `sensor_id` | Source identifier; the simulator has one multi-metric sensor per asset |
| `temperature`, `pressure`, `vibration`, `power` | °C, bar, mm/s, and kW respectively |
| `status` | running, warning, critical, or offline |
| `recorded_at` | UTC timestamp supplied by the collector |
| `ingested_at` | Database insertion timestamp, not an exact commit timestamp |

This is a small **ETL** pipeline: extract/generate, validate/transform, then load. The analytics queries are also an **ELT** step: loaded readings are aggregated inside PostgreSQL. There is no separate warehouse.

## Controls and alerts

Settings sends token-authorized `POST /api/simulation`. Express updates `simulation_controls`; Python reads it on its next connected cycle. No frontend-only metric manipulation occurs. `normal` clears persistent scenarios, while the seeded simulator can still produce rare natural anomalies.

A threshold update changes `thresholds`, used by the SQL trigger and by the collector's status classification on its next cycle. Already stored readings are not reclassified. `PATCH /api/alerts/:id/acknowledge` persists acknowledgement and broadcasts `alert_acknowledged`. Repeating it preserves the original acknowledgement timestamp.

The default stale threshold is 15 seconds. When INGEST_INTERVAL is increased, the backend reports `stale_after_seconds = max(15, interval × 3)` (up to 180 seconds); the dashboard uses this value. Keep backend and collector interval configuration aligned.
