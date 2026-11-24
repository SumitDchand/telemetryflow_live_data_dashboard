"""Reproducible isolated-schema database benchmark. Never deletes application data."""
import argparse
import json
import math
import os
import platform
import resource
import statistics
import sys
import time
import urllib.request
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4
import psycopg
from psycopg.rows import dict_row
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ingestion'))
from database import Database
from simulator import Simulator

ROOT=Path(__file__).resolve().parents[1]
def distribution(samples):
    samples=sorted(samples)
    return {'samples':len(samples),'median_ms':round(statistics.median(samples),3),'p95_ms':round(samples[max(0,math.ceil(len(samples)*.95)-1)],3)} if samples else None

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--samples',type=int,default=30)
    parser.add_argument('--rows',type=int,default=100000)
    parser.add_argument('--api',default='http://127.0.0.1:3001')
    parser.add_argument('--output',default='docs/benchmark-results.json')
    args=parser.parse_args()
    if not 5<=args.samples<=1000 or not 10000<=args.rows<=1000000:parser.error('Use 5–1000 samples and 10,000–1,000,000 rows')
    started=time.perf_counter();cpu=resource.getrusage(resource.RUSAGE_SELF)
    schema='benchmark_'+uuid4().hex
    conn=psycopg.connect(os.environ['DATABASE_URL'],autocommit=True,row_factory=dict_row)
    results={'executed_at':datetime.now(timezone.utc).isoformat(),'host':{'platform':platform.platform(),'architecture':platform.machine(),'logical_cpus':os.cpu_count(),'python':platform.python_version()},'postgres':conn.execute('SELECT version() AS v').fetchone()['v'],'configuration':vars(args),'ingestion':[]}
    conn.execute(f'CREATE SCHEMA {schema}')
    conn.execute(f'SET search_path TO {schema}')
    try:
        for path in sorted((ROOT/'database').glob('*.sql')):conn.execute(path.read_text())
        db=Database(os.environ['DATABASE_URL']);db.connection=conn
        ids=db.initialize(100)
        for count in (5,25,100):
            for interval in (.1,.5):
                simulator=Simulator(ids[:count],42)
                latencies=[];writes=failures=0;start=time.perf_counter()
                for _ in range(args.samples):
                    tick=time.perf_counter()
                    try:
                        n,ms=db.write_batch(simulator.collect());writes+=n;latencies.append(ms)
                    except Exception:failures+=1
                    time.sleep(max(0,interval-(time.perf_counter()-tick)))
                duration=time.perf_counter()-start
                row={'machines':count,'interval_seconds':interval,'duration_seconds':round(duration,3),'successful_records':writes,'failed_attempts':failures,'records_per_second':round(writes/duration,2),'transaction_latency':distribution(latencies)}
                results['ingestion'].append(row)
                print(json.dumps(row),flush=True)
        sim=Simulator(ids,99)
        comparison={}
        for mode in ('individual','batch'):
            samples=[];start=time.perf_counter()
            for _ in range(10):
                rows=sim.collect();tick=time.perf_counter()
                if mode=='individual':
                    for row in rows:db.write_batch([row])
                else:db.write_batch(rows)
                samples.append((time.perf_counter()-tick)*1000)
            comparison[mode]={'records':1000,'records_per_second':round(1000/(time.perf_counter()-start),2),'hundred_record_latency':distribution(samples)}
        results['insert_comparison']=comparison
        # A separate representative history table avoids removing production indexes.
        conn.execute('CREATE TABLE benchmark_history(id bigint, machine_id text, recorded_at timestamptz, temperature double precision)')
        conn.execute("INSERT INTO benchmark_history SELECT n, 'MCH-'||lpad(((n %% 100)+1)::text,3,'0'), now()-n*interval '1 second',50+(n %% 30) FROM generate_series(1,%s) n",(args.rows,))
        conn.execute('ANALYZE benchmark_history')
        query="SELECT * FROM benchmark_history WHERE machine_id='MCH-025' AND recorded_at>now()-interval '12 hours' ORDER BY recorded_at DESC LIMIT 100"
        plans={}
        for indexed in (False,True):
            if indexed:conn.execute('CREATE INDEX benchmark_machine_time ON benchmark_history(machine_id,recorded_at DESC)');conn.execute('ANALYZE benchmark_history')
            conn.execute(query).fetchall() # warm cache
            samples=[]
            for _ in range(args.samples):
                tick=time.perf_counter();conn.execute(query).fetchall();samples.append((time.perf_counter()-tick)*1000)
            plan=conn.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query).fetchone()['QUERY PLAN']
            plans['indexed' if indexed else 'unindexed']={'round_trip':distribution(samples),'explain_analyze':plan}
        results['history_query']=plans
        api={}
        for endpoint in ('/api/health','/api/telemetry/history?machine_id=MCH-001&limit=100','/api/telemetry/summary?range=1h'):
            samples=[];failures=0
            for _ in range(args.samples):
                tick=time.perf_counter()
                try:
                    with urllib.request.urlopen(args.api+endpoint,timeout=10) as r:r.read()
                    samples.append((time.perf_counter()-tick)*1000)
                except Exception:failures+=1
            api[endpoint]={'latency':distribution(samples),'failed_requests':failures}
        results['api']=api
    finally:
        conn.execute('SET search_path TO public');conn.execute(f'DROP SCHEMA {schema} CASCADE');conn.close()
    usage=resource.getrusage(resource.RUSAGE_SELF)
    results['duration_seconds']=round(time.perf_counter()-started,2)
    results['runner_resources']={'cpu_seconds':round(usage.ru_utime+usage.ru_stime-cpu.ru_utime-cpu.ru_stime,3),'peak_rss_bytes':usage.ru_maxrss if sys.platform=='darwin' else usage.ru_maxrss*1024,'scope':'benchmark Python process only, not database or browser'}
    Path(args.output).write_text(json.dumps(results,indent=2)+'\n')
    print('Saved '+args.output)

if __name__=='__main__':main()
