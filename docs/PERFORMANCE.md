# Measured performance

These are local development measurements, not a capacity SLA. No production traffic, distributed scale, or browser paint performance is implied. Raw observations and execution plans are in [benchmark-results.json](benchmark-results.json) and [stream-benchmark-results.json](stream-benchmark-results.json).

## Environment and methodology

Executed on 24 November 2026 on an Apple M4 host, 10 logical CPUs, 16 GiB RAM, macOS 27.0.1 arm64, Python 3.11.18, Node 25.8.2, PostgreSQL 17.12 in a local Colima container. Container builds use Node 22 and Python 3.11. The host and VM showed a small wall-clock offset; transaction/API/query durations use monotonic timers. The stream benchmark compares the host collector and host Node client clock. Other development/build work was running concurrently, so these measurements are intentionally described as an illustrative local run, not an isolated lab baseline.

`scripts/benchmark.py` creates a unique temporary PostgreSQL schema, loads the actual schema/indexes/seed, uses the real `Database.write_batch()` path and then drops only that schema. It does not remove application rows/indexes. Each interval configuration uses 30 batches. API and query comparisons use 30 measurements each; individual/batch comparison uses 10 groups of 100 readings. Median is the middle/mean-middle sample; p95 uses nearest rank `ceil(0.95*n)-1`. Small samples limit tail confidence.

## Paced ingestion

| Machines | Interval (s) | Duration (s) | Inserted rows | Failures | Records/s | Batch median (ms) | Batch p95 (ms) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 0.1 | 3.124 | 150 | 0 | 48.01 | 8.291 | 13.581 |
| 5 | 0.5 | 15.099 | 150 | 0 | 9.93 | 6.139 | 12.295 |
| 25 | 0.1 | 3.113 | 750 | 0 | 240.9 | 12.993 | 27.396 |
| 25 | 0.5 | 15.102 | 750 | 0 | 49.66 | 10.297 | 15.365 |
| 100 | 0.1 | 3.148 | 3000 | 0 | 953.12 | 21.867 | 24.551 |
| 100 | 0.5 | 15.147 | 3000 | 0 | 198.07 | 22.664 | 25.161 |

Throughput here includes the configured sleep interval. It is the observed paced rate, not the saturation limit. Trigger alert checks, event uniqueness and the writer lock remain enabled. Faster producer settings require attention to retention throughput and database disk use.

## Individual versus batch transactions

Each mode inserts 1,000 fresh readings. Both use the same production DB adapter and alert logic; one mode commits every reading, the other commits 100 at a time. Ten 100-record groups are measured, so p95 equals the slowest group with this sample count.

| Mode | Records/s | Median for 100 readings (ms) | p95 for 100 readings (ms) |
|---|---:|---:|---:|
| individual | 818.26 | 114.355 | 167.233 |
| batch | 12024.17 | 7.658 | 9.527 |

This isolates transaction/batch overhead on a local connection. It does not assert that browser delivery or production throughput improves by the same factor.

## Historical query: actual index comparison

A separate 100,000-row table contains 100 machine IDs and time-distributed observations. The same query selects the latest 100 rows for one machine within 12 hours, first without an index, then with `(machine_id, recorded_at DESC)`. Each phase warms the cache and runs 30 round trips. Index construction time is excluded; write overhead is not compared here.

| Query | Round-trip median (ms) | Round-trip p95 (ms) | EXPLAIN execution (ms) | Plan |
|---|---:|---:|---:|---|
| unindexed | 3.254 | 3.948 | 2.874 | Sequential scan + top-N sort |
| indexed | 0.305 | 0.407 | 0.03 | Index scan |

EXPLAIN times cover server execution only; the round trip also includes client/network/result decoding. Full plans, buffer hits and row counts are saved in JSON. A composite index reduces work for this selective query, but results depend on selectivity, cache state and table size.

## HTTP API

These measurements query the running development API against its actual ongoing five-machine data. They are separate from the temporary 100,000-row history table; do not treat these API latencies as a 100,000-row API workload. Thirty sequential requests per endpoint, including response body transfer, without artificial concurrency.

| Endpoint | Median (ms) | p95 (ms) | Failed requests |
|---|---:|---:|---:|
| `/api/health` | 0.545 | 0.85 | 0 |
| `/api/telemetry/history?machine_id=MCH-001&limit=100` | 1.08 | 1.236 | 0 |
| `/api/telemetry/summary?range=1h` | 1.905 | 2.667 | 0 |

## WebSocket delivery

`scripts/stream-benchmark.mjs` obtains a bootstrap watermark, subscribes after it and samples only newly delivered rows for 30.003 seconds. It observed 75 records in 15 telemetry messages.

| Measurement | Samples | Median (ms) | p95 (ms) |
|---|---:|---:|---:|
| generation_to_ws_client | 75 | 14 | 18 |
| server_send_to_ws_client | 15 | 0 | 1 |

The first measure includes validation, transaction, notification/recovery scheduling, backend fetch and receipt by a local Node WebSocket client. The second starts immediately before the server send. Millisecond wall-clock precision can yield 0 ms locally; this does not mean zero network time. This is not browser paint latency: React flushes state every 500 ms and therefore adds a separate display delay. Longer stream-tail/concurrency runs remain future validation.

## Resource measurements

The Python benchmark completed in 56.64 seconds, used 0.787 CPU seconds, and had a measured peak RSS of 50,921,472 bytes. Scope: benchmark process only. These are not database or whole-system resource metrics.

A separate single `docker stats --no-stream` snapshot during normal five-machine QA operation observed:

| Container | CPU snapshot | Resident/container memory |
|---|---:|---:|
| PostgreSQL | 2.43% | 33.93 MiB / 512 MiB |
| Backend | 0.01% | 26.61 MiB / 256 MiB |
| Collector | 0.00% | 21.36 MiB / 192 MiB |
| nginx frontend | 0.00% | 4.512 MiB / 128 MiB |

A snapshot does not establish sustained CPU consumption or memory stability. No browser heap/FPS comparison or chart-update-frequency benchmark was executed. No long-duration soak, disk-capacity or maximum-concurrent-client claim is made.

## Reproduce

```bash
python3 scripts/with-env.py .venv/bin/python scripts/benchmark.py --samples 30 --rows 100000
node scripts/stream-benchmark.mjs
```

API URL and output file can be passed with `--api` and `--output`. Stream settings are `API_URL`, `WS_ORIGIN` and `BENCHMARK_SECONDS`. To measure resource snapshots separately, run `docker compose stats --no-stream`. Do not run disruptive outage tests during a controlled latency comparison.

## Implemented bounds and likely bottlenecks

Pipelined transaction batches reduce commits; connection reuse avoids handshakes; indexed bounded pages avoid unrestricted fetches; retention bounds the intended time horizon. Browser arrays cap at 1,500 rows and charts sample roughly 180 points at a 500-ms state cadence. Replay batches contain at most 500 rows and each wake processes ten pages per connection.

At larger scale, likely bottlenecks are the single writer-order lock, alert trigger lookups, per-client replay SQL, fleet-wide latest queries, SVG line rendering, and incremental retention deletion. Candidates include a latest-state table, shared replay batches, partitioned retention, canvas charts and a transactional outbox. Those optimizations have not been implemented or benchmarked here.
