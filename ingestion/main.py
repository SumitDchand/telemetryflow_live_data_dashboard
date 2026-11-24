import logging
import signal
import threading
import time
from config import Config
from database import Database
from collector import Collector, log
from simulator import Simulator

def main():
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    config = Config()
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM): signal.signal(sig, lambda *_: stop.set())
    db = Database(config.database_url)
    attempt = 0
    while not stop.is_set():
        try:
            ids = db.initialize(config.machine_count)
            break
        except Exception as exc:
            db.close()
            log('startup_retry', error=type(exc).__name__)
            stop.wait(min(30, 2**min(attempt,5)))
            attempt += 1
    else:
        return
    collector = Collector(db, config)
    simulator = Simulator(ids, config.seed)
    controls, thresholds = {}, None
    cleanup_at = time.monotonic()
    try:
        while not stop.is_set():
            started = time.monotonic()
            if started >= collector.retry_at:
                try:
                    controls, thresholds = db.configuration()
                except Exception:
                    db.close()
            collector.enqueue(simulator.collect(controls, thresholds))
            collector.flush()
            if started >= cleanup_at and not collector.attempt:
                try: db.cleanup(config.retention_days)
                except Exception as exc: log('retention_failed', error=type(exc).__name__)
                cleanup_at = started + 60
            stop.wait(max(0, config.interval-(time.monotonic()-started)))
    finally:
        collector.shutdown()

if __name__ == '__main__': main()
