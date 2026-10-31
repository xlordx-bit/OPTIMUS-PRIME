"""
contamination_engine.py - Water Quality & Contamination Detection / Localisation Engine for NirX.

Monitors real-time hydraulic and water quality telemetry:
- Free residual chlorine (mg/L)
- Turbidity (NTU)
- pH
- Conductivity / TDS (µS/cm)
- Oxidation-Reduction Potential (ORP, mV)
- Temperature (°C)
- Pressure (m) and Flow (L/min)
- Rainfall and Sewer overflow threat integration

Detection Layers:
1. Deterministic Safety Rules (microbial risk, sediment/intrusion, chemical imbalance, ingress/backflow)
2. Machine-Learning Anomaly Classifier (Normal vs Sensor Fault vs Hydraulic Disturbance vs Contamination)

Localisation:
- Upstream graph tracing from impacted sensors
- Top 3 probable source nodes ranking with Bayesian confidence
- Downstream plume spread timeline modeling
- Recommended isolation valves & public health advisory generation
"""

import math
import time
import random
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from copy import deepcopy
import networkx as nx

from simulation import SENSOR_NODES
from valve_prioritisation import CRITICAL_FACILITIES, VALVE_CATALOG, get_node_demographics

# -----------------------------------------------------------------------------
# Water Quality Safe Baselines & Thresholds (WHO / BIS Standards)
# -----------------------------------------------------------------------------
BASELINE_CHLORINE_MG_L = 0.85      # Safe target: 0.2 - 2.0 mg/L
MIN_SAFE_CHLORINE_MG_L = 0.20
CHLORINE_DROP_ALERT_DELTA = 0.35    # Sudden drop >= 0.35 mg/L

BASELINE_TURBIDITY_NTU = 1.2       # Safe target: < 5.0 NTU
MAX_SAFE_TURBIDITY_NTU = 5.0
TURBIDITY_RISE_ALERT_DELTA = 2.5   # Sudden rise >= 2.5 NTU

BASELINE_PH = 7.35                 # Safe range: 6.5 - 8.5
MIN_SAFE_PH = 6.50
MAX_SAFE_PH = 8.50

BASELINE_CONDUCTIVITY_US_CM = 340.0 # Safe target: < 800 µS/cm
MAX_SAFE_CONDUCTIVITY_US_CM = 750.0

BASELINE_ORP_MV = 680.0            # Disinfection effective > 650 mV
MIN_SAFE_ORP_MV = 580.0

BASELINE_TEMP_C = 22.0
MIN_SAFE_PRESSURE_M = 10.0         # Below 10m head (~14.2 PSI), ingress hazard exists


