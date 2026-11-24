import http from "node:http";
import { createApp } from "./app.js";
import { pool } from "./database/pool.js";
import { Hub } from "./websocket/hub.js";
import { listen } from "./services/listener.js";
import { config } from "./config/index.js";
if (!config.databaseUrl) throw new Error("DATABASE_URL is required");
let hub;
const runtime = {
  clients: () => hub?.clients() || 0,
  broadcast: (...args) => hub?.broadcast(...args),
};
const server = http.createServer(createApp(pool, runtime));
hub = new Hub(server, pool);
const stopListener = listen(() => hub.wake());
server.listen(config.port, config.host, () =>
  console.log(
    JSON.stringify({
      event: "listening",
      host: config.host,
      port: config.port,
    }),
  ),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    for (const ws of hub.wss.clients) ws.terminate();
    process.exit(1);
  }, 10000);
  deadline.unref();
  hub.close();
  const drained = new Promise((resolve) => server.close(resolve));
  await stopListener();
  await drained;
  await pool.end();
  clearTimeout(deadline);
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
