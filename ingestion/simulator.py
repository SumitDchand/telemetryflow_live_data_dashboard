import random
from datetime import datetime, timezone
from uuid import uuid4

class Simulator:
    """Mean-reverting sensor source; replace collect() to integrate hardware."""
    def __init__(self, machine_ids, seed=42):
        self.random = random.Random(seed)
        self.ids = machine_ids
        self.baselines = {m: [52 + (i % 5)*5, 4 + (i % 5)*0.65, 1.2 + (i % 5)*0.35, 24 + (i % 5)*9] for i, m in enumerate(machine_ids)}
        self.values = {m: v.copy() for m, v in self.baselines.items()}
        self.ticks = 0

    def collect(self, controls=None, thresholds=None):
        controls = controls or {}
        limits = thresholds or {'temperature': (80, 95), 'pressure': (9, 12), 'vibration': (5, 8), 'power': (75, 95)}
        readings = []
        self.ticks += 1
        for m in self.ids:
            base, values = self.baselines[m], self.values[m]
            for i, noise in enumerate([0.65, 0.08, 0.07, 0.5]):
                values[i] = max(0, values[i] + (base[i]-values[i])*0.12 + self.random.gauss(0, noise))
            sampled = values.copy()
            scenario = controls.get(m, 'normal')
            # Rare, reproducible excursions; explicit scenarios persist until reset.
            if scenario == 'normal' and self.random.random() < 0.002:
                scenario = self.random.choice(['temperature_spike', 'excessive_vibration', 'machine_failure'])
            if scenario == 'temperature_spike': sampled[0] += 48
            if scenario == 'excessive_vibration': sampled[2] += 9
            if scenario == 'pressure_anomaly': sampled[1] += 10
            if scenario == 'machine_failure': sampled[3] = 0
            metrics = dict(zip(['temperature', 'pressure', 'vibration', 'power'], [round(v, 3) for v in sampled]))
            status = 'running'
            if any(metrics[k] >= v[0] for k, v in limits.items()): status = 'warning'
            if any(metrics[k] >= v[1] for k, v in limits.items()): status = 'critical'
            if scenario == 'machine_failure': status = 'offline'
            readings.append(dict(event_id=str(uuid4()), machine_id=m, sensor_id=f'{m}-S01', **metrics, status=status, recorded_at=datetime.now(timezone.utc)))
        return readings
