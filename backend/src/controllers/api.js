import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { parseQuery, id, fail } from "../middleware/validation.js";
import { latest, history, summary, stats } from "../services/telemetry.js";
import { config } from "../config/index.js";

export function controllers(db, runtime) {
  const readAlerts = async (q) => {
    const values = [],
      conditions = [];
    for (const key of ["machine_id", "severity", "status"])
      if (q[key]) {
        values.push(q[key]);
        conditions.push(`${key}=$${values.length}`);
      }
    if (q.cursor) {
      values.push(q.cursor);
      conditions.push(`id<$${values.length}`);
    }
    values.push(q.limit + 1);
    const { rows } = await db.query(
      `SELECT * FROM alerts ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY id DESC LIMIT $${values.length}`,
      values,
    );
    return {
      data: rows.slice(0, q.limit),
      next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
    };
  };
  return {
    health: async (req, res) => {
      await db.query("SELECT id FROM ingestion_health WHERE id=1");
      res.json({ data: { status: "ready", database: true } });
    },
    machines: async (req, res) =>
      res.json({
        data: (
          await db.query(
            "SELECT m.*,s.scenario FROM machines m JOIN simulation_controls s ON s.machine_id=m.id ORDER BY m.id",
          )
        ).rows,
      }),
    machine: async (req, res) => {
      const machine = id.parse(req.params.id);
      const { rows } = await db.query("SELECT * FROM machines WHERE id=$1", [
        machine,
      ]);
      if (!rows[0]) throw fail(404, "Machine not found");
      res.json({
        data: { ...rows[0], latest: (await latest(db, machine))[0] || null },
      });
    },
    latest: async (req, res) =>
      res.json({ data: await latest(db, parseQuery(req).machine_id) }),
    history: async (req, res) => res.json(await history(db, parseQuery(req))),
    summary: async (req, res) => res.json(await summary(db, parseQuery(req))),
    alerts: async (req, res) => res.json(await readAlerts(parseQuery(req))),
    acknowledge: async (req, res) => {
      const alertId = z
        .string()
        .regex(/^\d{1,18}$/)
        .parse(req.params.id);
      const { rows } = await db.query(
        "UPDATE alerts SET status='acknowledged', acknowledged_at=COALESCE(acknowledged_at,now()) WHERE id=$1 RETURNING *",
        [alertId],
      );
      if (!rows[0]) throw fail(404, "Alert not found");
      runtime.broadcast(
        { type: "alert_acknowledged", data: rows[0] },
        rows[0].machine_id,
      );
      res.json({ data: rows[0] });
    },
    stats: async (req, res) =>
      res.json({ data: await stats(db, runtime.clients()) }),
    bootstrap: async (req, res) => {
      const q = parseQuery(req);
      const client = await db.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const cursor = (
          await client.query(
            "SELECT COALESCE(max(id),0)::text AS cursor FROM telemetry",
          )
        ).rows[0].cursor;
        const readings = await history(client, {
          ...q,
          limit: 1000,
          cursor: undefined,
        });
        const machines = (
          await client.query(
            "SELECT m.*,s.scenario FROM machines m JOIN simulation_controls s ON m.id=s.machine_id ORDER BY m.id",
          )
        ).rows;
        const current = await latest(client, q.machine_id);
        const thresholds = (
          await client.query("SELECT * FROM thresholds ORDER BY metric")
        ).rows;
        await client.query("COMMIT");
        res.json({
          data: {
            cursor,
            readings: readings.data,
            latest: current,
            machines,
            thresholds,
          },
        });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    thresholds: async (req, res) =>
      res.json({
        data: (await db.query("SELECT * FROM thresholds ORDER BY metric")).rows,
      }),
    updateThreshold: async (req, res) => {
      const body = z
        .object({
          warning: z.number().positive().max(1000),
          critical: z.number().positive().max(1000),
          cooldown_seconds: z.number().int().min(5).max(3600),
        })
        .refine((v) => v.critical > v.warning)
        .parse(req.body);
      const metric = z
        .enum(["temperature", "pressure", "vibration", "power"])
        .parse(req.params.metric);
      const { rows } = await db.query(
        "UPDATE thresholds SET warning=$1,critical=$2,cooldown_seconds=$3 WHERE metric=$4 RETURNING *",
        [body.warning, body.critical, body.cooldown_seconds, metric],
      );
      res.json({ data: rows[0] });
    },
    simulate: async (req, res) => {
      const body = z
        .object({
          machine_id: id,
          scenario: z.enum([
            "normal",
            "temperature_spike",
            "excessive_vibration",
            "pressure_anomaly",
            "machine_failure",
          ]),
        })
        .parse(req.body);
      const { rows } = await db.query(
        "UPDATE simulation_controls SET scenario=$1,updated_at=now() WHERE machine_id=$2 RETURNING *",
        [body.scenario, body.machine_id],
      );
      if (!rows[0]) throw fail(404, "Machine not found");
      res.json({ data: rows[0] });
    },
    admin: (req, res, next) => {
      const supplied = Buffer.from(
        req.headers.authorization?.replace(/^Bearer /, "") || "",
      );
      const expected = Buffer.from(config.adminToken || "");
      if (
        !expected.length ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        return next(fail(401, "A valid control token is required"));
      next();
    },
  };
}
