import { memo, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Activity, Thermometer, Gauge, Zap } from "lucide-react";
export const COLORS = ["#2dd4bf", "#749bff", "#c49aff", "#f6bd6b", "#ee8fab"];
export const METRICS = {
  temperature: { label: "Temperature", unit: "°C", icon: Thermometer },
  pressure: { label: "Pressure", unit: "bar", icon: Gauge },
  vibration: { label: "Vibration", unit: "mm/s", icon: Activity },
  power: { label: "Power consumption", unit: "kW", icon: Zap },
};
export const TelemetryChart = memo(function TelemetryChart({
  readings,
  machines,
  metric,
  thresholds = [],
  compact = false,
  live = true,
}) {
  const spec = METRICS[metric];
  const Icon = spec.icon;
  const points = useMemo(() => {
    const bins = new Map();
    for (const r of readings) {
      const stamp = Math.floor(new Date(r.recorded_at).getTime() / 2000) * 2000;
      if (!bins.has(stamp)) bins.set(stamp, { time: stamp });
      bins.get(stamp)[r.machine_id] = r[metric];
    }
    const all = [...bins.values()].sort((a, b) => a.time - b.time);
    const step = Math.max(1, Math.ceil(all.length / 180));
    return all.filter((_, i) => i % step === 0 || i === all.length - 1);
  }, [readings, metric]);
  const threshold = thresholds.find((t) => t.metric === metric);
  return (
    <section className={`panel chart-panel ${compact ? "compact" : ""}`}>
      <div className="panel-heading">
        <h3>
          <Icon size={17} />
          {spec.label}
          <span className="unit">{spec.unit}</span>
        </h3>
        {live && (
          <span className="live-label">
            <span className="dot" />
            LIVE
          </span>
        )}
      </div>
      {points.length ? (
        <div className="chart-canvas">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 16, right: 22, bottom: 0, left: -20 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 5"
                vertical={false}
              />
              <XAxis
                dataKey="time"
                tickFormatter={(v) =>
                  new Date(v).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    ...(points.length &&
                    points.at(-1).time - points[0].time < 300000
                      ? { second: "2-digit" }
                      : {}),
                  })
                }
                minTickGap={55}
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text)",
                }}
                labelFormatter={(v) => new Date(v).toLocaleTimeString()}
                formatter={(v, n) => [
                  `${Number(v).toFixed(2)} ${spec.unit}`,
                  n,
                ]}
              />
              {threshold && (
                <ReferenceLine
                  ifOverflow="extendDomain"
                  y={threshold.warning}
                  stroke="#ae8547"
                  strokeDasharray="5 5"
                  label={{
                    value: `Warning ${threshold.warning}`,
                    position: "insideTopRight",
                    fill: "#bc985f",
                    fontSize: 11,
                  }}
                />
              )}
              {machines.map((m, i) => (
                <Line
                  key={m.id}
                  name={m.name}
                  type="monotone"
                  dataKey={m.id}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="empty chart-empty">Waiting for persisted telemetry</div>
      )}
      <div className="chart-legend">
        {machines.map((m, i) => (
          <span key={m.id}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            {m.name}
          </span>
        ))}
      </div>
    </section>
  );
});
