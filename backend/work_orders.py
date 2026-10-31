"""
work_orders.py - AI-Powered Work Order Management for NirX Digital Twin.
"""

import random
from typing import Dict, List, Optional
from datetime import datetime, timezone

from monitoring import SENSOR_LABELS, SENSOR_ZONES

_work_order_store: Dict[str, Dict] = {}
_wo_counter = 1000


def _next_wo_id() -> str:
    global _wo_counter
    _wo_counter += 1
    return f"WO-{_wo_counter}"


def _classify_severity(pressure_drop_m: float, flow_loss_pct: float, status: str) -> str:
    if status == "CRITICAL" or pressure_drop_m >= 3.0:
        return "CRITICAL"
    elif pressure_drop_m >= 2.0 or flow_loss_pct > 30:
        return "HIGH"
    elif pressure_drop_m >= 0.8 or flow_loss_pct > 15:
        return "MEDIUM"
    return "LOW"


def _generate_description(sensor_id: str, pressure_drop_m: float, flow_lmin: float, severity: str) -> str:
    label = SENSOR_LABELS.get(sensor_id, f"Sensor {sensor_id}")
    zone = SENSOR_ZONES.get(sensor_id, "Unknown Zone")
    if severity == "CRITICAL":
        return (f"Critical pressure anomaly at {label} ({zone}). Drop of {pressure_drop_m:.2f}m exceeds critical threshold. "
                f"Flow: {flow_lmin:.1f} L/min. Potential major pipeline burst requiring immediate dispatch.")
    elif severity == "HIGH":
        return (f"Significant pressure deviation at {label} ({zone}). Drop {pressure_drop_m:.2f}m, flow {flow_lmin:.1f} L/min. "
                f"Suspected active leak or valve malfunction requiring urgent inspection.")
    elif severity == "MEDIUM":
        return (f"Warning-level pressure variation at {label} ({zone}). Deficit {pressure_drop_m:.2f}m, flow {flow_lmin:.1f} L/min. "
                f"Monitor and inspect within 24h.")
    return (f"Minor fluctuation at {label} ({zone}). Deviation {pressure_drop_m:.2f}m within range. Schedule routine inspection.")


def _generate_recommended_action(sensor_id: str, pressure_drop_m: float, severity: str, zone: str) -> str:
    label = SENSOR_LABELS.get(sensor_id, f"Sensor {sensor_id}")
    if severity == "CRITICAL":
        return (f"IMMEDIATE: Dispatch emergency crew to {label} (Junction {sensor_id}). "
                f"1. Isolate upstream gate valves near Junction {sensor_id}. "
                f"2. Perform acoustic leak correlation along connected mains. "
                f"3. Reduce pump pressure in {zone} to limit further loss. "
                f"4. Notify downstream customers. 5. Begin emergency pipe repair upon confirmed location.")
    elif severity == "HIGH":
        return (f"Dispatch maintenance team to Junction {sensor_id} ({label}). "
                f"1. Inspect pipeline segments for visible leakage. "
                f"2. Check valve positions upstream and downstream. "
                f"3. Use portable pressure logger to confirm gradient. "
                f"4. If leak confirmed, prepare isolation and repair plan.")
    elif severity == "MEDIUM":
        return (f"Schedule inspection at {label} within 24 hours. "
                f"1. Inspect manhole access points near {label}. "
                f"2. Verify no planned maintenance causing interference. "
                f"3. Log pressure readings manually at Junction {sensor_id}.")
    return (f"Add Junction {sensor_id} to next scheduled maintenance route. "
            f"1. Confirm readings are not due to normal demand variation. "
            f"2. Check sensor calibration during next routine visit.")


def _generate_suspected_cause(severity: str, pressure_drop_m: float, zone: str) -> str:
    if severity == "CRITICAL":
        causes = [f"Major pipeline burst in {zone} main distribution line",
                  f"Catastrophic valve failure causing pressure collapse in {zone}",
                  "Significant orifice leak (estimated area > 0.005 m2) in primary main"]
    elif severity == "HIGH":
        causes = [f"Active pipeline leak in {zone} secondary network",
                  "Partially closed or malfunctioning isolation valve",
                  f"Pipe joint failure or corrosion-induced crack in {zone}"]
    elif severity == "MEDIUM":
        causes = ["Minor pipe wall deterioration or hairline crack",
                  "Demand surge from unregistered consumer connection",
                  f"Meter tampering or unauthorized hydrant draw in {zone}"]
    else:
        causes = ["Normal demand variation or diurnal pressure fluctuation",
                  "Temporary pressure adjustment from upstream operations"]
    return random.choice(causes)


