-- Run interactively; this file is not part of database initialization.
-- Latest observation per machine (event time, then ingestion ID).
SELECT DISTINCT ON(machine_id) * FROM telemetry
ORDER BY machine_id, recorded_at DESC, id DESC;

-- History: replace literals with parameters in application code.
SELECT * FROM telemetry WHERE machine_id='MCH-001'
 AND recorded_at >= now()-interval '1 hour'
ORDER BY recorded_at DESC LIMIT 100;

SELECT machine_id, avg(temperature),min(temperature),max(temperature)
FROM telemetry WHERE recorded_at>now()-interval '1 day' GROUP BY machine_id;

SELECT date_trunc('hour',recorded_at) AS hour,machine_id,avg(temperature),avg(power),count(*)
FROM telemetry WHERE recorded_at>now()-interval '7 days'
GROUP BY hour,machine_id ORDER BY hour DESC;

SELECT count(*) AS active_machines FROM (
 SELECT DISTINCT ON(machine_id) status,recorded_at FROM telemetry
 ORDER BY machine_id,recorded_at DESC,id DESC
) latest WHERE status<>'offline' AND recorded_at>now()-interval '15 seconds';

SELECT t.* FROM telemetry t JOIN thresholds th ON th.metric='temperature'
WHERE t.temperature>=th.warning AND t.recorded_at>now()-interval '1 hour';

SELECT * FROM alerts WHERE severity='critical' AND status='active' ORDER BY id DESC LIMIT 100;

EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM telemetry
WHERE machine_id='MCH-001' AND recorded_at>now()-interval '1 hour'
ORDER BY recorded_at DESC,id DESC LIMIT 100;
