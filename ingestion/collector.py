import json
import logging
import time
from collections import deque
from validator import validate

def log(event, **fields):
    logging.info(json.dumps({'event': event, **fields}, default=str))

class Collector:
    def __init__(self, db, config):
        self.db, self.config = db, config
        self.buffer = deque()
        self.failed = self.dropped = self.attempt = 0
        self.retry_at = 0

    def enqueue(self, readings):
        for reading in readings:
            try:
                validate(reading)
            except (ValueError, TypeError, KeyError) as exc:
                log('reading_rejected', reason=str(exc))
                continue
            if len(self.buffer) >= self.config.buffer_limit:
                self.buffer.popleft()
                self.dropped += 1
                log('buffer_overflow', dropped=self.dropped)
            self.buffer.append(reading)

    def flush(self, force=False):
        if not force and time.monotonic() < self.retry_at:
            return False
        batch = list(self.buffer)[:self.config.batch_size]
        try:
            count, latency = self.db.write_batch(batch, self.failed, self.dropped, max(0,len(self.buffer)-len(batch)))
            for _ in batch: self.buffer.popleft()
            log('batch_committed', inserted=count, latency_ms=round(latency,2), buffered=len(self.buffer))
            self.failed = self.dropped = self.attempt = 0
            self.retry_at = 0
            return True
        except Exception as exc:
            self.db.close()
            self.failed += 1
            self.attempt += 1
            self.retry_at = time.monotonic() + min(30, 2 ** min(self.attempt-1,5))
            log('database_retry', error=type(exc).__name__, buffered=len(self.buffer), attempt=self.attempt)
            return False

    def shutdown(self, timeout=8):
        deadline = time.monotonic() + timeout
        while self.buffer and time.monotonic() < deadline:
            if not self.flush(force=True): break
        log('shutdown', unflushed_readings=len(self.buffer))
        self.db.close()
