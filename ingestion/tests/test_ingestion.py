import math
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import pytest
from simulator import Simulator
from validator import validate
from collector import Collector
from database import Database

@pytest.fixture
def reading(): return Simulator(['MCH-001']).collect()[0]

def test_simulation_is_valid_and_gradual():
    sim=Simulator(['MCH-001','MCH-002'])
    previous=sim.collect()
    assert len(previous)==2
    for _ in range(20):
        rows=sim.collect()
        for row,old in zip(rows,previous):
            validate(row)
            assert abs(row['temperature']-old['temperature'])<50
        previous=rows

def test_reproducible_values_and_unique_ids():
    a=Simulator(['MCH-001'],42).collect()[0]
    b=Simulator(['MCH-001'],42).collect()[0]
    assert a['temperature']==b['temperature']
    assert a['event_id']!=b['event_id']

@pytest.mark.parametrize('key,value',[('temperature',math.nan),('pressure',-1),('vibration','5'),('power',True),('status','unknown'),('event_id','bad')])
def test_invalid_rejected(reading,key,value):
    reading[key]=value
    with pytest.raises((ValueError,TypeError)): validate(reading)

def test_naive_timestamp_rejected(reading):
    reading['recorded_at']=reading['recorded_at'].replace(tzinfo=None)
    with pytest.raises(ValueError):validate(reading)

@pytest.mark.parametrize('scenario,field,minimum',[('temperature_spike','temperature',95),('excessive_vibration','vibration',8),('pressure_anomaly','pressure',12)])
def test_scenarios(scenario,field,minimum):
    row=Simulator(['MCH-001']).collect({'MCH-001':scenario})[0]
    assert row[field]>minimum
    assert row['status']=='critical'

def test_failure_scenario():
    row=Simulator(['MCH-001']).collect({'MCH-001':'machine_failure'})[0]
    assert row['status']=='offline' and row['power']==0

class FakeDB:
    def __init__(self):self.fail=False;self.calls=0;self.closed=False
    def write_batch(self,rows,*args):
        self.calls+=1
        if self.fail:raise ConnectionError('outage')
        return len(rows),1
    def close(self):self.closed=True

@pytest.fixture
def collector(): return Collector(FakeDB(),SimpleNamespace(buffer_limit=3,batch_size=2))

def test_failure_keeps_buffer_and_backoff(collector,reading):
    collector.enqueue([reading]);collector.db.fail=True
    assert not collector.flush()
    assert len(collector.buffer)==1
    assert not collector.flush()
    assert collector.db.calls==1
    collector.db.fail=False
    assert collector.flush(force=True)
    assert not collector.buffer

def test_bounded_overflow_and_invalid(collector,reading):
    collector.enqueue([reading]*5)
    assert len(collector.buffer)==3 and collector.dropped==2
    collector.enqueue([{**reading,'temperature':999}])
    assert len(collector.buffer)==3

def test_shutdown_drains_all_batches(collector,reading):
    collector.enqueue([reading]*3)
    collector.shutdown()
    assert not collector.buffer and collector.db.closed and collector.db.calls==2

def test_shutdown_outage_reports_remaining(collector,reading):
    collector.enqueue([reading]);collector.db.fail=True
    collector.shutdown()
    assert len(collector.buffer)==1 and collector.db.closed

@pytest.fixture
def database():
    url=os.getenv('DATABASE_URL')
    if not url:pytest.skip('Set DATABASE_URL for PostgreSQL integration tests')
    import psycopg
    from psycopg.rows import dict_row
    schema='test_python_'+uuid4().hex
    conn=psycopg.connect(url,autocommit=True,row_factory=dict_row)
    conn.execute(f'CREATE SCHEMA {schema}')
    conn.execute(f'SET search_path TO {schema}')
    root=Path(__file__).resolve().parents[2]
    for path in sorted((root/'database').glob('*.sql')):conn.execute(path.read_text())
    db=Database(url);db.connection=conn
    yield db
    conn.execute('SET search_path TO public')
    conn.execute(f'DROP SCHEMA {schema} CASCADE')
    conn.close()

def test_batch_and_duplicate_prevention(database):
    rows=Simulator(['MCH-001','MCH-002']).collect()
    assert database.write_batch(rows)[0]==2
    assert database.write_batch(rows)[0]==0
    assert database.connect().execute('SELECT count(*) AS n FROM telemetry').fetchone()['n']==2

def test_transaction_rollback(database,reading):
    invalid={**reading,'event_id':str(uuid4()),'machine_id':'nonexistent'}
    with pytest.raises(Exception):database.write_batch([reading,invalid])
    assert database.connect().execute('SELECT count(*) AS n FROM telemetry').fetchone()['n']==0

def test_alert_cooldown_and_escalation(database):
    sim=Simulator(['MCH-001'])
    for _ in range(2):database.write_batch(sim.collect({'MCH-001':'temperature_spike'}))
    alerts=database.connect().execute("SELECT * FROM alerts WHERE metric='temperature'").fetchall()
    assert len(alerts)==1 and alerts[0]['severity']=='critical'

def test_notify_only_after_commit(database,reading):
    import psycopg
    listener=psycopg.connect(os.environ['DATABASE_URL'],autocommit=True)
    listener.execute('LISTEN telemetry_committed')
    database.write_batch([reading])
    notifications=list(listener.notifies(timeout=1,stop_after=1))
    listener.close()
    assert len(notifications)==1
