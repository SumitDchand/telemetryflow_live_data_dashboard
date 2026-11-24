CREATE TABLE machines (
 id text PRIMARY KEY, name text NOT NULL, type text NOT NULL, location text NOT NULL,
 registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telemetry (
 id bigserial PRIMARY KEY, event_id uuid NOT NULL UNIQUE,
 machine_id text NOT NULL REFERENCES machines(id), sensor_id text NOT NULL,
 temperature double precision NOT NULL CHECK(temperature BETWEEN -50 AND 250),
 pressure double precision NOT NULL CHECK(pressure BETWEEN 0 AND 50),
 vibration double precision NOT NULL CHECK(vibration BETWEEN 0 AND 100),
 power double precision NOT NULL CHECK(power BETWEEN 0 AND 1000),
 status text NOT NULL CHECK(status IN ('running','warning','critical','offline')),
 recorded_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE thresholds (
 metric text PRIMARY KEY CHECK(metric IN ('temperature','pressure','vibration','power')),
 warning double precision NOT NULL, critical double precision NOT NULL,
 cooldown_seconds integer NOT NULL DEFAULT 60 CHECK(cooldown_seconds BETWEEN 5 AND 3600),
 CHECK(warning > 0 AND critical > warning)
);
CREATE TABLE alerts (
 id bigserial PRIMARY KEY, machine_id text NOT NULL REFERENCES machines(id),
 reading_id bigint REFERENCES telemetry(id) ON DELETE SET NULL,
 metric text NOT NULL, observed_value double precision NOT NULL, threshold_value double precision NOT NULL,
 severity text NOT NULL CHECK(severity IN ('warning','critical')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','acknowledged')),
 created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz
);
CREATE TABLE simulation_controls (
 machine_id text PRIMARY KEY REFERENCES machines(id),
 scenario text NOT NULL DEFAULT 'normal' CHECK(scenario IN ('normal','temperature_spike','excessive_vibration','pressure_anomaly','machine_failure')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ingestion_health (
 id integer PRIMARY KEY CHECK(id=1), heartbeat_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz,
 successful_writes bigint NOT NULL DEFAULT 0, failed_attempts bigint NOT NULL DEFAULT 0,
 dropped_readings bigint NOT NULL DEFAULT 0, buffered_readings integer NOT NULL DEFAULT 0,
 last_batch_ms double precision NOT NULL DEFAULT 0
);
CREATE FUNCTION detect_alerts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t record; val double precision; sev text; threshold double precision;
BEGIN
 FOR t IN SELECT * FROM thresholds LOOP
  val := (to_jsonb(NEW)->>t.metric)::double precision;
  IF val >= t.warning THEN
   sev := CASE WHEN val >= t.critical THEN 'critical' ELSE 'warning' END;
   threshold := CASE WHEN sev='critical' THEN t.critical ELSE t.warning END;
   IF NOT EXISTS (SELECT 1 FROM alerts WHERE machine_id=NEW.machine_id AND metric=t.metric AND severity=sev
      AND created_at > now() - make_interval(secs=>t.cooldown_seconds)) THEN
    INSERT INTO alerts(machine_id,reading_id,metric,observed_value,threshold_value,severity)
    VALUES(NEW.machine_id,NEW.id,t.metric,val,threshold,sev);
   END IF;
  END IF;
 END LOOP;
 IF NEW.status='offline' AND NOT EXISTS(SELECT 1 FROM alerts WHERE machine_id=NEW.machine_id AND metric='status' AND created_at>now()-interval '60 seconds') THEN
  INSERT INTO alerts(machine_id,reading_id,metric,observed_value,threshold_value,severity) VALUES(NEW.machine_id,NEW.id,'status',0,1,'critical');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER telemetry_alerts AFTER INSERT ON telemetry FOR EACH ROW EXECUTE FUNCTION detect_alerts();
