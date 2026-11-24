import math
from datetime import datetime, timezone
from uuid import UUID

RANGES = {'temperature': (-50, 250), 'pressure': (0, 50), 'vibration': (0, 100), 'power': (0, 1000)}

def validate(reading):
    UUID(str(reading['event_id']))
    for key, (low, high) in RANGES.items():
        value = reading[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'Invalid {key}: {value}')
    if reading['status'] not in ('running', 'warning', 'critical', 'offline'):
        raise ValueError('Invalid status')
    if not reading['machine_id'] or not reading['sensor_id']:
        raise ValueError('Machine and sensor are required')
    timestamp = reading['recorded_at']
    if not isinstance(timestamp, datetime) or timestamp.tzinfo is None or timestamp.utcoffset().total_seconds() != 0:
        raise ValueError('Timestamp must be UTC-aware')
    if timestamp.timestamp() > datetime.now(timezone.utc).timestamp() + 60:
        raise ValueError('Timestamp is in the future')
    return reading
