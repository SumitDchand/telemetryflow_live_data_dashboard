import { useEffect, useRef, useState } from "react";
import { api, params } from "../services/api";
export function mergeReadings(previous, incoming, limit = 1500) {
  const map = new Map(previous.map((r) => [r.event_id, r]));
  incoming.forEach((r) => map.set(r.event_id, r));
  return [...map.values()]
    .sort(
      (a, b) =>
        new Date(a.recorded_at) - new Date(b.recorded_at) ||
        Number(BigInt(a.id) - BigInt(b.id)),
    )
    .slice(-limit);
}
export function reconnectDelay(attempt) {
  return Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
}
export function useTelemetry(machine, range) {
  const [data, setData] = useState({
    readings: [],
    latest: [],
    machines: [],
    thresholds: [],
  });
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [paused, setPaused] = useState(false);
  const [deliveryLatency, setDeliveryLatency] = useState(null);
  const deliveryRef = useRef(null);
  const pausedRef = useRef(false),
    buffer = useRef([]),
    latestRef = useRef([]),
    snapshot = useRef(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused)
      setData((d) => ({
        ...d,
        readings: buffer.current,
        latest: latestRef.current,
      }));
  }, [paused]);
  useEffect(() => {
    let stopped = false,
      ws,
      timer,
      attempt = 0,
      cursor = "0",
      refreshBusy = false;
    setLoading(true);
    setError("");
    setStatus("connecting");
    buffer.current = [];
    latestRef.current = [];
    deliveryRef.current = null;
    setDeliveryLatency(null);
    async function refresh() {
      if (refreshBusy) return;
      refreshBusy = true;
      try {
        const [s, a] = await Promise.all([
          api("/system/stats"),
          api(`/alerts?${params({ machine_id: machine, limit: 100 })}`),
        ]);
        if (!stopped) {
          setStats((previous) => ({
            ...s.data,
            record_delta: previous
              ? Number(s.data.successful_writes) -
                Number(previous.successful_writes)
              : null,
          }));
          setAlerts(a.data);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        refreshBusy = false;
      }
    }
    async function boot() {
      try {
        const { data: initial } = await api(
          `/bootstrap?${params({ machine_id: machine, range })}`,
        );
        if (stopped) return;
        cursor = initial.cursor;
        buffer.current = mergeReadings([], initial.readings);
        latestRef.current = initial.latest;
        snapshot.current = initial;
        setData({ ...initial, readings: buffer.current });
        setLoading(false);
        setError("");
        connect();
        refresh();
      } catch (e) {
        if (!stopped) {
          setError(e.message);
          setLoading(false);
          setStatus("reconnecting");
          timer = setTimeout(boot, reconnectDelay(attempt++));
        }
      }
    }
    function connect() {
      if (stopped) return;
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      ws.onopen = () => {
        if (stopped) return;
        attempt = 0;
        setStatus("live");
        setError("");
        ws.send(
          JSON.stringify({
            type: "subscribe",
            cursor,
            machine_id: machine || null,
          }),
        );
        refresh();
      };
      ws.onmessage = (event) => {
        if (stopped) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "telemetry_update") {
          if (message.data.length) {
            deliveryRef.current =
              Date.now() -
              Math.max(
                ...message.data.map((r) => new Date(r.recorded_at).getTime()),
              );
          }
          buffer.current = mergeReadings(buffer.current, message.data);
          const map = new Map(latestRef.current.map((r) => [r.machine_id, r]));
          for (const r of message.data) {
            const previous = map.get(r.machine_id);
            if (
              !previous ||
              new Date(r.recorded_at) >= new Date(previous.recorded_at)
            )
              map.set(r.machine_id, r);
          }
          latestRef.current = [...map.values()];
          cursor = message.cursor;
        }
        if (
          message.type === "alert_triggered" ||
          message.type === "alert_acknowledged"
        )
          refresh();
        if (
          message.type === "system_status" &&
          !message.data.database_connected
        )
          setError("Database unavailable. Reconnecting automatically.");
      };
      ws.onclose = () => {
        if (!stopped) {
          setStatus("reconnecting");
          timer = setTimeout(
            connect,
            reconnectDelay(attempt++) + Math.random() * 250,
          );
        }
      };
      ws.onerror = () => ws.close();
    }
    boot();
    const flush = setInterval(() => {
      setDeliveryLatency(deliveryRef.current);
      if (!pausedRef.current)
        setData((d) => ({
          ...d,
          readings: buffer.current,
          latest: latestRef.current,
        }));
    }, 500);
    const poll = setInterval(refresh, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(flush);
      clearInterval(poll);
      ws?.close();
    };
  }, [machine, range, revision]);
  return {
    ...data,
    status,
    error,
    loading,
    stats,
    deliveryLatency,
    alerts,
    paused,
    setPaused,
    refresh: () => setRevision((v) => v + 1),
    setAlerts,
  };
}
