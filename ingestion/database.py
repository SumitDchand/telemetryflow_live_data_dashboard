import time
import psycopg
from psycopg.rows import dict_row

FIELDS = ('event_id','machine_id','sensor_id','temperature','pressure','vibration','power','status','recorded_at')
INSERT = f"INSERT INTO telemetry ({','.join(FIELDS)}) VALUES ({','.join(['%s']*len(FIELDS))}) ON CONFLICT(event_id) DO NOTHING RETURNING id"

class Database:
    def __init__(self, url):
        self.url, self.connection = url, None

    def connect(self):
        if self.connection is None or self.connection.closed:
            self.connection = psycopg.connect(self.url, connect_timeout=3, autocommit=True, row_factory=dict_row, options='-c statement_timeout=5000')
        return self.connection

    def initialize(self, count):
        conn = self.connect()
        with conn.transaction():
            for i in range(6, count+1):
                machine = f'MCH-{i:03}'
                conn.execute('INSERT INTO machines(id,name,type,location) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING', (machine,f'Expansion Unit {i:02}', 'Multi-sensor rig','Simulation lab'))
                conn.execute('INSERT INTO simulation_controls(machine_id) VALUES(%s) ON CONFLICT DO NOTHING', (machine,))
            conn.execute('UPDATE ingestion_health SET started_at=now() WHERE id=1')
        return [r['id'] for r in conn.execute('SELECT id FROM machines ORDER BY id LIMIT %s', (count,))]

    def configuration(self):
        conn = self.connect()
        controls = {r['machine_id']: r['scenario'] for r in conn.execute('SELECT * FROM simulation_controls')}
        thresholds = {r['metric']: (r['warning'], r['critical']) for r in conn.execute('SELECT * FROM thresholds')}
        return controls, thresholds

    def write_batch(self, readings, failed=0, dropped=0, buffered=0):
        start = time.perf_counter()
        conn = self.connect()
        count = 0
        with conn.transaction():
            # Serialize writers BEFORE sequence allocation so recovery cursors follow commit order.
            conn.execute('SELECT pg_advisory_xact_lock(74101)')
            if readings:
                with conn.cursor() as cursor:
                    cursor.executemany(INSERT, [tuple(reading[k] for k in FIELDS) for reading in readings], returning=True)
                    while True:
                        count += cursor.fetchone() is not None
                        if not cursor.nextset(): break
            elapsed = (time.perf_counter()-start)*1000
            conn.execute('''UPDATE ingestion_health SET heartbeat_at=now(), last_success_at=CASE WHEN %s>0 THEN now() ELSE last_success_at END,
                successful_writes=successful_writes+%s, failed_attempts=failed_attempts+%s,
                dropped_readings=dropped_readings+%s, buffered_readings=%s,last_batch_ms=%s WHERE id=1''',
                (count,count,failed,dropped,buffered,elapsed))
            conn.execute("SELECT pg_notify('telemetry_committed', %s)", (str(count),))
        return count, (time.perf_counter()-start)*1000

    def cleanup(self, days):
        conn = self.connect()
        # Small deletes avoid a single huge maintenance transaction.
        with conn.transaction():
            conn.execute("DELETE FROM alerts WHERE id IN (SELECT id FROM alerts WHERE created_at < now() - %s * interval '1 day' LIMIT 10000)", (days,))
            conn.execute("DELETE FROM telemetry WHERE id IN (SELECT id FROM telemetry WHERE recorded_at < now() - %s * interval '1 day' LIMIT 10000)", (days,))

    def close(self):
        if self.connection:
            self.connection.close()
        self.connection = None
