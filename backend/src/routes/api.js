import { Router } from "express";
import { controllers } from "../controllers/api.js";
export function routes(db, runtime) {
  const r = Router(),
    c = controllers(db, runtime);
  r.get("/health", c.health);
  r.get("/ready", c.health);
  r.get("/bootstrap", c.bootstrap);
  r.get("/machines", c.machines);
  r.get("/machines/:id", c.machine);
  r.get("/telemetry/latest", c.latest);
  r.get("/telemetry/history", c.history);
  r.get("/telemetry/summary", c.summary);
  r.get("/alerts", c.alerts);
  r.patch("/alerts/:id/acknowledge", c.admin, c.acknowledge);
  r.get("/system/stats", c.stats);
  r.get("/thresholds", c.thresholds);
  r.patch("/thresholds/:metric", c.admin, c.updateThreshold);
  r.post("/simulation", c.admin, c.simulate);
  return r;
}
