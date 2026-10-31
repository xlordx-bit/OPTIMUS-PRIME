"""
monitoring.py - Real-Time Pressure Monitoring Module for NirX Digital Twin.

Provides:
- Simulated sensor telemetry history generation.
- Pressure/flow time-series data for dashboard charts.
- Sensor status overview with configurable thresholds.
- Alert management for abnormal readings.
"""

import time
import math
import random
import uuid
from typing import Dict, List, Optional
from datetime import datetime, timezone, timedelta

from simulation import SENSOR_NODES

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────
PRESSURE_WARNING_PSI = 55.0    # PSI threshold for warning
PRESSURE_CRITICAL_PSI = 40.0   # PSI threshold for critical (low)
FLOW_WARNING_LMIN = 180.0      # L/min warning threshold
FLOW_CRITICAL_LMIN = 80.0      # L/min critical threshold

METERS_TO_PSI = 1.42234        # 1 m H₂O ≈ 1.42234 PSI

# Typical sensor labels for display
SENSOR_LABELS: Dict[str, str] = {
    "10":  "Intake Zone A",
    "15":  "District North",
    "105": "Residential B",
    "117": "Junction Hub 117",
    "123": "Industrial Sector",
    "129": "District East",
    "149": "Park Zone",
    "181": "Hospital Wing",
    "195": "Commerce Centre",
    "206": "Pump Station Out",
    "217": "Elevated Tank Feed",
    "247": "Reservoir Outlet",
}

SENSOR_ZONES: Dict[str, str] = {
    "10": "Zone A", "15": "Zone A",
    "105": "Zone B", "117": "Zone B",
    "123": "Zone C", "129": "Zone C",
    "149": "Zone D", "181": "Zone D",
    "195": "Zone E", "206": "Zone E",
    "217": "Zone F", "247": "Zone F",
}

# In-memory alert store
_alert_store: List[Dict] = []
_alert_id_counter = 0


def _next_alert_id() -> str:
    global _alert_id_counter
    _alert_id_counter += 1
    return f"ALT-{_alert_id_counter:04d}"


def generate_sensor_history(
    sensor_id: str,
    baseline_pressure_m: float,
    current_pressure_m: float,
    points: int = 30,
    interval_seconds: int = 60
) -> List[Dict]:
    """
    Generates a realistic time-series history for a sensor.
    Uses sinusoidal base variation with Gaussian noise.
    Accounts for any active pressure drop.
    """
    now = datetime.now(timezone.utc)
    history = []

    pressure_drop = baseline_pressure_m - current_pressure_m
    base_psi = baseline_pressure_m * METERS_TO_PSI

    # Typical daily demand pattern: lower at night, peak morning and evening
    for i in range(points - 1, -1, -1):
        ts = now - timedelta(seconds=i * interval_seconds)
        hour = ts.hour + ts.minute / 60.0

        # Sinusoidal demand cycle: ~5% variation over 24h
        demand_variation = 0.04 * math.sin(2 * math.pi * (hour - 6) / 24)

        # Progressive leak simulation: if a drop exists, ramp it in the last 1/3 of history
        leak_factor = 0.0
        if pressure_drop > 0.5:
            leak_start_idx = int(points * 0.67)
            if i < (points - leak_start_idx):
                ramp = min(1.0, (points - leak_start_idx - i) / max(1, points - leak_start_idx))
                leak_factor = pressure_drop * ramp

        noise = random.gauss(0.0, 0.15)
        pressure_m = baseline_pressure_m * (1 + demand_variation) - leak_factor + noise
        pressure_psi = max(0.0, pressure_m * METERS_TO_PSI)

        # Simulated flow (L/min) — inversely correlated with pressure drop
        base_flow = 140.0 + random.gauss(0.0, 8.0) + demand_variation * 60.0
        flow_loss = leak_factor * 18.0
        flow_lmin = max(0.0, base_flow - flow_loss + random.gauss(0.0, 4.0))

        history.append({
            "timestamp": ts.isoformat(),
            "timestamp_unix": int(ts.timestamp()),
            "pressure_m": round(pressure_m, 2),
            "pressure_psi": round(pressure_psi, 2),
            "flow_lmin": round(flow_lmin, 1),
            "sensor_id": sensor_id,
        })

    return history


def get_monitoring_overview(state_response) -> Dict:
    """
    Builds the monitoring overview payload from the current state.
    Computes aggregate metrics and alert counts.
    """
    sensors = state_response.sensors
    summary = state_response.summary

    normal_count = sum(1 for s in sensors if s.status == "NORMAL")
    warning_count = sum(1 for s in sensors if s.status == "WARNING")
    critical_count = sum(1 for s in sensors if s.status == "CRITICAL")

    avg_pressure_psi = summary.mean_sensor_pressure_m * METERS_TO_PSI
    avg_flow_lmin = 140.0 - (summary.max_pressure_drop_m * 18.0)

    # Derive active alerts from current state
    active_alerts = [a for a in _alert_store if a.get("active", True)]

    return {
        "timestamp": state_response.timestamp_iso,
        "is_healthy": state_response.is_healthy,
        "is_simulated": True,
        "average_pressure_psi": round(avg_pressure_psi, 2),
        "average_pressure_m": round(summary.mean_sensor_pressure_m, 2),
        "average_flow_lmin": round(max(0.0, avg_flow_lmin), 1),
        "total_sensors": len(sensors),
        "normal_sensors": normal_count,
        "warning_sensors": warning_count,
        "critical_sensors": critical_count,
        "total_leakage_lph": summary.total_leakage_flow_lph,
        "max_pressure_drop_m": summary.max_pressure_drop_m,
        "active_alert_count": len(active_alerts),
        "thresholds": {
            "pressure_warning_psi": PRESSURE_WARNING_PSI,
            "pressure_critical_psi": PRESSURE_CRITICAL_PSI,
            "flow_warning_lmin": FLOW_WARNING_LMIN,
            "flow_critical_lmin": FLOW_CRITICAL_LMIN,
        },
    }


