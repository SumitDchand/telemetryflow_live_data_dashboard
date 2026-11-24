import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { api, params, format, time } from "../services/api";
import { TelemetryChart, METRICS } from "../components/TelemetryChart";
function localDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function History({ machine, machines }) {
  const [start, setStart] = useState(localDate(new Date(Date.now() - 3600000))),
    [end, setEnd] = useState(localDate(new Date()));
  const [metric, setMetric] = useState("temperature"),
    [result, setResult] = useState(null),
    [rows, setRows] = useState([]),
    [cursor, setCursor] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null);
  async function run() {
    if (!start || !end || new Date(start) > new Date(end)) {
      setError("Choose a valid start and end date.");
      return;
    }
    setBusy(true);
    setError("");
    const query = {
      machine_id: machine,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      metric,
      limit: 100,
    };
    try {
      const [aggregate, history] = await Promise.all([
        api(`/telemetry/summary?${params(query)}`),
        api(`/telemetry/history?${params(query)}`),
      ]);
      setApplied(query);
      setResult(aggregate);
      setRows(history.data);
      setCursor(history.next_cursor);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    run();
  }, [machine]);
  async function more() {
    setBusy(true);
    try {
      const res = await api(
        `/telemetry/history?${params({ ...applied, cursor })}`,
      );
      setRows(res.data);
      setCursor(res.next_cursor);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!applied) return;
    setBusy(true);
    setError("");
    try {
      let all = [],
        next = null;
      do {
        const res = await api(
          `/telemetry/history?${params({ ...applied, limit: 1000, cursor: next })}`,
        );
        all.push(...res.data);
        next = res.next_cursor;
      } while (next && all.length < 10000);
      const keys = [
        "event_id",
        "machine_id",
        "sensor_id",
        "recorded_at",
        "temperature",
        "pressure",
        "vibration",
        "power",
        "status",
      ];
      const csv = [
        keys.join(","),
        ...all.map((r) =>
          keys.map((k) => `"${String(r[k]).replaceAll('"', '""')}"`).join(","),
        ),
      ].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "telemetryflow-history.csv";
      a.click();
      URL.revokeObjectURL(url);
      if (next)
        setError(
          "Export contains the newest 10,000 readings. Narrow the date range for a complete export.",
        );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const chart =
    result?.data.map((r, i) => ({
      id: String(i),
      event_id: String(i),
      machine_id: r.machine_id,
      recorded_at: r.bucket,
      [applied.metric]: r.avg,
    })) || [];
  return (
    <>
      <div className="panel filters">
        <label>
          From
          <input
            aria-label="From"
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            aria-label="To"
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label>
          Metric
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {Object.entries(METRICS).map(([key, spec]) => (
              <option key={key} value={key}>
                {spec.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={run}>
          <Search size={16} />
          Apply filters
        </button>
        <button disabled={busy || !applied} onClick={download}>
          <Download size={16} />
          Export CSV
        </button>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {result && (
        <>
          <div className="summary-grid">
            {["min", "avg", "max", "count"].map((key) => (
              <div className="panel summary-tile" key={key}>
                <span>
                  {
                    {
                      min: "Minimum",
                      avg: "Average",
                      max: "Maximum",
                      count: "Readings in range",
                    }[key]
                  }
                </span>
                <strong>
                  {format(result.aggregate[key], key === "count" ? 0 : 2)}{" "}
                  <small>
                    {key !== "count" ? METRICS[applied.metric].unit : ""}
                  </small>
                </strong>
              </div>
            ))}
          </div>
          <TelemetryChart
            readings={chart}
            machines={machines}
            metric={applied.metric}
            live={false}
          />
          {result.truncated && (
            <p className="muted">
              Chart shows the newest 2,000 machine-minute buckets. Summary
              covers the full selected range.
            </p>
          )}
        </>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h3>Historical readings</h3>
          <span className="muted">Newest ingested first · 100 per page</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recorded at</th>
                <th>Machine</th>
                <th>Temperature</th>
                <th>Pressure</th>
                <th>Vibration</th>
                <th>Power</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {new Date(r.recorded_at).toLocaleDateString()}{" "}
                    {time(r.recorded_at)}
                  </td>
                  <td>{r.machine_id}</td>
                  <td>{format(r.temperature)} °C</td>
                  <td>{format(r.pressure)} bar</td>
                  <td>{format(r.vibration)} mm/s</td>
                  <td>{format(r.power)} kW</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              {busy ? "Loading history…" : "No readings in this date range."}
            </div>
          )}
        </div>
        <div className="panel-footer">
          <button disabled={!cursor || busy} onClick={more}>
            Next page
          </button>
          <button disabled={!applied || busy} onClick={run}>
            Back to newest
          </button>
        </div>
      </section>
    </>
  );
}
