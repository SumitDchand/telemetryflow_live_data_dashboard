# Real-time communication

A WebSocket is a continuing conversation over one TCP connection. The browser can change its subscription and the server can send readings as they arrive. HTTP APIs remain useful for bounded history and explicit commands.

| Transport | How it works | Trade-off here |
|---|---|---|
| HTTP polling | Repeated independent GET requests | Simple but repeated work and interval-bound latency |
| Long polling | Hold a GET until data arrives; reconnect after response | Lower idle traffic, repeated request lifecycle |
| Server-Sent Events | Persistent HTTP stream from server to browser | Excellent for one-way telemetry; commands use separate requests |
| WebSocket | HTTP Upgrade, then framed bidirectional traffic | Chosen for explicit subscriptions, low-overhead streams, and connection health |

SSE would be a reasonable simpler alternative. WebSockets were selected to demonstrate bidirectional subscriptions and application-managed recovery, not because SSE is incapable of streaming metrics.

## Lifecycle

The browser sends an HTTP upgrade handshake to `/ws`. `ws` validates framing and handshake keys; `Hub` rejects unknown paths and Origins, enforces 50 connections, caps incoming frames at 2 KiB, and disables compression. An allowed Origin does not authenticate a nonbrowser client.

TCP guarantees ordered bytes on an established connection, not delivery across disconnects. WebSocket protocol ping/pong detects dead sockets: the server pings every 15 seconds and terminates a client that did not answer by the next sweep. Native browsers respond automatically. The React client reconnects after `min(30s, 1s × 2^attempt)` plus up to 250 ms jitter; successful connection resets the attempt count.

HTTP routes are stateless with respect to history position: each request supplies filters/cursor. WebSocket state includes subscription machine, last cursor, busy flag, and liveness. `subscribe` is permitted once per connection. A machine change reconnects through a new bootstrap; it cannot race with an old subscription inside the same connection.

## Messages

| Direction | Type | Data |
|---|---|---|
| Server → client | `connection_established` | Protocol version and recovery strategy |
| Client → server | `subscribe` | Required string cursor; optional nullable machine ID |
| Server → client | `telemetry_update` | Persisted rows, global cursor, send timestamp |
| Server → client | `alert_triggered` | Alerts attached to those readings |
| Server → client | `alert_acknowledged` | Updated persisted alert |
| Server → client | `system_status` | Database disconnected when a replay query fails |
| Server → client | `error` | Invalid subscription; connection then closes with 1008 |

From `backend/src/websocket/hub.js:Hub.pump()`:

```json
{"type":"telemetry_update","cursor":"126","data":[],"sent_at":"2026-11-24T07:00:00.012Z"}
```

An empty array is valid for a filtered subscription: rows for other machines advanced the **global** cursor. IDs are JSON strings to preserve BIGINT precision.

## Snapshot/live synchronization

`/api/bootstrap` returns initial history and its watermark from a repeatable-read snapshot. React then subscribes after that cursor. This closes the history/live race even if commits happen while the HTTP response travels to the browser. A page already rendered does not depend on retaining an open bootstrap transaction.

Each wake fetches up to 500 committed rows per page, at most ten pages per client. A two-second timer continues remaining catch-up work. The hub does not infer durability from a notification. A client only advances its cursor when it successfully parses and merges a telemetry message; reconnect resends that cursor. Duplicate event UUIDs are merged, and event-time sorting keeps late observations from displacing a newer machine state.

Acknowledgement events are live hints, not replayed durable messages. On reconnect and every five seconds, the UI refreshes alerts from REST, so missed acknowledgements recover. Telemetry and derived alerts are persisted; retained rows are the recovery boundary. A client disconnected beyond retention cannot recover expired rows. No gap/tombstone protocol or exactly-once network delivery is claimed.

## Bounded work and backpressure

When a socket has over 1 MiB queued bytes, it closes with 1013. This makes a slow client reconnect and recover from the database instead of retaining unlimited memory. At most 50 clients connect. Replay is serialized per client with a busy guard. The browser merges at most 1,500 rows and commits React state twice per second; pause continues updating the bounded ref buffer.

`TelemetryChart` is memoized, transforms data with `useMemo`, disables line animations, and samples roughly 180 x-axis points. Each 2-second bucket retains the last observation per machine. This is a visualization window, not an archival export. At higher than 0.5 Hz per machine, intermediate readings remain in PostgreSQL but may be omitted from the plot.

Delivery guarantees: idempotent database writes and recoverable, potentially repeated WebSocket delivery within retention. There is no durable per-client acknowledgement table or distributed queue.

Tests: `backend/tests/api.test.js`, `frontend/tests/telemetry.test.jsx`, `scripts/e2e.mjs`, and `scripts/stream-benchmark.mjs` cover multiple clients, filtering, replay, reconnect, pause, deduplication, and measured client receipt latency.
