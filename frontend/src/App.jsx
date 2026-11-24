import { useMemo, useState } from "react";
import {
  Activity,
  LayoutDashboard,
  Radio,
  Cpu,
  ChartNoAxesCombined,
  Bell,
  Workflow,
  Settings as SettingsIcon,
  Sun,
  Moon,
  ChevronsUpDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  ArrowUpRight,
  Box,
  Thermometer,
  Database,
  Zap,
  CircleHelp,
  Menu,
  X,
  TriangleAlert,
} from "lucide-react";
import { useTelemetry } from "./hooks/useTelemetry";
import { TelemetryChart } from "./components/TelemetryChart";
import { Machines, Status } from "./components/Machines";
import { History } from "./pages/History";
import { Alerts } from "./pages/Alerts";
import { Settings, Simulation } from "./pages/Settings";
import { Pipeline } from "./pages/Pipeline";
import { format, time } from "./services/api";
const NAV = [
  ["Overview", LayoutDashboard],
  ["Live Telemetry", Radio],
  ["Machine Monitoring", Cpu],
  ["Historical Analytics", ChartNoAxesCombined],
  ["Alerts & Events", Bell],
  ["Pipeline Health", Workflow],
  ["Settings", SettingsIcon],
];
const COPY = {
  Overview: [
    "Operations overview",
    "Your equipment, connected. Every signal, in view.",
  ],
  "Live Telemetry": [
    "Live telemetry",
    "A real-time view of every signal across your machines.",
  ],
  "Machine Monitoring": [
    "Machine monitoring",
    "Understand the health and performance of every asset.",
  ],
  "Historical Analytics": [
    "Historical analytics",
    "Turn persisted sensor readings into operational insight.",
  ],
  "Alerts & Events": [
    "Alerts & events",
    "Investigate anomalies and keep your operations on track.",
  ],
  "Pipeline Health": [
    "Pipeline health",
    "Follow the data from collection to your dashboard.",
  ],
  Settings: [
    "Workspace settings",
    "Configure alert thresholds and control your simulated environment.",
  ],
};
function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  detail,
  tone = "green",
  trend,
}) {
  return (
    <div className="panel metric-card">
      <div className="metric-label">
        {label}
        <Icon size={16} />
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <div className={`metric-detail ${tone}`}>
        {trend && <ArrowUpRight size={14} />}
        <span>{detail}</span>
      </div>
    </div>
  );
}
export default function App() {
  const [view, setView] = useState("Overview"),
    [machine, setMachine] = useState(""),
    [range, setRange] = useState("1h"),
    [token, setToken] = useState("");
  const [light, setLight] = useState(
      () => localStorage.getItem("telemetryflow-theme") === "light",
    ),
    [menu, setMenu] = useState(false);
  const data = useTelemetry(machine, range);
  const s = data.stats;
  const visibleMachines = useMemo(
    () => data.machines.filter((m) => !machine || m.id === machine),
    [data.machines, machine],
  );
  const last = data.latest.reduce(
    (max, r) => (r.recorded_at > max ? r.recorded_at : max),
    "",
  );
  const currentAvg = data.latest.length
    ? data.latest.reduce((sum, r) => sum + r.temperature, 0) /
      data.latest.length
    : null;
  const previousAverage = useMemo(() => {
    const previous = data.latest
      .map((current) =>
        data.readings
          .filter(
            (r) =>
              r.machine_id === current.machine_id &&
              r.event_id !== current.event_id,
          )
          .at(-1),
      )
      .filter(Boolean);
    return previous.length
      ? previous.reduce((sum, r) => sum + r.temperature, 0) / previous.length
      : null;
  }, [data.latest, data.readings]);
  const temperatureDelta =
    currentAvg !== null && previousAverage !== null
      ? currentAvg - previousAverage
      : null;
  const active = data.latest.filter(
    (r) =>
      r.status !== "offline" &&
      Date.now() - new Date(r.recorded_at) <
        (s?.stale_after_seconds || 15) * 1000,
  ).length;
  function navigate(next) {
    setView(next);
    setMenu(false);
  }
  function select(id) {
    setMachine(id);
    navigate("Machine Monitoring");
  }
  function theme() {
    setLight((v) => {
      localStorage.setItem("telemetryflow-theme", !v ? "light" : "dark");
      return !v;
    });
  }
  const recent = data.alerts.filter((a) => a.status === "active").slice(0, 3);
  const healthy =
    !!s?.database_connected &&
    s?.ingestion_online &&
    data.status === "live" &&
    !data.error;
  return (
    <div className={`app ${light ? "light" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-mark">
            <Activity size={25} />
          </span>
          <span>
            Telemetry<span className="brand-flow">Flow</span>
            <small>MONITORING PLATFORM</small>
          </span>
        </a>
        <button
          className="mobile-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        >
          <X />
        </button>
        <div className="workspace">
          <span className="workspace-icon">
            <Box size={18} />
          </span>
          <span>
            <strong>Industrial workspace</strong>
            <small>Development environment</small>
          </span>
          <ChevronsUpDown size={13} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {NAV.map(([name, Icon], i) => (
            <button
              key={name}
              aria-label={name}
              aria-current={view === name ? "page" : undefined}
              className={`nav-item ${view === name ? "selected" : ""} ${i === 6 ? "nav-settings" : ""}`}
              onClick={() => navigate(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Alerts & Events" && s?.active_alerts > 0 && (
                <b className="nav-count">{s.active_alerts}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="environment-card">
            <div>
              <span className={`dot ${healthy ? "" : "amber"}`} />
              <strong>
                {healthy ? "Pipeline operational" : "Checking pipeline"}
              </strong>
            </div>
            <p>Python → PostgreSQL → WebSocket</p>
            <button onClick={() => navigate("Pipeline Health")}>
              View pipeline health <ChevronRight size={14} />
            </button>
          </div>
          <div className="profile">
            <span className="avatar">TF</span>
            <span>
              <strong>Local workspace</strong>
              <small>Simulation environment</small>
            </span>
            <SettingsIcon size={16} />
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="menu-scrim"
          aria-label="Close navigation overlay"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="top-actions">
            <span
              className={`connection ${data.status === "live" ? "" : "disconnected"}`}
            >
              <span className="dot" />
              {data.status === "live"
                ? "Live connection"
                : data.status === "connecting"
                  ? "Connecting"
                  : "Reconnecting"}
            </span>
            <span className="top-divider" />
            <button
              className="icon-button notification-button"
              aria-label="View notifications"
              onClick={() => navigate("Alerts & Events")}
            >
              <Bell size={19} />
              {s?.active_alerts > 0 && <i />}
            </button>
            <button
              className="icon-button"
              onClick={theme}
              aria-label={light ? "Use dark theme" : "Use light theme"}
            >
              {light ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <span className="avatar small-avatar">TF</span>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-line" />
                TELEMETRYFLOW / OPERATIONS
              </div>
              <h1>{COPY[view][0]}</h1>
              <p>{COPY[view][1]}</p>
            </div>
            <div className="heading-actions">
              <span className="badge simulated">
                <span className="dot" />
                SIMULATED DATA
              </span>
              <button
                className="icon-button refresh"
                aria-label="Refresh dashboard"
                onClick={data.refresh}
              >
                <RefreshCw size={17} />
              </button>
            </div>
          </div>
          <div className="scope-bar">
            <div className="machine-select">
              <Cpu size={17} />
              <select
                aria-label="Global machine selector"
                value={machine}
                onChange={(e) => setMachine(e.target.value)}
              >
                <option value="">All machines</option>
                {data.machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="scope-location">
              Industrial workspace <span>/</span>{" "}
              {machine || `${data.machines.length} connected assets`}
            </span>
            <span className="last-updated">
              Last received <strong>{time(last)}</strong>
            </span>
          </div>
          {data.error && (
            <div role="alert" className="error-banner">
              <TriangleAlert size={17} />
              {data.error} <button onClick={data.refresh}>Retry</button>
            </div>
          )}
          {data.loading && (
            <div role="status" className="loading-banner">
              <RefreshCw size={16} className="spin" />
              Loading persisted telemetry…
            </div>
          )}
          {(view === "Overview" || view === "Live Telemetry") && (
            <>
              <div className="metrics-grid">
                <MetricCard
                  label="Monitored machines"
                  value={format(visibleMachines.length, 0)}
                  icon={Cpu}
                  detail={
                    machine
                      ? "Single machine selected"
                      : `${data.machines.length} registered assets`
                  }
                  tone="muted"
                />
                <MetricCard
                  label="Active machines"
                  value={format(active, 0)}
                  icon={Activity}
                  detail={
                    active === visibleMachines.length && active
                      ? "All systems reporting"
                      : `${visibleMachines.length - active} not reporting / offline`
                  }
                />
                <MetricCard
                  label="Average temperature"
                  value={format(currentAvg)}
                  unit="°C"
                  icon={Thermometer}
                  detail={
                    currentAvg === null
                      ? "Awaiting first reading"
                      : currentAvg >= 80
                        ? "Above warning threshold"
                        : temperatureDelta !== null
                          ? `${temperatureDelta >= 0 ? "+" : ""}${format(temperatureDelta, 1)} °C since prior sample`
                          : "Latest readings average"
                  }
                  tone={currentAvg >= 80 ? "amber" : "green"}
                />
                <MetricCard
                  label="Active alerts"
                  value={format(s?.active_alerts, 0)}
                  icon={Bell}
                  detail={
                    s?.active_alerts
                      ? "Fleet-wide · needs attention"
                      : "Fleet-wide · no active alerts"
                  }
                  tone={s?.active_alerts ? "amber" : "green"}
                />
                <MetricCard
                  label="Ingested records"
                  value={format(s?.successful_writes, 0)}
                  icon={Database}
                  detail={
                    s?.record_delta != null
                      ? `+${format(s.record_delta, 0)} records since last check`
                      : "Lifetime successful inserts"
                  }
                  tone="muted"
                />
                <MetricCard
                  label="Ingestion rate"
                  value={format(s?.ingestion_rate, 1)}
                  unit="/s"
                  icon={Zap}
                  detail="Measured over last 30 seconds"
                  tone="green"
                />
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Live telemetry{" "}
                    <span className="tag">
                      {visibleMachines.length}{" "}
                      {visibleMachines.length === 1 ? "machine" : "machines"}
                    </span>
                  </h2>
                  <p>
                    {data.paused
                      ? "Visualization paused · collection continues"
                      : "Streaming sensor readings from your connected equipment"}
                  </p>
                </div>
                <div className="chart-controls">
                  <div className="segmented">
                    {["15m", "1h", "6h"].map((v) => (
                      <button
                        key={v}
                        className={range === v ? "active" : ""}
                        onClick={() => setRange(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => data.setPaused((v) => !v)}>
                    {data.paused ? <Play size={14} /> : <Pause size={14} />}
                    <span>{data.paused ? "Resume" : "Pause"}</span>
                  </button>
                </div>
              </div>
              <div className="charts-grid">
                {[
                  "temperature",
                  "pressure",
                  ...(view === "Live Telemetry" ? ["vibration", "power"] : []),
                ].map((metric) => (
                  <TelemetryChart
                    key={metric}
                    readings={data.readings}
                    machines={visibleMachines}
                    metric={metric}
                    thresholds={data.thresholds}
                    live={!data.paused}
                  />
                ))}
              </div>
              {view === "Overview" && (
                <>
                  <section className="panel machine-panel">
                    <div className="panel-heading">
                      <h3>
                        Machine status{" "}
                        <span className="count-pill">
                          {visibleMachines.length}
                        </span>
                      </h3>
                      <button
                        className="text-button"
                        onClick={() => navigate("Machine Monitoring")}
                      >
                        View all machines <ChevronRight size={14} />
                      </button>
                    </div>
                    <Machines
                      machines={visibleMachines}
                      latest={data.latest}
                      onSelect={select}
                      staleSeconds={s?.stale_after_seconds || 15}
                    />
                  </section>
                  <div className="bottom-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h3>
                          <Bell size={16} />
                          Recent alerts
                        </h3>
                        <button
                          className="text-button"
                          onClick={() => navigate("Alerts & Events")}
                        >
                          View all <ChevronRight size={14} />
                        </button>
                      </div>
                      {recent.length ? (
                        recent.map((a) => (
                          <button
                            className="recent-alert"
                            key={a.id}
                            onClick={() => navigate("Alerts & Events")}
                          >
                            <span className={`alert-icon ${a.severity}`}>
                              <TriangleAlert size={16} />
                            </span>
                            <span>
                              <strong>
                                {a.metric === "status"
                                  ? "Equipment failure"
                                  : `${a.metric} threshold exceeded`}
                              </strong>
                              <small>
                                {a.machine_id} · {time(a.created_at)}
                              </small>
                            </span>
                            <Status value={a.severity} />
                          </button>
                        ))
                      ) : (
                        <div className="quiet-state">
                          <span className="dot" />
                          No active alerts. Your thresholds are being monitored.
                        </div>
                      )}
                    </section>
                    <section className="panel pipeline-summary">
                      <div className="panel-heading">
                        <h3>
                          <Workflow size={17} />
                          Ingestion pipeline
                        </h3>
                        <span
                          className={`badge ${healthy ? "running" : "stale"}`}
                        >
                          {healthy ? "Healthy" : "Checking"}
                        </span>
                      </div>
                      <div className="mini-pipeline">
                        <span>
                          <Box size={19} />
                          Collect
                        </span>
                        <i />
                        <span>
                          <Database size={19} />
                          Persist
                        </span>
                        <i />
                        <span>
                          <Radio size={19} />
                          Stream
                        </span>
                      </div>
                      <div className="pipeline-foot">
                        <span>
                          Record → database{" "}
                          <strong>
                            {s?.ingestion_latency_ms < 0
                              ? "Clock skew"
                              : `${format(s?.ingestion_latency_ms, 1)} ms`}
                          </strong>
                        </span>
                        <span>
                          Clients{" "}
                          <strong>{format(s?.connected_clients, 0)}</strong>
                        </span>
                      </div>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          {view === "Machine Monitoring" && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <h3>
                    {machine ? visibleMachines[0]?.name : "Fleet inventory"}
                  </h3>
                  {machine && (
                    <button onClick={() => setMachine("")}>All machines</button>
                  )}
                </div>
                <Machines
                  machines={visibleMachines}
                  latest={data.latest}
                  onSelect={select}
                  staleSeconds={s?.stale_after_seconds || 15}
                />
              </section>
              {machine && (
                <>
                  <div className="charts-grid">
                    {["temperature", "pressure", "vibration", "power"].map(
                      (metric) => (
                        <TelemetryChart
                          key={metric}
                          metric={metric}
                          readings={data.readings}
                          machines={visibleMachines}
                          thresholds={data.thresholds}
                        />
                      ),
                    )}
                  </div>
                  <button
                    className="primary"
                    onClick={() => navigate("Historical Analytics")}
                  >
                    Explore complete machine history
                  </button>
                </>
              )}
              <Simulation
                key={machine}
                selected={machine}
                machines={data.machines}
                token={token}
                onChange={data.refresh}
              />
            </>
          )}
          {view === "Historical Analytics" && (
            <History machine={machine} machines={visibleMachines} />
          )}
          {view === "Alerts & Events" && (
            <Alerts
              machine={machine}
              token={token}
              refreshKey={data.alerts
                .map((a) => `${a.id}:${a.status}`)
                .join(",")}
              onChange={() => {}}
            />
          )}
          {view === "Pipeline Health" && (
            <Pipeline
              stats={data.error ? null : s}
              status={data.status}
              deliveryLatency={data.deliveryLatency}
            />
          )}
          {view === "Settings" && (
            <Settings token={token} setToken={setToken} data={data} />
          )}
          <footer>
            <span>
              <span className={`dot ${healthy ? "" : "amber"}`} />
              {healthy
                ? "All services operational"
                : "Monitoring service connectivity"}
            </span>
            <span>
              TelemetryFlow <span className="footer-divider">/</span> Real-Time
              Monitoring Platform <span className="version">v1.0</span>
            </span>
            <button
              className="text-button"
              onClick={() => navigate("Pipeline Health")}
            >
              <CircleHelp size={14} />
              System information
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}
