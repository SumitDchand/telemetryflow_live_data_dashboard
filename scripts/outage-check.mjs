import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";
// Deliberately targets only the dedicated QA stack; never general production names.
const project = process.env.QA_PROJECT || "telemetryflow-qa";
if (!/^telemetryflow-qa(?:-[a-z0-9]+)?$/.test(project))
  throw new Error("Use a dedicated telemetryflow-qa project");
const api = process.env.QA_API || "http://127.0.0.1:13001";
const url = new URL(process.env.DATABASE_URL);
url.port = process.env.QA_DB_PORT || "15433";
const db = new pg.Pool({
  connectionString: url.toString(),
  connectionTimeoutMillis: 2000,
});
db.on("error", () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function docker(action, service) {
  execFileSync("docker", [action, `${project}-${service}-1`], {
    stdio: "pipe",
  });
}
async function stats() {
  const response = await fetch(`${api}/api/system/stats`, {
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok);
  return (await response.json()).data;
}
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await fn()) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error("Recovery timeout");
}
try {
  await until(async () => Number((await stats()).successful_writes) > 0);
  docker("stop", "ingestion");
  await sleep(17000);
  assert.equal((await stats()).ingestion_online, false);
  docker("start", "ingestion");
  await until(async () => (await stats()).ingestion_online);
  checks.push(
    "Collector stop produces stale heartbeat; restart resumes ingestion",
  );
  console.log("PASS " + checks.at(-1));
  const before = Number(
    (await db.query("SELECT count(*) AS n FROM telemetry")).rows[0].n,
  );
  docker("stop", "backend");
  await sleep(5000);
  const after = Number(
    (await db.query("SELECT count(*) AS n FROM telemetry")).rows[0].n,
  );
  assert(after > before);
  docker("start", "backend");
  await until(async () => (await stats()).database_connected);
  checks.push(
    "Backend stop does not stop database ingestion; restart restores readiness",
  );
  console.log("PASS " + checks.at(-1));
  const failures = Number((await stats()).failed_attempts);
  docker("stop", "db");
  await sleep(8000);
  const readiness = await fetch(`${api}/api/ready`);
  assert.equal(readiness.status, 503);
  docker("start", "db");
  await until(async () => {
    const s = await stats();
    return (
      Number(s.failed_attempts) > failures &&
      s.buffered_readings === 0 &&
      s.ingestion_online
    );
  });
  checks.push(
    "Database outage fails readiness; collector retries and flushes its buffer after recovery",
  );
  console.log("PASS " + checks.at(-1));
  const dupes = (
    await db.query(
      "SELECT count(*)-count(DISTINCT event_id) AS n FROM telemetry",
    )
  ).rows[0].n;
  assert.equal(Number(dupes), 0);
  checks.push("No duplicate event IDs after recovery");
  await writeFile(
    "docs/outage-results.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        project,
        checks,
        final_stats: await stats(),
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  for (const service of ["db", "backend", "ingestion"]) {
    try {
      docker("start", service);
    } catch {}
  }
  await db.end();
}