def generate_work_orders_from_state(state_response, baseline_pressures: Dict[str, float]) -> List[Dict]:
    generated = []
    for sensor in state_response.sensors:
        if sensor.status in ("WARNING", "CRITICAL"):
            base_flow = 145.0
            flow_lmin = max(0.0, base_flow - sensor.pressure_drop_m * 18.0)
            flow_loss_pct = ((base_flow - flow_lmin) / base_flow) * 100
            severity = _classify_severity(sensor.pressure_drop_m, flow_loss_pct, sensor.status)
            zone = SENSOR_ZONES.get(sensor.node_id, "Unknown Zone")
            wo_id = _next_wo_id()
            work_order = {
                "work_order_id": wo_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "sensor_id": sensor.node_id,
                "location": SENSOR_LABELS.get(sensor.node_id, f"Junction {sensor.node_id}"),
                "zone": zone,
                "severity": severity,
                "status": "PENDING",
                "incident_type": "PRESSURE_ANOMALY" if sensor.status == "WARNING" else "CRITICAL_PRESSURE_DROP",
                "problem_description": _generate_description(sensor.node_id, sensor.pressure_drop_m, flow_lmin, severity),
                "suspected_cause": _generate_suspected_cause(severity, sensor.pressure_drop_m, zone),
                "recommended_action": _generate_recommended_action(sensor.node_id, sensor.pressure_drop_m, severity, zone),
                "current_pressure_m": sensor.current_pressure_m,
                "baseline_pressure_m": sensor.baseline_pressure_m,
                "pressure_drop_m": sensor.pressure_drop_m,
                "current_pressure_psi": round(sensor.current_pressure_m * 1.42234, 2),
                "flow_lmin": round(flow_lmin, 1),
                "lat_lng": sensor.lat_lng,
                "auto_generated": True,
                "history": [],
            }
            generated.append(work_order)
            if wo_id not in _work_order_store:
                _work_order_store[wo_id] = work_order
    return generated


def get_all_work_orders() -> List[Dict]:
    severity_rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    orders = list(_work_order_store.values())
    orders.sort(key=lambda o: (severity_rank.get(o.get("severity", "LOW"), 9), o.get("created_at", "")))
    return orders


def get_work_order(wo_id: str) -> Optional[Dict]:
    return _work_order_store.get(wo_id)


def create_work_order(data: Dict) -> Dict:
    wo_id = _next_wo_id()
    work_order = {
        "work_order_id": wo_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sensor_id": data.get("sensor_id", ""),
        "location": data.get("location", "Unknown Location"),
        "zone": data.get("zone", "Unknown Zone"),
        "severity": data.get("severity", "MEDIUM"),
        "status": "PENDING",
        "incident_type": data.get("incident_type", "MANUAL_REPORT"),
        "problem_description": data.get("problem_description", "Manually reported issue."),
        "suspected_cause": data.get("suspected_cause", "Under investigation."),
        "recommended_action": data.get("recommended_action", "Dispatch inspection team."),
        "current_pressure_m": data.get("current_pressure_m", 0.0),
        "baseline_pressure_m": data.get("baseline_pressure_m", 0.0),
        "pressure_drop_m": data.get("pressure_drop_m", 0.0),
        "current_pressure_psi": data.get("current_pressure_psi", 0.0),
        "flow_lmin": data.get("flow_lmin", 0.0),
        "lat_lng": data.get("lat_lng", [37.7749, -122.4194]),
        "auto_generated": False,
        "history": [],
    }
    _work_order_store[wo_id] = work_order
    return work_order


def update_work_order(wo_id: str, updates: Dict) -> Optional[Dict]:
    if wo_id not in _work_order_store:
        return None
    wo = _work_order_store[wo_id]
    old_status = wo.get("status", "PENDING")
    allowed_updates = {"status", "severity", "problem_description", "recommended_action", "suspected_cause", "notes"}
    for key, val in updates.items():
        if key in allowed_updates:
            wo[key] = val
    new_status = wo.get("status", old_status)
    if new_status != old_status:
        wo.setdefault("history", []).append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "from_status": old_status,
            "to_status": new_status,
        })
    _work_order_store[wo_id] = wo
    return wo


def get_work_order_summary() -> Dict:
    orders = list(_work_order_store.values())
    return {
        "total": len(orders),
        "critical": sum(1 for o in orders if o.get("severity") == "CRITICAL"),
        "high": sum(1 for o in orders if o.get("severity") == "HIGH"),
        "medium": sum(1 for o in orders if o.get("severity") == "MEDIUM"),
        "low": sum(1 for o in orders if o.get("severity") == "LOW"),
        "pending": sum(1 for o in orders if o.get("status") == "PENDING"),
        "in_progress": sum(1 for o in orders if o.get("status") == "IN_PROGRESS"),
        "completed": sum(1 for o in orders if o.get("status") == "COMPLETED"),
    }
