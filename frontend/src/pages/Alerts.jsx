import { useEffect, useState } from "react";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, control, params, format } from "../services/api";
import { Status } from "../components/Machines";
export function Alerts({ machine, token, refreshKey, onChange }) {
  const [severity, setSeverity] = useState(""),
    [status, setStatus] = useState(""),
    [alerts, setAlerts] = useState([]),
    [cursor, setCursor] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(next) {
    setBusy(true);
    try {
      const res = await api(
        `/alerts?${params({ machine_id: machine, severity, status, limit: 50, cursor: next })}`,
      );
      setAlerts(res.data);
      setCursor(res.next_cursor);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, [machine, severity, status, refreshKey]);
  async function acknowledge(id) {
    setBusy(true);
    try {
      await control(`/alerts/${id}/acknowledge`, "PATCH", null, token);
      await load();
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="panel filters">
        <label>
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">All severities</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="acknowledged">Acknowledged</option>
          </select>
        </label>
        <span className="muted">
          Alerts use per-machine, per-metric cooldowns.
        </span>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        {alerts.map((a) => (
          <div className="alert-row" key={a.id}>
            <span className={`alert-icon ${a.severity}`}>
              <TriangleAlert size={20} />
            </span>
            <div className="alert-copy">
              <strong>
                {a.metric === "status"
                  ? "Machine stopped responding"
                  : `${a.metric[0].toUpperCase() + a.metric.slice(1)} threshold exceeded`}
              </strong>
              <span>
                {a.machine_id} · Observed {format(a.observed_value, 2)} /
                threshold {format(a.threshold_value, 2)}
              </span>
              <small>{new Date(a.created_at).toLocaleString()}</small>
            </div>
            <Status value={a.severity} />
            {a.status === "active" ? (
              <button disabled={busy} onClick={() => acknowledge(a.id)}>
                <Check size={15} />
                Acknowledge
              </button>
            ) : (
              <span className="muted acknowledged">
                <ShieldCheck size={16} />
                Acknowledged
              </span>
            )}
          </div>
        ))}
        {!alerts.length && (
          <div className="empty">
            <ShieldCheck size={28} />
            <h3>{busy ? "Loading alerts…" : "No alerts to show"}</h3>
            <p>Alerts appear when persisted telemetry crosses a threshold.</p>
          </div>
        )}
        <div className="panel-footer">
          <button disabled={!cursor || busy} onClick={() => load(cursor)}>
            Next page
          </button>
          <button disabled={busy} onClick={() => load()}>
            Refresh
          </button>
        </div>
      </section>
      <p className="footnote">
        Acknowledgement requires the control token set in Settings. Normal
        readings do not create alerts.
      </p>
    </>
  );
}
