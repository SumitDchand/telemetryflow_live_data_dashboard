import {
  Database,
  Radio,
  Server,
  Workflow,
  Check,
  CircleAlert,
} from "lucide-react";
import { format, time } from "../services/api";
export function Pipeline({ stats, status, deliveryLatency }) {
  const services = [
    {
      name: "Python collector",
      icon: Workflow,
      online: stats?.ingestion_online,
      sub: "Validation & batch ingestion",
    },
    {
      name: "PostgreSQL",
      icon: Database,
      online: stats?.database_connected,
      sub: "Persistent source of truth",
    },
    {
      name: "Express gateway",
      icon: Server,
      online: !!stats,
      sub: "REST & LISTEN / NOTIFY",
    },
    {
      name: "WebSocket stream",
      icon: Radio,
      online: status === "live",
      sub: "Cursor-based recovery",
    },
  ];
  return (
    <>
      <section className="pipeline-grid">
        {services.map(({ name, icon: Icon, online, sub }) => (
          <div className="panel service-card" key={name}>
            <Icon size={26} />
            <h3>{name}</h3>
            <p>{sub}</p>
            <span className={`badge ${online ? "running" : "stale"}`}>
              {online ? <Check size={14} /> : <CircleAlert size={14} />}{" "}
              {online ? "Connected" : "Unavailable / awaiting data"}
            </span>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h3>Pipeline diagnostics</h3>
          <span className="muted">Measured every 5 seconds</span>
        </div>
        <div className="diagnostics">
          {[
            ["Ingestion heartbeat", time(stats?.heartbeat_at)],
            ["Most recent write", time(stats?.last_success_at)],
            [
              "Successful inserted records",
              format(stats?.successful_writes, 0),
            ],
            ["Failed write attempts", format(stats?.failed_attempts, 0)],
            ["Buffered readings", format(stats?.buffered_readings, 0)],
            ["Dropped on buffer overflow", format(stats?.dropped_readings, 0)],
            [
              "Current ingestion rate",
              `${format(stats?.ingestion_rate, 2)} records/s`,
            ],
            [
              "Record → database latency",
              stats?.ingestion_latency_ms < 0
                ? "Clock skew detected"
                : `${format(stats?.ingestion_latency_ms, 2)} ms`,
            ],
            [
              "Last transaction duration",
              `${format(stats?.last_batch_ms, 2)} ms`,
            ],
            [
              "Connected WebSocket clients",
              format(stats?.connected_clients, 0),
            ],
            ["Backend uptime", `${format(stats?.backend_uptime, 0)} seconds`],
            ["Statistics measured at", time(stats?.measured_at)],
            [
              "Source → browser receipt",
              deliveryLatency < 0
                ? "Clock skew detected"
                : `${format(deliveryLatency, 1)} ms`,
            ],
          ].map(([name, value]) => (
            <div key={name}>
              <span>{name}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
      <div className="panel note-panel">
        <h3>Designed to recover</h3>
        <p>
          Readings survive backend and browser restarts in PostgreSQL. Missed
          notifications are recovered from the database every two seconds.
          During a database outage, Python buffers a bounded number of readings
          in memory and retries with exponential backoff.
        </p>
        <p>
          Failure and buffer counters update after database recovery. A stale
          heartbeat is the signal while PostgreSQL cannot accept writes.
          Cross-service timestamp latency requires synchronized clocks; a
          negative measurement is shown as clock skew. Source-to-browser latency
          is measured when the latest batch arrives, before chart rendering.
          Replayed data includes its backlog delay. The benchmark measures a
          separate Node client.
        </p>
      </div>
    </>
  );
}
