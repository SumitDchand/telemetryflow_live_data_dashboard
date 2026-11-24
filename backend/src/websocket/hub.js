import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { config } from "../config/index.js";
const subscription = z.object({
  type: z.literal("subscribe"),
  cursor: z.string().regex(/^\d{1,18}$/),
  machine_id: z
    .string()
    .regex(/^MCH-\d{3}$/)
    .nullable()
    .optional(),
});
export class Hub {
  constructor(server, db) {
    this.db = db;
    this.closed = false;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 2048,
      perMessageDeflate: false,
    });
    server.on("upgrade", (req, socket, head) => {
      if (
        req.url !== "/ws" ||
        !config.origins.includes(req.headers.origin) ||
        this.wss.clients.size >= 50
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) =>
        this.wss.emit("connection", ws),
      );
    });
    this.wss.on("connection", (ws) => {
      ws.alive = true;
      ws.cursor = null;
      ws.busy = false;
      ws.machine = null;
      ws.subscribed = false;
      ws.on("pong", () => (ws.alive = true));
      ws.on("error", () => {});
      this.send(ws, {
        type: "connection_established",
        data: { protocol: 1, recovery: "database_cursor" },
      });
      ws.on("message", async (raw) => {
        try {
          if (ws.subscribed) throw new Error("Already subscribed");
          const msg = subscription.parse(JSON.parse(raw));
          ws.subscribed = true;
          ws.cursor = msg.cursor;
          ws.machine = msg.machine_id || null;
          await this.pump(ws);
        } catch {
          this.send(ws, {
            type: "error",
            data: { message: "Invalid subscription" },
          });
          ws.close(1008, "Invalid subscription");
        }
      });
    });
    this.poll = setInterval(() => this.wake(), 2000);
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!ws.alive) {
          ws.terminate();
          continue;
        }
        ws.alive = false;
        ws.ping();
      }
    }, 15000);
  }
  send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.close(1013, "Client too slow; reconnect to recover");
      return false;
    }
    ws.send(JSON.stringify(message));
    return true;
  }
  async pump(ws) {
    if (ws.busy || ws.cursor === null || this.closed) return;
    ws.busy = true;
    try {
      // Bound work per wake; the next poll continues catch-up without starving peers.
      for (
        let page = 0;
        page < 10 && ws.readyState === WebSocket.OPEN;
        page++
      ) {
        const { rows } = await this.db.query(
          "SELECT * FROM telemetry WHERE id>$1 ORDER BY id LIMIT 500",
          [ws.cursor],
        );
        if (!rows.length) break;
        const cursor = rows.at(-1).id;
        const data = ws.machine
          ? rows.filter((r) => r.machine_id === ws.machine)
          : rows;
        const alerts = await this.db.query(
          "SELECT * FROM alerts WHERE reading_id=ANY($1::bigint[]) ORDER BY id",
          [data.map((r) => r.id)],
        );
        if (
          !this.send(ws, {
            type: "telemetry_update",
            cursor,
            data,
            sent_at: new Date().toISOString(),
          })
        )
          break;
        if (alerts.rows.length)
          this.send(ws, { type: "alert_triggered", data: alerts.rows });
        ws.cursor = cursor;
        if (rows.length < 500) break;
      }
    } catch {
      this.send(ws, {
        type: "system_status",
        data: { database_connected: false },
      });
    } finally {
      ws.busy = false;
    }
  }
  wake() {
    for (const ws of this.wss.clients) this.pump(ws);
  }
  clients() {
    return this.wss.clients.size;
  }
  broadcast(message, machine) {
    for (const ws of this.wss.clients)
      if (!machine || !ws.machine || ws.machine === machine)
        this.send(ws, message);
  }
  close() {
    this.closed = true;
    clearInterval(this.poll);
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.close(1001, "Server shutting down");
    this.wss.close();
  }
}