def get_all_sensors(state_response, baseline_pressures: Dict[str, float]) -> List[Dict]:
    """Returns enriched sensor list with PSI values, flow estimates, and labels."""
    sensors_out = []
    for sensor in state_response.sensors:
        base_psi = sensor.baseline_pressure_m * METERS_TO_PSI
        curr_psi = sensor.current_pressure_m * METERS_TO_PSI
        drop_psi = sensor.pressure_drop_m * METERS_TO_PSI

        # Estimate flow in L/min based on pressure
        est_flow_lmin = max(0.0, 145.0 - sensor.pressure_drop_m * 18.0 + random.gauss(0.0, 3.0))

        sensors_out.append({
            "sensor_id": sensor.node_id,
            "label": SENSOR_LABELS.get(sensor.node_id, f"Sensor {sensor.node_id}"),
            "zone": SENSOR_ZONES.get(sensor.node_id, "Zone X"),
            "lat_lng": sensor.lat_lng,
            "coordinates": {"x": sensor.coordinates.x, "y": sensor.coordinates.y},
            "status": sensor.status,
            "current_pressure_m": sensor.current_pressure_m,
            "current_pressure_psi": round(curr_psi, 2),
            "baseline_pressure_m": sensor.baseline_pressure_m,
            "baseline_pressure_psi": round(base_psi, 2),
            "pressure_drop_m": sensor.pressure_drop_m,
            "pressure_drop_psi": round(drop_psi, 2),
            "flow_lmin": round(est_flow_lmin, 1),
            "sensor_noise_m": sensor.sensor_noise_m,
            "is_simulated": True,
        })
    return sensors_out


def get_sensor_history(
    sensor_id: str,
    state_response,
    points: int = 30
) -> Optional[Dict]:
    """Returns historical time-series for a specific sensor."""
    sensor = next((s for s in state_response.sensors if s.node_id == sensor_id), None)
    if not sensor:
        return None

    history = generate_sensor_history(
        sensor_id=sensor_id,
        baseline_pressure_m=sensor.baseline_pressure_m,
        current_pressure_m=sensor.current_pressure_m,
        points=points
    )
    return {
        "sensor_id": sensor_id,
        "label": SENSOR_LABELS.get(sensor_id, f"Sensor {sensor_id}"),
        "zone": SENSOR_ZONES.get(sensor_id, "Zone X"),
        "points": points,
        "history": history,
    }


def get_multi_sensor_history(state_response, points: int = 30) -> Dict:
    """Returns history for all sensors (for overview chart)."""
    all_history = {}
    for sensor in state_response.sensors:
        history = generate_sensor_history(
            sensor_id=sensor.node_id,
            baseline_pressure_m=sensor.baseline_pressure_m,
            current_pressure_m=sensor.current_pressure_m,
            points=points
        )
        all_history[sensor.node_id] = {
            "label": SENSOR_LABELS.get(sensor.node_id, f"Sensor {sensor.node_id}"),
            "history": history,
        }
    return {
        "points": points,
        "sensors": all_history,
    }


def generate_monitoring_alerts(state_response) -> List[Dict]:
    """
    Derives current alerts from sensor state and maintains alert store.
    Returns the active alert list.
    """
    global _alert_store
    # Clear previous auto-generated alerts
    _alert_store = [a for a in _alert_store if a.get("manual", False)]

    for sensor in state_response.sensors:
        if sensor.status == "CRITICAL":
            _alert_store.append({
                "alert_id": _next_alert_id(),
                "timestamp": state_response.timestamp_iso,
                "sensor_id": sensor.node_id,
                "label": SENSOR_LABELS.get(sensor.node_id, f"Sensor {sensor.node_id}"),
                "type": "CRITICAL_PRESSURE_DROP",
                "message": (
                    f"Critical pressure drop of {sensor.pressure_drop_m:.2f}m detected at "
                    f"sensor {sensor.node_id} ({SENSOR_LABELS.get(sensor.node_id, '')}). "
                    f"Current: {sensor.current_pressure_m:.2f}m vs Baseline: {sensor.baseline_pressure_m:.2f}m."
                ),
                "severity": "CRITICAL",
                "current_value_m": sensor.current_pressure_m,
                "threshold_m": sensor.baseline_pressure_m - 2.0,
                "active": True,
                "manual": False,
            })
        elif sensor.status == "WARNING":
            _alert_store.append({
                "alert_id": _next_alert_id(),
                "timestamp": state_response.timestamp_iso,
                "sensor_id": sensor.node_id,
                "label": SENSOR_LABELS.get(sensor.node_id, f"Sensor {sensor.node_id}"),
                "type": "WARNING_PRESSURE_DROP",
                "message": (
                    f"Warning: Pressure deviation of {sensor.pressure_drop_m:.2f}m at "
                    f"sensor {sensor.node_id}. Monitor for further deterioration."
                ),
                "severity": "WARNING",
                "current_value_m": sensor.current_pressure_m,
                "threshold_m": sensor.baseline_pressure_m - 0.8,
                "active": True,
                "manual": False,
            })

    return _alert_store