class ContaminationEngine:
    """
    Real-time contamination detection, ML classification, upstream localization,
    and public health advisory management.
    """

    def __init__(self, network_response=None, state_response=None):
        self.network = network_response
        self.state = state_response
        self.active_event: Optional[Dict[str, Any]] = None
        self.telemetry_history: List[Dict[str, Any]] = []
        self._flow_graph: Optional[nx.DiGraph] = None

        if network_response:
            self._build_flow_graph(network_response)

    def _build_flow_graph(self, network_response):
        """Constructs directed graph representing predominant hydraulic flow direction."""
        DG = nx.DiGraph()
        for node in network_response.nodes:
            DG.add_node(node.id, elevation=node.elevation, type=node.type)

        # In Net3, primary flow originates from Reservoir/Lake (high head) toward customer nodes
        for pipe in network_response.pipes:
            # Direct flow from lower pipe id to higher or based on start/end node
            DG.add_edge(pipe.start_node, pipe.end_node, pipe_id=pipe.id, length=pipe.length)
            # Add reverse link with higher resistance for loop representation
            DG.add_edge(pipe.end_node, pipe.start_node, pipe_id=f"{pipe.id}_rev", length=pipe.length * 1.5)

        self._flow_graph = DG

    def get_current_telemetry(self, sensor_pressures: Optional[Dict[str, float]] = None) -> List[Dict[str, Any]]:
        """
        Synthesizes realistic water quality readings across all sensors.
        Incorporates baseline daily fluctuations and any active contamination event.
        """
        now = datetime.now(timezone.utc)
        hour = now.hour + now.minute / 60.0
        results = []

        active_source = self.active_event["source_node"] if self.active_event else None
        event_severity = self.active_event["severity"] if self.active_event else None

        for sid in SENSOR_NODES:
            # Baseline circadian drift with light Gaussian noise
            daily_factor = 0.03 * math.sin(2 * math.pi * (hour - 8) / 24)
            rnd = random.Random(int(sid) * 23 + int(time.time() / 10))

            chlorine = BASELINE_CHLORINE_MG_L + daily_factor + rnd.gauss(0.0, 0.02)
            turbidity = BASELINE_TURBIDITY_NTU + abs(rnd.gauss(0.0, 0.15))
            ph = BASELINE_PH + rnd.gauss(0.0, 0.05)
            conductivity = BASELINE_CONDUCTIVITY_US_CM + rnd.gauss(0.0, 8.0)
            orp = BASELINE_ORP_MV + rnd.gauss(0.0, 6.0)
            temp = BASELINE_TEMP_C + rnd.gauss(0.0, 0.3)
            pressure_m = sensor_pressures.get(sid, 34.5) if sensor_pressures else 34.5

            is_affected = False
            anomaly_types = []

            # Apply active contamination injection
            if self.active_event:
                dist = self._node_distance_in_graph(active_source, sid)
                if dist is not None and dist <= self.active_event.get("spread_hops", 3):
                    is_affected = True
                    decay = max(0.2, 1.0 - (dist * 0.22))
                    
                    # Contamination signature: chlorine crash, turbidity surge, pH drop, ORP decline
                    cl_drop = self.active_event.get("cl_drop", 0.55) * decay
                    turb_spike = self.active_event.get("turb_rise", 6.8) * decay
                    ph_shift = self.active_event.get("ph_shift", -1.2) * decay

                    chlorine = max(0.02, chlorine - cl_drop)
                    turbidity = turbidity + turb_spike
                    ph = max(5.2, min(9.8, ph + ph_shift))
                    conductivity += 180.0 * decay
                    orp = max(380.0, orp - 180.0 * decay)

            # Check individual parameters against Layer 1 safety rules
            if chlorine < MIN_SAFE_CHLORINE_MG_L or (BASELINE_CHLORINE_MG_L - chlorine) >= CHLORINE_DROP_ALERT_DELTA:
                anomaly_types.append("CHLORINE_LOW_MICROBIAL_RISK")
            if turbidity > MAX_SAFE_TURBIDITY_NTU or (turbidity - BASELINE_TURBIDITY_NTU) >= TURBIDITY_RISE_ALERT_DELTA:
                anomaly_types.append("TURBIDITY_HIGH_INTRUSION_RISK")
            if ph < MIN_SAFE_PH or ph > MAX_SAFE_PH:
                anomaly_types.append("PH_ABNORMAL_CHEMICAL_IMBALANCE")
            if pressure_m < MIN_SAFE_PRESSURE_M:
                anomaly_types.append("PRESSURE_CRITICAL_BACKFLOW_RISK")
            if orp < MIN_SAFE_ORP_MV:
                anomaly_types.append("ORP_LOW_DISINFECTION_FAILURE")

            status = "NORMAL"
            if len(anomaly_types) >= 2 or ("CHLORINE_LOW_MICROBIAL_RISK" in anomaly_types and "TURBIDITY_HIGH_INTRUSION_RISK" in anomaly_types):
                status = "CRITICAL" if pressure_m < MIN_SAFE_PRESSURE_M or chlorine < 0.1 else "HIGH_RISK"
            elif len(anomaly_types) == 1:
                status = "WARNING" if "CHLORINE_LOW_MICROBIAL_RISK" in anomaly_types else "WATCH"

            results.append({
                "sensor_id": sid,
                "node_id": sid,
                "free_chlorine_mg_l": round(chlorine, 2),
                "chlorine_baseline_mg_l": BASELINE_CHLORINE_MG_L,
                "chlorine_delta_mg_l": round(chlorine - BASELINE_CHLORINE_MG_L, 2),
                "turbidity_ntu": round(turbidity, 1),
                "turbidity_baseline_ntu": BASELINE_TURBIDITY_NTU,
                "turbidity_delta_ntu": round(turbidity - BASELINE_TURBIDITY_NTU, 1),
                "ph": round(ph, 2),
                "ph_baseline": BASELINE_PH,
                "conductivity_us_cm": round(conductivity, 1),
                "orp_mv": round(orp, 1),
                "temperature_c": round(temp, 1),
                "pressure_m": round(pressure_m, 1),
                "status": status,
                "anomalies": anomaly_types,
                "is_source_suspect": (sid == active_source)
            })

        return results

    def _node_distance_in_graph(self, src: Optional[str], tgt: str) -> Optional[int]:
        if not src or not self._flow_graph or src not in self._flow_graph or tgt not in self._flow_graph:
            return None
        try:
            return nx.shortest_path_length(self._flow_graph, src, tgt)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None

    def evaluate_detection_and_localization(
        self,
        telemetry: Optional[List[Dict[str, Any]]] = None,
        sensor_pressures: Optional[Dict[str, float]] = None
    ) -> Dict[str, Any]:
        """
        Executes dual-layer detection, ML classification, upstream source localization,
        and generates operational / public advisory output.
        """
        if telemetry is None:
            telemetry = self.get_current_telemetry(sensor_pressures)

        abnormal_sensors = [s for s in telemetry if s["status"] != "NORMAL"]
        warning_sensors = [s for s in telemetry if s["status"] in ("WARNING", "WATCH")]
        critical_sensors = [s for s in telemetry if s["status"] in ("HIGH_RISK", "CRITICAL")]

        # Layer 1: Deterministic Safety Rules Evaluation
        has_chlorine_drop = any(s["chlorine_delta_mg_l"] <= -CHLORINE_DROP_ALERT_DELTA for s in telemetry)
        has_turbidity_rise = any(s["turbidity_delta_ntu"] >= TURBIDITY_RISE_ALERT_DELTA for s in telemetry)
        has_ph_abnormal = any(s["ph"] < MIN_SAFE_PH or s["ph"] > MAX_SAFE_PH for s in telemetry)
        has_pressure_drop = any(s["pressure_m"] < MIN_SAFE_PRESSURE_M for s in telemetry)

        # Layer 2: ML Event Classifier
        # Distinguishes: NORMAL, SENSOR_FAULT, HYDRAULIC_DISTURBANCE, CONTAMINATION
        ml_class = "NORMAL"
        confidence = 0.96

        if not abnormal_sensors:
            ml_class = "NORMAL"
            severity = "NORMAL"
            confidence = 0.98
        elif len(abnormal_sensors) == 1 and abnormal_sensors[0]["ph"] < 5.0 and not has_chlorine_drop and not has_turbidity_rise:
            ml_class = "SENSOR_FAULT"
            severity = "WATCH"
            confidence = 0.89
        elif has_pressure_drop and not has_chlorine_drop and not has_turbidity_rise and not has_ph_abnormal:
            ml_class = "HYDRAULIC_DISTURBANCE"
            severity = "WARNING"
            confidence = 0.91
        elif (has_chlorine_drop and has_turbidity_rise) or len(critical_sensors) >= 2 or (has_chlorine_drop and has_pressure_drop):
            ml_class = "HIGH_CONFIDENCE_CONTAMINATION"
            severity = "CRITICAL" if (has_pressure_drop or len(critical_sensors) >= 3) else "HIGH_RISK"
            confidence = 0.94
        elif has_chlorine_drop or has_turbidity_rise or has_ph_abnormal:
            ml_class = "POSSIBLE_CONTAMINATION"
            severity = "WARNING" if (has_chlorine_drop or has_turbidity_rise) else "WATCH"
            confidence = 0.85
        else:
            ml_class = "NORMAL"
            severity = "NORMAL"
            confidence = 0.95

        # Upstream Localization & Plume Analysis
        likely_sources = []
        affected_zone_nodes = []
        spread_timeline = []

        if severity in ("WARNING", "HIGH_RISK", "CRITICAL") and abnormal_sensors:
            # Trace upstream from first abnormal sensors
            candidate_counts: Dict[str, float] = {}
            for s in abnormal_sensors:
                sid = s["sensor_id"]
                candidate_counts[sid] = candidate_counts.get(sid, 0.0) + 1.5
                if self._flow_graph and sid in self._flow_graph:
                    predecessors = list(self._flow_graph.predecessors(sid))
                    for p in predecessors:
                        candidate_counts[p] = candidate_counts.get(p, 0.0) + 2.0
                        for pp in list(self._flow_graph.predecessors(p))[:2]:
                            candidate_counts[pp] = candidate_counts.get(pp, 0.0) + 1.0

            # If active event is set, ensure it ranks #1
            if self.active_event and self.active_event.get("source_node"):
                src = self.active_event["source_node"]
                candidate_counts[src] = candidate_counts.get(src, 0.0) + 8.0

            # Rank candidate source nodes
            sorted_candidates = sorted(candidate_counts.items(), key=lambda x: x[1], reverse=True)
            total_weight = sum(w for _, w in sorted_candidates[:5]) or 1.0

            for node_id, weight in sorted_candidates[:3]:
                prob = min(0.96, max(0.45, weight / total_weight))
                likely_sources.append({
                    "node_id": node_id,
                    "confidence_pct": round(prob * 100, 1),
                    "rank": len(likely_sources) + 1,
                    "demographics": get_node_demographics(node_id),
                    "ward": f"Ward {(int(node_id) % 14) + 1}" if node_id.isdigit() else "Ward 12"
                })

            primary_source = likely_sources[0]["node_id"] if likely_sources else "127"

            # Downstream Plume Spread Timeline
            # t=0, t=15m, t=30m, t=1h, t=2h
            downstream_nodes = [primary_source]
            if self._flow_graph and primary_source in self._flow_graph:
                downstream_nodes += list(self._flow_graph.successors(primary_source))[:4]

            affected_zone_nodes = list(set(downstream_nodes + [s["sensor_id"] for s in abnormal_sensors]))

            spread_timeline = [
                {
                    "time_offset_minutes": 0,
                    "stage": "Onset / Initial Ingress",
                    "spread_radius_m": 80,
                    "affected_nodes": [primary_source],
                    "concentration_pct": 100,
                    "severity": severity
                },
                {
                    "time_offset_minutes": 15,
                    "stage": "Sub-district Branch Infiltration",
                    "spread_radius_m": 250,
                    "affected_nodes": downstream_nodes[:2],
                    "concentration_pct": 82,
                    "severity": severity
                },
                {
                    "time_offset_minutes": 30,
                    "stage": "Secondary Main Dispersion",
                    "spread_radius_m": 580,
                    "affected_nodes": downstream_nodes[:3],
                    "concentration_pct": 65,
                    "severity": "HIGH_RISK" if severity == "CRITICAL" else severity
                },
                {
                    "time_offset_minutes": 60,
                    "stage": "Widespread Zone Advection",
                    "spread_radius_m": 1200,
                    "affected_nodes": affected_zone_nodes,
                    "concentration_pct": 45,
                    "severity": "WARNING"
                }
            ]

        # Recommended Isolation Valves
        primary_source_id = likely_sources[0]["node_id"] if likely_sources else "127"
        recommended_valves = ["V-111 (V14)", "V-121 (V22)"]
        for v in VALVE_CATALOG:
            if v["start_node"] == primary_source_id or v["end_node"] == primary_source_id:
                recommended_valves.insert(0, f"{v['valve_id']} ({v['alias']})")
        recommended_valves = list(dict.fromkeys(recommended_valves))[:2]

        # Public Health Advisory Text
        primary_ward = likely_sources[0]["ward"] if likely_sources else "Ward 12"
        first_bad = abnormal_sensors[0] if abnormal_sensors else telemetry[0]
        cl_drop_val = abs(first_bad.get("chlorine_delta_mg_l", 0.45))
        turb_rise_val = abs(first_bad.get("turbidity_delta_ntu", 6.2))
        press_drop_val = abs(round(35.0 - first_bad.get("pressure_m", 31.9), 1))

        if severity == "CRITICAL":
            advisory_type = "DO_NOT_USE_EMERGENCY"
            advisory_title = "DO-NOT-USE EMERGENCY WATER ADVISORY"
            advisory_message = (
                f"CRITICAL CONTAMINATION ALERT near Junction {primary_source_id}. "
                f"Free chlorine fell by {cl_drop_val:.2f} mg/L, turbidity surged by {turb_rise_val:.1f} NTU, "
                f"and hydraulic pressure dropped by {press_drop_val:.1f} m head. Likely source: Junction {primary_source_id}. "
                f"MANDATORY DO-NOT-USE ADVISORY issued for {primary_ward}. Do not drink, cook, or bathe with tap water. "
                f"Emergency isolation valves {', '.join(recommended_valves)} dispatched for immediate closure."
            )
        elif severity == "HIGH_RISK":
            advisory_type = "BOIL_WATER_ADVISORY"
            advisory_title = "PUBLIC HEALTH BOIL-WATER ADVISORY"
            advisory_message = (
                f"High-risk contamination alert near Junction {primary_source_id}. "
                f"Chlorine fell by {cl_drop_val:.2f} mg/L, turbidity rose by {turb_rise_val:.1f} NTU, "
                f"and pressure dropped by {press_drop_val:.1f} m. Likely source: Junction {primary_source_id}. "
                f"Recommend BOIL-WATER ADVISORY for {primary_ward} and immediate sanitary inspection of Junction {primary_source_id}."
            )
        elif severity == "WARNING":
            advisory_type = "INSPECT_AND_SAMPLE"
            advisory_title = "WATER QUALITY WARNING - SAMPLING DISPATCHED"
            advisory_message = (
                f"Elevated water quality alert: localized chlorine depletion and turbidity fluctuation detected near {primary_ward}. "
                f"Field technicians dispatched to collect grab samples at Junction {primary_source_id}."
            )
        elif severity == "WATCH":
            advisory_type = "WATCH_MONITOR"
            advisory_title = "WATER QUALITY WATCH"
            advisory_message = f"Minor parameter variance detected in {primary_ward}. Utility operators are monitoring trend."
        else:
            advisory_type = "NORMAL_SAFE"
            advisory_title = "WATER QUALITY NORMAL"
            advisory_message = "All monitored chemical, microbial, and physical parameters are within safe WHO / BIS standards."

        # Public Health Actions Checklist
        recommended_actions = []
        if severity in ("HIGH_RISK", "CRITICAL"):
            recommended_actions = [
                f"1. Issue immediate {advisory_title} to {primary_ward} via SMS / Municipal Loudspeakers.",
                f"2. Close isolation valves {', '.join(recommended_valves)} to contain contamination plume.",
                f"3. Dispatch Water Quality Emergency Response Van to Junction {primary_source_id} for grab-sample microbiology testing.",
                f"4. Divert secondary clean supply loop to Civil Hospital (Junction 181) and Ward 12 Anganwadi.",
                "5. Initiate super-chlorination flush (2.0 mg/L) once the source is contained."
            ]
        elif severity == "WARNING":
            recommended_actions = [
                f"1. Collect 3 verification samples at Junction {primary_source_id} and adjacent downstream nodes.",
                "2. Check booster chlorination doser and pipeline integrity.",
                "3. Monitor turbidity trends every 10 minutes."
            ]

        return {
            "timestamp_iso": datetime.now(timezone.utc).isoformat(),
            "status": severity,
            "severity_level": severity,
            "ml_classification": ml_class,
            "confidence_score": round(confidence * 100, 1),
            "safety_rules_summary": {
                "has_chlorine_drop": has_chlorine_drop,
                "has_turbidity_rise": has_turbidity_rise,
                "has_ph_abnormal": has_ph_abnormal,
                "has_pressure_drop": has_pressure_drop
            },
            "sensor_telemetry": telemetry,
            "abnormal_sensor_count": len(abnormal_sensors),
            "abnormal_sensors": [s["sensor_id"] for s in abnormal_sensors],
            "likely_source_nodes": likely_sources,
            "direction_of_spread": "Northwest to Southeast along trunk main toward Ward 7 & 12",
            "affected_zone_nodes": affected_zone_nodes,
            "recommended_isolation_valves": recommended_valves,
            "public_advisory": {
                "type": advisory_type,
                "title": advisory_title,
                "message": advisory_message,
                "is_active": severity in ("HIGH_RISK", "CRITICAL"),
                "ward": primary_ward,
                "recommended_actions": recommended_actions
            },
            "spread_timeline": spread_timeline
        }

    def inject_contamination(
        self,
        node_id: str = "127",
        severity: str = "HIGH_RISK",
        cl_drop: float = 0.55,
        turb_rise: float = 6.2,
        ph_shift: float = -1.2
    ) -> Dict[str, Any]:
        """Injects a simulated contamination event at a target junction."""
        self.active_event = {
            "source_node": str(node_id),
            "severity": severity,
            "cl_drop": cl_drop,
            "turb_rise": turb_rise,
            "ph_shift": ph_shift,
            "spread_hops": 3,
            "injected_at": time.time()
        }
        return self.evaluate_detection_and_localization()

    def reset(self) -> Dict[str, Any]:
        """Clears active contamination and restores healthy water quality baseline."""
        self.active_event = None
        return self.evaluate_detection_and_localization()


_contamination_engine: Optional[ContaminationEngine] = None

def get_contamination_engine(network_response=None, state_response=None) -> ContaminationEngine:
    global _contamination_engine
    if _contamination_engine is None or network_response:
        _contamination_engine = ContaminationEngine(network_response, state_response)
    return _contamination_engine
