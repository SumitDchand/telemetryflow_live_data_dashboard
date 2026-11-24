import { WebSocket } from "ws";
import { writeFile } from "node:fs/promises";
const base = process.env.API_URL || "http://127.0.0.1:3001";
const duration = Number(process.env.BENCHMARK_SECONDS || 30);
const origin = process.env.WS_ORIGIN || "http://127.0.0.1:5173";
const initial = await fetch(`${base}/api/bootstrap`).then((r) => r.json());
const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { origin });
const delivery = [],
  broadcast = [];
let records = 0,
  messages = 0;
const started = Date.now();
await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => {
    ws.close();
    resolve();
  }, duration * 1000);
  ws.on("open", () =>
    ws.send(JSON.stringify({ type: "subscribe", cursor: initial.data.cursor })),
  );
  ws.on("error", (e) => {
    clearTimeout(deadline);
    reject(e);
  });
  ws.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.type !== "telemetry_update") return;
    const now = Date.now();
    messages++;
    for (const r of message.data) {
      records++;
      delivery.push(now - new Date(r.recorded_at));
    }
    broadcast.push(now - new Date(message.sent_at));
  });
});
function stats(list) {
  list.sort((a, b) => a - b);
  return {
    samples: list.length,
    median_ms: list[Math.floor(list.length / 2)],
    p95_ms: list[Math.max(0, Math.ceil(list.length * 0.95) - 1)],
  };
}
const result = {
  date: new Date().toISOString(),
  duration_seconds: (Date.now() - started) / 1000,
  records,
  messages,
  generation_to_ws_client: stats(delivery),
  server_send_to_ws_client: stats(broadcast),
  note: "Local Node WebSocket client receipt, not browser paint. Wall-clock metrics require synchronized hosts. No replay included.",
};
await writeFile(
  "docs/stream-benchmark-results.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
