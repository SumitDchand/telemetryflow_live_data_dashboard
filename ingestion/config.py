import os
from dataclasses import dataclass

@dataclass
class Config:
    database_url: str = os.getenv('DATABASE_URL', '')
    interval: float = float(os.getenv('INGEST_INTERVAL', '2'))
    buffer_limit: int = int(os.getenv('BUFFER_LIMIT', '5000'))
    batch_size: int = int(os.getenv('BATCH_SIZE', '500'))
    seed: int = int(os.getenv('SIMULATION_SEED', '42'))
    machine_count: int = int(os.getenv('MACHINE_COUNT', '5'))
    retention_days: int = int(os.getenv('RETENTION_DAYS', '7'))

    def __post_init__(self):
        if not self.database_url:
            raise ValueError('DATABASE_URL is required')
        if not 0.1 <= self.interval <= 60 or not 1 <= self.batch_size <= 1000:
            raise ValueError('Invalid interval or batch size')
        if self.buffer_limit < self.batch_size or not 5 <= self.machine_count <= 100:
            raise ValueError('Invalid buffer limit or machine count')
        if not 1 <= self.retention_days <= 365:
            raise ValueError('Retention must be 1–365 days')
