import { Cpu, ChevronRight } from "lucide-react";
import { format, time } from "../services/api";
export function Status({ value }) {
  return (
    <span className={`badge ${value}`}>
      {value === "running"
        ? "Operational"
        : value?.replaceAll("_", " ") || "Awaiting data"}
    </span>
  );
}
export function Machines({ machines, latest, onSelect, staleSeconds = 15 }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Machine / location</th>
            <th>Status</th>
            <th>Temperature</th>
            <th>Pressure</th>
            <th>Vibration</th>
            <th>Power</th>
            <th>Last received</th>
            <th aria-label="Details" />
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            const r = latest.find((r) => r.machine_id === m.id);
            const stale =
              r && Date.now() - new Date(r.recorded_at) > staleSeconds * 1000;
            return (
              <tr key={m.id}>
                <td>
                  <button
                    className="machine-link"
                    onClick={() => onSelect(m.id)}
                  >
                    <span className="machine-icon">
                      <Cpu size={18} />
                    </span>
                    <span>
                      <strong>{m.name}</strong>
                      <small>
                        {m.id} · {m.location}
                      </small>
                    </span>
                  </button>
                </td>
                <td>
                  <Status value={stale ? "stale" : r?.status} />
                </td>
                <td className={r?.temperature >= 80 ? "text-amber" : ""}>
                  {format(r?.temperature)} <small>°C</small>
                </td>
                <td>
                  {format(r?.pressure)} <small>bar</small>
                </td>
                <td>
                  {format(r?.vibration)} <small>mm/s</small>
                </td>
                <td>
                  {format(r?.power)} <small>kW</small>
                </td>
                <td className="muted mono">{time(r?.recorded_at)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Inspect ${m.name}`}
                    onClick={() => onSelect(m.id)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!machines.length && (
        <div className="empty">No machines registered yet.</div>
      )}
    </div>
  );
}
