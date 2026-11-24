# Troubleshooting

Start with `docker compose ps`, `docker compose logs --tail=100`, and `curl http://127.0.0.1:3001/api/ready`. Follow the symptom to its owning service instead of restarting everything.

| Symptom | Likely cause | Diagnose / resolve |
|---|---|---|
| API says service unavailable | Database offline, wrong URL, missing schema, or timed-out query | Inspect backend/DB logs and readiness. Confirm `.env`, run `scripts/init-db.py` on an empty manual DB |
| No readings; collector startup_retry | Database not initialized or unreachable | SQL tables must exist; collector intentionally waits for machine registration before collecting |
| Tables absent despite database container running | Initialization volume was already used, or an older mount configuration failed | Current image packages SQL. Initialization runs only on an empty volume. Use the manual initializer only for an empty schema; preserve existing data |
| Cannot connect to Docker daemon | Docker Desktop/Colima is stopped or socket access is restricted | Start the intended Docker runtime and inspect `docker context ls`; do not change unrelated contexts blindly |
| Missing docker-credential-desktop | Stale Docker Desktop credential helper | Repair your Docker installation. During validation, an isolated temporary DOCKER_CONFIG avoided changing personal configuration |
| `docker compose` unavailable | Broken/missing Compose plugin | Install/repair Docker Compose v2.24+; QA `!override` syntax requires it |
| Port already allocated | Another service uses 5433/3001/8080/5173 | Stop the relevant project-owned process or change documented port/proxy/Origin settings together |
| Socket fails with 403 | Page origin absent from ALLOWED_ORIGINS | Include the exact scheme/host/port; `localhost` and `127.0.0.1` are different origins |
| Control returns 401 | Token missing/wrong | Enter ADMIN_TOKEN from private `.env` in Settings. Refresh clears it intentionally |
| Scenario appears unchanged | Collector stale, target machine not collected, or reconnect backoff | Inspect heartbeat and scenarios. Allow the next connected collection cycle; MACHINE_COUNT controls selected registered machines |
| Active alert remains after normal readings | Acknowledgement is separate from condition state | Acknowledge it; the app does not implement automatic incident resolution |
| More alerts appear after acknowledgement | Sustained condition passed cooldown | Reset the scenario or raise an appropriate threshold; acknowledgement alone does not reset the cooldown |
| Dashboard reconnecting | Server/network interruption or invalid origin | Server pings every 15 s; browser retries up to 30 s. Persisted rows catch up on reconnect |
| Old chart readings disappear | Bounded visualization window | Use Historical Analytics; charts keep at most 1,500 readings and sample points |
| History shows no current minute | End date rounded to minute in date picker | Move the end later or select a new range and Apply filters |
| CSV is incomplete | 10,000-row export ceiling | Narrow the range; the UI reports truncation |
| Clock skew detected | Source and DB clocks differ | Synchronize host/VM clocks or use all-Compose execution. Transaction duration uses monotonic time; timestamp subtraction does not |
| Ingestion counters stale during DB failure | Counters are persisted in DB | Use logs and stale heartbeat; local failure/drop counts persist on the next successful flush |
| Buffer dropped readings | Outage exceeded bounded memory capacity | Read structured overflow logs and dropped_readings after recovery. Add durable spooling for stronger guarantees |
| Changing SQL does not change existing DB | Init scripts are not migrations | Apply reviewed migrations; do not erase a data volume as an upgrade strategy |
| Test browser unavailable | Chrome not installed / wrong channel | Install Chrome or provide an installed Playwright browser channel; report browser checks as unexecuted if unavailable |
| Integration tests skip | DATABASE_URL absent | Run through `python3 scripts/with-env.py ...` |
| npm package fetch fails | Restricted DNS/network | Allow package-registry access through the environment's approved mechanism; do not disable TLS verification |

## Independent recovery behavior

- **Collector stops:** historical data remains readable; latest readings become stale after 15 seconds. Restart creates a new simulator sequence and resumes writes, preserving UUID uniqueness and lifetime counters.
- **Backend stops:** Python keeps persisting. HTTP/WS become unavailable. Restart reestablishes LISTEN; browser reconnect/cursor replay catches up.
- **Database stops:** readiness becomes 503; collector keeps a bounded queue after initial startup and retries with backoff. Buffer drops and failed attempts are reported after recovery. A process crash during outage loses that memory.
- **Browser disconnects:** server eventually removes the dead socket; the browser merges replay after its last cursor. Beyond retention, expired readings cannot be recovered.

For observed failure test evidence see [outage-results.json](outage-results.json). These tests used a dedicated local QA stack, not a deployed production service.

The default stale threshold is 15 seconds. When INGEST_INTERVAL is increased, the backend reports `stale_after_seconds = max(15, interval × 3)` (up to 180 seconds); the dashboard uses this value. Keep backend and collector interval configuration aligned.
