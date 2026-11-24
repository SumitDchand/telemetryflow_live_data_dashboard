const ranges = {
  "15m": 900,
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
};
export function where(q, alias = "t") {
  const values = [];
  const clauses = [];
  const bind = (v) => {
    values.push(v);
    return `$${values.length}`;
  };
  if (q.machine_id) clauses.push(`${alias}.machine_id=${bind(q.machine_id)}`);
  clauses.push(
    `${alias}.recorded_at >= ${q.start ? bind(q.start) + "::timestamptz" : `now() - ${bind(ranges[q.range || "1h"])} * interval '1 second'`}`,
  );
  if (q.end)
    clauses.push(`${alias}.recorded_at <= ${bind(q.end)}::timestamptz`);
  // Even a start-only request is bounded to one month.
  clauses.push(
    `${alias}.recorded_at >= COALESCE(${bind(q.end || null)}::timestamptz,now()) - interval '31 days'`,
  );
  return { values, sql: clauses.join(" AND ") };
}
export async function latest(db, machine) {
  return (
    await db.query(
      `SELECT DISTINCT ON (machine_id) * FROM telemetry ${machine ? "WHERE machine_id=$1" : ""} ORDER BY machine_id,recorded_at DESC,id DESC`,
      machine ? [machine] : [],
    )
  ).rows;
}
export async function history(db, q) {
  const { values, sql } = where(q);
  if (q.cursor) values.push(q.cursor);
  const cursor = q.cursor ? ` AND t.id < $${values.length}` : "";
  values.push(q.limit + 1);
  const { rows } = await db.query(
    `SELECT t.* FROM telemetry t WHERE ${sql}${cursor} ORDER BY t.id DESC LIMIT $${values.length}`,
    values,
  );
  return {
    data: rows.slice(0, q.limit),
    next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
  };
}
export async function summary(db, q) {
  const { values, sql } = where(q);
  // metric is an enum validated by the controller, never arbitrary user SQL.
  const metric = q.metric;
  const { rows } = await db.query(
    `SELECT date_bin(interval '1 minute', recorded_at, '2000-01-01'::timestamptz) AS bucket,
 machine_id, min(${metric}) AS min, max(${metric}) AS max, avg(${metric}) AS avg, count(*)::int AS count
 FROM telemetry t WHERE ${sql} GROUP BY bucket,machine_id ORDER BY bucket DESC,machine_id LIMIT 2000`,
    values,
  );
  const aggregate = await db.query(
    `SELECT min(${metric}) AS min,max(${metric}) AS max,avg(${metric}) AS avg,count(*)::int AS count FROM telemetry t WHERE ${sql}`,
    values,
  );
  return {
    data: rows.reverse(),
    aggregate: aggregate.rows[0],
    truncated: rows.length === 2000,
  };
}
export async function stats(db, clients = 0) {
  const staleSeconds = Math.max(
    15,
    Math.min(180, (Number(process.env.INGEST_INTERVAL) || 2) * 3),
  );
  const {
    rows: [row],
  } = await db.query(
    `SELECT h.*,
 (SELECT count(*)::int FROM machines) AS total_machines,
 (SELECT count(*)::int FROM (SELECT DISTINCT ON(machine_id) status,recorded_at FROM telemetry ORDER BY machine_id,recorded_at DESC,id DESC) l WHERE status<>'offline' AND recorded_at>now()-$1*interval '1 second') AS active_machines,
 (SELECT avg(temperature) FROM (SELECT DISTINCT ON(machine_id) temperature FROM telemetry ORDER BY machine_id,recorded_at DESC,id DESC) l) AS average_temperature,
 (SELECT count(*)::int FROM alerts WHERE status='active') AS active_alerts,
 (SELECT count(*)/30.0 FROM telemetry WHERE ingested_at>now()-interval '30 seconds') AS ingestion_rate,
 (SELECT avg(extract(epoch FROM (ingested_at-recorded_at))*1000) FROM telemetry WHERE ingested_at>now()-interval '30 seconds') AS ingestion_latency_ms,
 last_success_at IS NOT NULL AND heartbeat_at>now()-$1*interval '1 second' AS ingestion_online
 FROM ingestion_health h WHERE id=1`,
    [staleSeconds],
  );
  return {
    ...row,
    stale_after_seconds: staleSeconds,
    database_connected: true,
    connected_clients: clients,
    backend_uptime: process.uptime(),
    measured_at: new Date().toISOString(),
  };
}
