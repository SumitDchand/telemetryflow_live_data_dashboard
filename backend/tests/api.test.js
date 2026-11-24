import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { Hub } from "../src/websocket/hub.js";
import { querySchema } from "../src/middleware/validation.js";
import { config } from "../src/config/index.js";

describe("validation and safe errors", () => {
  it("rejects unbounded and invalid queries", () => {
    for (const q of [
      { limit: 1001 },
      { machine_id: "' OR 1=1" },
      { metric: "password" },
      { cursor: "-1" },
      { start: "2026-02-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    ])
      expect(querySchema.safeParse(q).success).toBe(false);
  });
  it("returns a safe database error", async () => {
    const app = createApp({
      query: () => {
        throw new Error("secret connection details");
      },
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.text).not.toContain("secret");
  });
  it("blocks untrusted origins", async () => {
    const res = await request(createApp({}))
      .get("/api/health")
      .set("Origin", "https://evil.invalid");
    expect(res.status).toBe(403);
  });
  it("requires a control token", async () => {
    const res = await request(createApp({})).post("/api/simulation").send({});
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "PostgreSQL REST and WebSocket integration",
  () => {
    let db, admin, app, hub, server, port;
    const schema = `test_node_${randomUUID().replaceAll("-", "")}`;
    beforeAll(async () => {
      admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      await admin.query(`CREATE SCHEMA ${schema}`);
      db = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path=${schema}`,
      });
      for (const file of ["01-schema.sql", "02-indexes.sql", "03-seed.sql"])
        await db.query(
          readFileSync(
            new URL(`../../database/${file}`, import.meta.url),
            "utf8",
          ),
        );
      app = createApp(db, {
        clients: () => hub?.clients() || 0,
        broadcast: (...args) => hub?.broadcast(...args),
      });
      server = createServer(app);
      hub = new Hub(server, db);
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      port = server.address().port;
      config.adminToken = "test-control-token";
      await insert("MCH-001", 55);
      await insert("MCH-002", 100);
    });
    afterAll(async () => {
      hub?.close();
      await new Promise((r) => server?.close(r));
      await db?.end();
      await admin?.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin?.end();
    });
    async function insert(machine, temp) {
      return (
        await db.query(
          `INSERT INTO telemetry(event_id,machine_id,sensor_id,temperature,pressure,vibration,power,status,recorded_at) VALUES($1,$2,'S01',$3,5,2,30,'running',now()) RETURNING *`,
          [randomUUID(), machine, temp],
        )
      ).rows[0];
    }
    function receive(ws, predicate) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off("message", on);
          reject(new Error("WebSocket timeout"));
        }, 6000);
        function on(raw) {
          const m = JSON.parse(raw);
          if (predicate(m)) {
            clearTimeout(timer);
            ws.off("message", on);
            resolve(m);
          }
        }
        ws.on("message", on);
      });
    }
    async function client(cursor = "0", machine = null) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: config.origins[0],
      });
      await new Promise((r) => ws.once("open", r));
      const event = receive(ws, (m) => m.type === "telemetry_update");
      ws.send(
        JSON.stringify({ type: "subscribe", cursor, machine_id: machine }),
      );
      return { ws, event };
    }
    it("reports healthy database and actual machines", async () => {
      expect((await request(app).get("/api/health")).status).toBe(200);
      expect((await request(app).get("/api/machines")).body.data).toHaveLength(
        5,
      );
    });
    it("filters history, bounds pages and returns a cursor", async () => {
      const res = await request(app).get(
        "/api/telemetry/history?machine_id=MCH-002&limit=1",
      );
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].machine_id).toBe("MCH-002");
      expect(
        (await request(app).get("/api/telemetry/history?limit=1001")).status,
      ).toBe(400);
    });
    it("returns bootstrap snapshot and aggregation", async () => {
      const b = await request(app).get("/api/bootstrap");
      expect(b.body.data.readings).toHaveLength(2);
      expect(b.body.data.cursor).toBe("2");
      const s = await request(app).get(
        "/api/telemetry/summary?metric=temperature",
      );
      expect(s.body.aggregate.avg).toBe(77.5);
    });
    it("creates alerts transactionally and acknowledges idempotently", async () => {
      const alerts = (await request(app).get("/api/alerts?severity=critical"))
        .body.data;
      expect(alerts).toHaveLength(1);
      for (let i = 0; i < 2; i++) {
        const r = await request(app)
          .patch(`/api/alerts/${alerts[0].id}/acknowledge`)
          .set("Authorization", "Bearer test-control-token");
        expect(r.body.data.status).toBe("acknowledged");
      }
    });
    it("persists simulation and threshold settings", async () => {
      expect(
        (
          await request(app)
            .post("/api/simulation")
            .set("Authorization", "Bearer test-control-token")
            .send({ machine_id: "MCH-001", scenario: "machine_failure" })
        ).body.data.scenario,
      ).toBe("machine_failure");
      expect(
        (
          await request(app)
            .patch("/api/thresholds/temperature")
            .set("Authorization", "Bearer test-control-token")
            .send({ warning: 80, critical: 70, cooldown_seconds: 60 })
        ).status,
      ).toBe(400);
    });
    it("streams to multiple clients with machine filtering", async () => {
      const a = await client(),
        b = await client("0", "MCH-002");
      const [ea, eb] = await Promise.all([a.event, b.event]);
      expect(ea.data.length).toBeGreaterThanOrEqual(2);
      expect(eb.data.every((r) => r.machine_id === "MCH-002")).toBe(true);
      a.ws.close();
      b.ws.close();
    });
    it("recovers missed notifications and reconnects from the last cursor", async () => {
      const a = await client();
      const first = await a.event;
      const previous = first.cursor;
      a.ws.close();
      const row = await insert("MCH-001", 60);
      const b = await client(previous);
      const recovered = await b.event;
      expect(recovered.data.map((r) => r.id)).toContain(row.id);
      expect(recovered.data.every((r) => BigInt(r.id) > BigInt(previous))).toBe(
        true,
      );
      const event = receive(b.ws, (m) => m.type === "telemetry_update");
      const missed = await insert("MCH-001", 61);
      expect((await event).data.map((r) => r.id)).toContain(missed.id);
      b.ws.close();
    });
    it("rejects invalid subscriptions", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        origin: config.origins[0],
      });
      await new Promise((r) => ws.once("open", r));
      const err = receive(ws, (m) => m.type === "error");
      ws.send(JSON.stringify({ type: "subscribe", cursor: "bad" }));
      expect((await err).data.message).toBe("Invalid subscription");
      ws.close();
    });
  },
);
