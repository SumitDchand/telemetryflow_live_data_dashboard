import { useState } from "react";
import { Save, SlidersHorizontal, KeyRound } from "lucide-react";
import { control } from "../services/api";
export function Simulation({ machines, selected, token, onChange }) {
  const [machine, setMachine] = useState(
      selected || machines[0]?.id || "MCH-001",
    ),
    [scenario, setScenario] = useState("normal"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true);
    try {
      const res = await control(
        "/simulation",
        "POST",
        { machine_id: machine, scenario },
        token,
      );
      setMessage(
        `${res.data.machine_id}: ${res.data.scenario.replaceAll("_", " ")} applied. The collector reads it on its next cycle.`,
      );
      onChange?.();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <h3>
          <SlidersHorizontal size={18} />
          Simulation controls
        </h3>
        <span className="badge simulated">SIMULATED SOURCE</span>
      </div>
      <p>
        Change the Python sensor source and observe the persisted readings in
        real time.
      </p>
      <div className="filters">
        <label>
          Machine
          <select
            aria-label="Simulation machine"
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
          >
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scenario
          <select
            aria-label="Simulation scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          >
            {Object.entries({
              normal: "Normal / return to normal",
              temperature_spike: "Temperature spike",
              excessive_vibration: "Excessive vibration",
              pressure_anomaly: "Pressure anomaly",
              machine_failure: "Machine failure",
            }).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={apply}>
          Apply scenario
        </button>
      </div>
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      <div className="scenario-list">
        {machines.map((m) => (
          <span key={m.id}>
            {m.name}
            <strong>{m.scenario?.replaceAll("_", " ") || "normal"}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}
function Threshold({ value, token, onChange }) {
  const [warning, setWarning] = useState(value.warning),
    [critical, setCritical] = useState(value.critical),
    [cooldown, setCooldown] = useState(value.cooldown_seconds),
    [message, setMessage] = useState("");
  async function save(e) {
    e.preventDefault();
    try {
      await control(
        `/thresholds/${value.metric}`,
        "PATCH",
        {
          warning: Number(warning),
          critical: Number(critical),
          cooldown_seconds: Number(cooldown),
        },
        token,
      );
      setMessage("Saved");
      onChange();
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <form className="threshold-row" onSubmit={save}>
      <strong>{value.metric}</strong>
      <label>
        Warning
        <input
          aria-label={`${value.metric} warning`}
          type="number"
          min="0.1"
          max="1000"
          step="0.1"
          required
          value={warning}
          onChange={(e) => setWarning(e.target.value)}
        />
      </label>
      <label>
        Critical
        <input
          aria-label={`${value.metric} critical`}
          type="number"
          min="0.1"
          max="1000"
          step="0.1"
          required
          value={critical}
          onChange={(e) => setCritical(e.target.value)}
        />
      </label>
      <label>
        Cooldown (s)
        <input
          aria-label={`${value.metric} cooldown`}
          type="number"
          min="5"
          max="3600"
          required
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
        />
      </label>
      <button aria-label={`Save ${value.metric}`}>
        <Save size={16} />
        Save
      </button>
      <small role="status">{message}</small>
    </form>
  );
}
export function Settings({ token, setToken, data }) {
  return (
    <>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h3>
            <KeyRound size={18} />
            Control access
          </h3>
        </div>
        <p>
          Enter ADMIN_TOKEN from your local .env to acknowledge alerts, change
          thresholds, and run simulation scenarios. The token stays in memory
          for this tab.
        </p>
        <label className="token-label">
          Control token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter your local control token"
          />
        </label>
        <p className="footnote">
          A page refresh clears the token. Keep this local demonstration on a
          trusted network.
        </p>
      </section>
      <Simulation
        machines={data.machines}
        token={token}
        onChange={data.refresh}
      />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h3>Alert thresholds</h3>
          <span className="muted">Applied by PostgreSQL on insertion</span>
        </div>
        {data.thresholds.map((t) => (
          <Threshold
            key={`${t.metric}-${t.warning}-${t.critical}`}
            value={t}
            token={token}
            onChange={data.refresh}
          />
        ))}
      </section>
    </>
  );
}
