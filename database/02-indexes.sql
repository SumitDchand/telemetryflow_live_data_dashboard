CREATE INDEX telemetry_machine_time_idx ON telemetry(machine_id, recorded_at DESC, id DESC);
CREATE INDEX telemetry_time_idx ON telemetry(recorded_at DESC, id DESC);
CREATE INDEX telemetry_ingested_idx ON telemetry(ingested_at DESC);
CREATE INDEX alerts_cooldown_idx ON alerts(machine_id, metric, severity, created_at DESC);
CREATE INDEX alerts_status_idx ON alerts(status, id DESC);
