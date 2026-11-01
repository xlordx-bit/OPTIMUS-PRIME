"""
state.py - In-Memory Live Digital Twin State & ML Inference Orchestration.

Maintains live state of the physical water network simulation:
- Tracks baseline healthy telemetry vs current active hydraulic state.
- Stores active leak details (if injected).
- Runs trained ML models (Detector, Localizer, Sizer) on real-time sensor drops.
- Generates automated dispatch Work Orders for field response.
"""

import os
import json
import time
import random
import uuid
from typing import Dict, List, Optional, Tuple

import numpy as np
import joblib

from simulation import WaterNetworkEngine, SENSOR_NODES
from schemas import (
    NetworkResponse,
    StateResponse,
    StateSummary,
    SensorState,
    ActiveLeakInfo,
    InjectLeakRequest,
    InjectLeakResponse,
    DetectResponse,
    SuspectNode,
    WorkOrderTemplate,
    ResetResponse,
    Coordinates2D
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")


class DigitalTwinState:
    """Singleton managing in-memory hydraulic state and ML inference."""

    def __init__(self):
        print(">>> Initializing NirX Digital Twin Engine and WNTR Simulator...")
        self.engine = WaterNetworkEngine()

        # Hydraulic status
        self.is_healthy: bool = True
        self.active_leak: Optional[ActiveLeakInfo] = None
        self.current_node_pressures: Dict[str, float] = dict(self.engine.baseline_node_pressures)
        self.current_sensor_noise: Dict[str, float] = {s: 0.0 for s in SENSOR_NODES}

        # ML Models, Fusion Parameters, and Config
        self.detector_iso = None
        self.detector_clf = None
        self.localizer_clf = None
        self.sizer_reg = None
        self.model_metadata = None
        self.fusion_params = None
        self.alert_threshold: float = 0.5   # Configurable alert threshold
        self.noise_std_meters: float = 0.5  # Noise scaling factor for physics evidence
        self._load_ml_models()

    def _load_ml_models(self):
        """Loads serialized scikit-learn models and fusion configuration from backend/models/."""
        try:
            iso_path = os.path.join(MODELS_DIR, "detector_iso.joblib")
            clf_path = os.path.join(MODELS_DIR, "detector_clf.joblib")
            loc_path = os.path.join(MODELS_DIR, "localizer_clf.joblib")
            sz_path = os.path.join(MODELS_DIR, "sizer_reg.joblib")
            meta_path = os.path.join(MODELS_DIR, "metadata.json")
            fusion_path = os.path.join(MODELS_DIR, "fusion_params.json")

            if os.path.exists(iso_path):
                self.detector_iso = joblib.load(iso_path)
            if os.path.exists(clf_path):
                self.detector_clf = joblib.load(clf_path)
            if os.path.exists(loc_path):
                self.localizer_clf = joblib.load(loc_path)
            if os.path.exists(sz_path):
                self.sizer_reg = joblib.load(sz_path)
            if os.path.exists(meta_path):
                with open(meta_path, "r") as f:
                    self.model_metadata = json.load(f)
            if os.path.exists(fusion_path):
                with open(fusion_path, "r") as f:
                    self.fusion_params = json.load(f)
                    if "alert_threshold" in self.fusion_params:
                        self.alert_threshold = float(self.fusion_params["alert_threshold"])
                    if "phys_calibrator" in self.fusion_params and "noise_std_meters" in self.fusion_params["phys_calibrator"]:
                        self.noise_std_meters = float(self.fusion_params["phys_calibrator"]["noise_std_meters"])

            print(">>> Successfully loaded trained ML models and soft fusion parameters into memory.")
        except Exception as e:
            print(f"Warning: Could not load ML models ({e}). Heuristics will be used until models are ready.")

    def get_network_layout(self) -> NetworkResponse:
        """Returns static layout of nodes, pipes, pumps, tanks, and sensors."""
        return self.engine.get_static_network()

    def get_current_sensor_drops(self) -> Tuple[List[float], Dict[str, float]]:
        """
        Calculates pressure drops across the 12 fixed sensors.
        Returns (feature_vector_list, drops_by_sensor_dict).
        """
        drops_dict = {}
        features = []
        for s_id in SENSOR_NODES:
            base_p = self.engine.baseline_sensor_pressures.get(s_id, 40.0)
            curr_p = self.current_node_pressures.get(s_id, base_p)
            drop = base_p - curr_p
            # Add small telemetry noise
            noisy_drop = drop + self.current_sensor_noise.get(s_id, 0.0)
            drops_dict[s_id] = noisy_drop
            features.append(noisy_drop)
        return features, drops_dict

    def get_state_response(self) -> StateResponse:
        """Generates dynamic telemetry snapshot for GET /state."""
        features, drops_dict = self.get_current_sensor_drops()
        static_net = self.engine.get_static_network()
        node_lookup = {n.id: n for n in static_net.nodes}

        sensor_states: List[SensorState] = []
        total_p = 0.0
        max_drop = 0.0
        dropped_sensors_count = 0

        for s_id in SENSOR_NODES:
            base_p = self.engine.baseline_sensor_pressures.get(s_id, 40.0)
            curr_p = self.current_node_pressures.get(s_id, base_p)
            drop = drops_dict.get(s_id, 0.0)
            noise = self.current_sensor_noise.get(s_id, 0.0)

            total_p += curr_p
            if drop > max_drop:
                max_drop = drop
            if drop >= 1.0:
                dropped_sensors_count += 1

            status = "NORMAL"
            if drop >= 2.0:
                status = "CRITICAL"
            elif drop >= 0.8:
                status = "WARNING"

            node_meta = node_lookup.get(s_id)
            coords = node_meta.coordinates if node_meta else Coordinates2D(x=0.0, y=0.0)
            lat_lng = node_meta.lat_lng if node_meta else [37.7749, -122.4194]

            sensor_states.append(
                SensorState(
                    node_id=s_id,
                    coordinates=coords,
                    lat_lng=lat_lng,
                    current_pressure_m=round(curr_p, 2),
                    baseline_pressure_m=round(base_p, 2),
                    pressure_drop_m=round(drop, 2),
                    sensor_noise_m=round(noise, 2),
                    status=status
                )
            )

        mean_p = total_p / len(SENSOR_NODES) if SENSOR_NODES else 0.0
        active_flow_lph = self.active_leak.actual_leak_flow_lph if self.active_leak else 0.0

        summary = StateSummary(
            mean_sensor_pressure_m=round(mean_p, 2),
            max_pressure_drop_m=round(max_drop, 2),
            total_leakage_flow_lph=round(active_flow_lph, 1),
            sensors_with_pressure_drop_count=dropped_sensors_count
        )

        return StateResponse(
            timestamp_iso=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            simulation_duration_hours=6.0,
            is_healthy=self.is_healthy,
            is_leak_injected=(not self.is_healthy and self.active_leak is not None),
            active_leak=self.active_leak,
            summary=summary,
            sensors=sensor_states,
            all_node_pressures={k: round(v, 2) for k, v in self.current_node_pressures.items()}
        )

    def inject_leak(self, req: InjectLeakRequest) -> InjectLeakResponse:
        """Injects a physical orifice leak into WNTR simulation and updates live state."""
        target_node = str(req.node_id).strip()
        static_net = self.engine.get_static_network()
        valid_junction_ids = {n.id for n in static_net.nodes if n.type == "junction"}

        if target_node not in valid_junction_ids:
            raise ValueError(f"Target node '{target_node}' is not a valid demand junction in Net3.")

        print(f">>> Simulating leak injection: Node {target_node}, Area {req.leak_area} m^2...")
        pressures, leak_flow_lph = self.engine.simulate_leak_state(
            target_node=target_node,
            leak_area=req.leak_area,
            start_time_seconds=req.start_time_seconds
        )

        self.current_node_pressures = pressures
        self.is_healthy = False

        # Add small realistic sensor telemetry jitter
        self.current_sensor_noise = {
            s: float(np.random.normal(0.0, 0.2)) for s in SENSOR_NODES
        }

        self.active_leak = ActiveLeakInfo(
            node_id=target_node,
            leak_area_m2=float(req.leak_area),
            actual_leak_flow_lph=round(leak_flow_lph, 1),
            injected_at_hour=round(req.start_time_seconds / 3600.0, 2)
        )

        # Max drop calculation
        features, _ = self.get_current_sensor_drops()
        max_drop = float(max(features)) if features else 0.0

        return InjectLeakResponse(
            success=True,
            message=f"Leak successfully injected at Node {target_node} ({req.leak_area} m² orifice).",
            injected_node=target_node,
            leak_area_m2=float(req.leak_area),
            actual_leak_flow_lph=round(leak_flow_lph, 1),
            max_pressure_drop_m=round(max_drop, 2),
            active_leak=self.active_leak
        )

    def detect_leak(self) -> DetectResponse:
        """
        Executes ML pipeline on current telemetry:
        - Detector evaluates anomaly score / leak probability.
        - Localizer outputs top 3 suspect nodes with probabilities.
        - Sizer estimates leak volume in Liters/Hour.
        - Generates automated WorkOrderTemplate if leak is detected.
        """
        features, _ = self.get_current_sensor_drops()
        X = np.array([features])
        max_sensor_drop = max(features) if features else 0.0

        leak_detected = False
        anomaly_score = 0.0
        confidence = 0.5
        est_lph = 0.0
        est_area = 0.0
        top_suspects: List[SuspectNode] = []
        work_order: Optional[WorkOrderTemplate] = None

        static_net = self.engine.get_static_network()
        node_lookup = {n.id: n for n in static_net.nodes}

        # 1. Detection Phase with Soft Fusion in Log-Odds Space
        iso_raw = 0.0
        if self.detector_iso is not None:
            iso_raw = float(self.detector_iso.decision_function(X)[0])

        fused_prob = 0.5
        if self.detector_clf is not None:
            # 1a. Calibrated Classifier probability
            p_rf = float(self.detector_clf.predict_proba(X)[0][1])

            # 1b. Convert Isolation Forest score into anomaly probability via calibrated scaling
            iso_b = float(self.fusion_params["iso_calibrator"]["intercept"]) if self.fusion_params else 1.0395
            iso_w = float(self.fusion_params["iso_calibrator"]["coef"]) if self.fusion_params else -4.2459
            p_iso = float(1.0 / (1.0 + np.exp(-(iso_b + iso_w * iso_raw))))

            # 1c. Convert Physics evidence into probability (logistic function of max dP scaled by noise level)
            phys_b = float(self.fusion_params["phys_calibrator"]["intercept"]) if self.fusion_params else -1.6791
            phys_w = float(self.fusion_params["phys_calibrator"]["coef"]) if self.fusion_params else 1.0300
            z_phys = float(max_sensor_drop / max(0.01, self.noise_std_meters))
            p_phys = float(1.0 / (1.0 + np.exp(-(phys_b + phys_w * z_phys))))

            # 1d. Combine all three in log-odds space with learned weights
            eps = 1e-4
            clip_rf = max(eps, min(1.0 - eps, p_rf))
            clip_iso = max(eps, min(1.0 - eps, p_iso))
            clip_phys = max(eps, min(1.0 - eps, p_phys))

            logit_rf = float(np.log(clip_rf / (1.0 - clip_rf)))
            logit_iso = float(np.log(clip_iso / (1.0 - clip_iso)))
            logit_phys = float(np.log(clip_phys / (1.0 - clip_phys)))

            w = self.fusion_params["fusion_weights"] if self.fusion_params else {
                "w_rf": 0.7616, "w_iso": 0.0172, "w_phys": 0.7793, "intercept": -0.3018
            }
            fused_logit = w["intercept"] + w["w_rf"] * logit_rf + w["w_iso"] * logit_iso + w["w_phys"] * logit_phys
            fused_prob = float(1.0 / (1.0 + np.exp(-fused_logit)))

            # Only threshold is the final alert level kept in config
            leak_detected = fused_prob >= self.alert_threshold
            # Show actual fused probability (no confidence floor) and actual Isolation Forest score (no adjustment)
            confidence = fused_prob
            anomaly_score = iso_raw
        else:
            # Fallback heuristic if models are not present
            z_phys = max_sensor_drop / max(0.01, self.noise_std_meters)
            fused_prob = float(1.0 / (1.0 + np.exp(-(z_phys - 2.0))))
            leak_detected = fused_prob >= self.alert_threshold
            confidence = fused_prob
            anomaly_score = -max_sensor_drop

        # 2. Localization Phase (Runs on EVERY reading with no gating)
        if self.localizer_clf is not None:
            probs = self.localizer_clf.predict_proba(X)[0]
            classes = self.localizer_clf.classes_

            top3_indices = np.argsort(probs)[-3:][::-1]
            for rank_idx, cls_idx in enumerate(top3_indices, start=1):
                candidate_id = str(classes[cls_idx])
                node_prob = float(probs[cls_idx])
                node_meta = node_lookup.get(candidate_id)

                coords = node_meta.coordinates if node_meta else Coordinates2D(x=0.0, y=0.0)
                lat_lng = node_meta.lat_lng if node_meta else [37.7749, -122.4194]

                top_suspects.append(
                    SuspectNode(
                        node_id=candidate_id,
                        probability=round(node_prob, 3),
                        rank=rank_idx,
                        coordinates=coords,
                        lat_lng=lat_lng
                    )
                )

        # 3. Sizing Phase (Runs on EVERY reading with no gating)
        if self.sizer_reg is not None:
            est_lph = max(0.0, float(self.sizer_reg.predict(X)[0]))
        else:
            est_lph = max(0.0, float(max_sensor_drop * 45000.0))

        est_area = round(est_lph / (3.6e6 * 0.75 * np.sqrt(2 * 9.81 * 35.0)), 6) if est_lph > 0 else 0.0

        # 4. Generate Work Order Template (Only if alert threshold is triggered)
        if leak_detected and top_suspects:
            primary_node = top_suspects[0].node_id
            candidates = [s.node_id for s in top_suspects]
            prio = "CRITICAL" if est_lph > 100000 else "HIGH"

            work_order = WorkOrderTemplate(
                work_order_id=f"WO-NIRX-{time.strftime('%Y%m%d')}-{random.randint(1000, 9999)}",
                created_at_iso=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                priority=prio,
                status="PENDING_DISPATCH",
                incident_type="WATER_MAIN_BURST",
                primary_suspect_node=primary_node,
                candidate_suspect_nodes=candidates,
                estimated_water_loss_lph=round(est_lph, 1),
                recommended_action=f"Dispatch maintenance crew to inspect Junction {primary_node} and isolating valves.",
                isolation_valve_recommendation=f"Prepare to isolate upstream links to Junction {primary_node} if acoustic correlation confirms rupture."
            )

        return DetectResponse(
            leak_detected=leak_detected,
            detector_model="Soft Fusion (Calibrated RF + IsoForest + Physics Evidence)",
            anomaly_score=round(anomaly_score, 4),
            confidence=round(confidence, 4),
            estimated_leak_rate_lph=round(est_lph, 1),
            estimated_leak_area_m2=est_area,
            top_suspects=top_suspects,
            work_order_template=work_order
        )

    def reset(self) -> ResetResponse:
        """Restores network twin to baseline healthy operation."""
        print(">>> Resetting digital twin to baseline healthy state...")
        self.is_healthy = True
        self.active_leak = None
        self.current_node_pressures = dict(self.engine.baseline_node_pressures)
        self.current_sensor_noise = {s: 0.0 for s in SENSOR_NODES}

        state_snapshot = self.get_state_response()

        return ResetResponse(
            success=True,
            message="Water network successfully reset to baseline healthy state.",
            reset_at_iso=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            state=state_snapshot
        )


# Global singleton instance
digital_twin_state = DigitalTwinState()
