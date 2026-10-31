"""
dataset_generator_suite.py - Multi-Dataset Generator & ML Model Trainer for NirX.

Generates realistic simulated datasets matching the strict specification:
A. Leak detection and localisation dataset (enhanced with demand variation, valve ops, sensor noise)
B. Contamination dataset (4 classes: Normal, Contamination, Sensor Fault, Hydraulic Disturbance)
C. Valve-plan ranking dataset (multi-valve sets, critical facilities, household impacts, water saved)
D. Sewer overflow and flood dataset (rainfall scenarios, manhole dynamics, blockage, cross-contamination)
E. Data-quality requirements: Class imbalance, sensor noise, missing value scenarios, holdout test sets,
   feature importances for explainability.
"""

import os
import sys
import json
import time
import random
from typing import Dict, List, Tuple, Any

import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, r2_score

from simulation import SENSOR_NODES
from valve_prioritisation import CRITICAL_FACILITIES, VALVE_CATALOG, get_node_demographics
from sewer_flood_engine import SEWER_MANHOLES, SEWER_CONDUITS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)


# =============================================================================
# B. Contamination Dataset Generator
# =============================================================================
def generate_contamination_dataset(num_samples: int = 1200) -> pd.DataFrame:
    """
    Generates 4 classes of water quality telemetry records:
    1. NORMAL (60% - rare anomaly principle)
    2. SENSOR_FAULT (12% - single sensor wild deviation or stuck value)
    3. HYDRAULIC_DISTURBANCE (13% - pressure drop from valve/pump without chemical change)
    4. CONTAMINATION_EVENT (15% - multi-parameter chlorine crash + turbidity rise + pressure loss)
    """
    print(f"\n>>> Generating Contamination Dataset (B) with {num_samples} samples...")
    records = []
    rnd = np.random.default_rng(42)

    # All candidate junction nodes in Net3
    candidate_junctions = [
        "10", "15", "20", "35", "40", "50", "60", "101", "103", "105", "107", "109",
        "111", "113", "115", "117", "119", "121", "123", "125", "127", "129", "131",
        "141", "143", "149", "181", "195", "206", "217", "247"
    ]

    for i in range(num_samples):
        # Class distribution
        p = rnd.random()
        if p < 0.60:
            event_type = "NORMAL"
        elif p < 0.72:
            event_type = "SENSOR_FAULT"
        elif p < 0.85:
            event_type = "HYDRAULIC_DISTURBANCE"
        else:
            event_type = "CONTAMINATION_EVENT"

        # Baseline physical conditions
        time_of_day_hr = rnd.uniform(0.0, 24.0)
        daily_drift = 0.04 * np.sin(2 * np.pi * (time_of_day_hr - 8) / 24)
        rainfall_mm_h = rnd.choice([0.0, 0.0, 1.2, 5.0, 25.0]) if rnd.random() < 0.3 else 0.0
        sewer_overflow_alert = (rainfall_mm_h > 15.0 and rnd.random() < 0.4)

        # Baseline chemistry
        base_cl = 0.85 + daily_drift + rnd.normal(0.0, 0.03)
        base_turb = 1.2 + abs(rnd.normal(0.0, 0.15))
        base_ph = 7.35 + rnd.normal(0.0, 0.06)
        base_cond = 340.0 + rnd.normal(0.0, 8.0)
        base_orp = 680.0 + rnd.normal(0.0, 6.0)
        base_temp = 21.5 + rnd.normal(0.0, 0.4)
        base_press = 35.0 + rnd.normal(0.0, 0.5)
        base_flow = 145.0 + rnd.normal(0.0, 4.0)

        source_node = "NONE"
        affected_sensors_count = 0
        cl_rate_of_change = 0.0
        turb_rate_of_change = 0.0
        pressure_deviation = 0.0
        flow_deviation = 0.0

        if event_type == "NORMAL":
            chlorine = max(0.25, base_cl)
            turbidity = max(0.4, base_turb)
            ph = base_ph
            conductivity = base_cond
            orp = base_orp
            temp = base_temp
            pressure = base_press
            flow = base_flow
            affected_sensors_count = 0

        elif event_type == "SENSOR_FAULT":
            # Glitched sensor: e.g. pH pins to 14.0 or zero, or chlorine stuck at 0.00
            fault_mode = rnd.choice(["PH_OUTLIER", "CHLORINE_DROP_ONLY", "TURBIDITY_SPIKE_ONLY"])
            chlorine = base_cl
            turbidity = base_turb
            ph = base_ph
            conductivity = base_cond
            orp = base_orp
            temp = base_temp
            pressure = base_press
            flow = base_flow
            affected_sensors_count = 1  # Isolated single sensor fault

            if fault_mode == "PH_OUTLIER":
                ph = rnd.choice([1.2, 13.8])
            elif fault_mode == "CHLORINE_DROP_ONLY":
                chlorine = 0.01
                cl_rate_of_change = -0.80
            elif fault_mode == "TURBIDITY_SPIKE_ONLY":
                turbidity = 48.0
                turb_rate_of_change = 40.0

        elif event_type == "HYDRAULIC_DISTURBANCE":
            # Pressure and flow fluctuate sharply, but water chemistry stays normal!
            chlorine = max(0.3, base_cl)
            turbidity = max(0.5, base_turb + rnd.uniform(0.1, 0.5))  # slight shear
            ph = base_ph
            conductivity = base_cond
            orp = base_orp
            temp = base_temp
            pressure_deviation = rnd.uniform(-12.0, -4.0)
            pressure = base_press + pressure_deviation
            flow_deviation = rnd.uniform(-60.0, 40.0)
            flow = base_flow + flow_deviation
            affected_sensors_count = rnd.integers(2, 6)

        elif event_type == "CONTAMINATION_EVENT":
            source_node = str(rnd.choice(candidate_junctions))
            affected_sensors_count = rnd.integers(2, 6)
            # Synergistic chemical breakdown
            cl_drop = rnd.uniform(0.40, 0.75)
            chlorine = max(0.01, base_cl - cl_drop)
            cl_rate_of_change = -rnd.uniform(0.25, 0.60)

            turb_rise = rnd.uniform(4.0, 14.0)
            turbidity = base_turb + turb_rise
            turb_rate_of_change = rnd.uniform(2.5, 8.0)

            ph = max(4.5, min(9.5, base_ph + rnd.choice([-1.5, -0.9, 1.2])))
            conductivity = base_cond + rnd.uniform(120.0, 350.0)
            orp = max(320.0, base_orp - rnd.uniform(140.0, 260.0))
            temp = base_temp + rnd.uniform(0.5, 2.5)

            pressure_deviation = rnd.uniform(-6.5, -1.5)
            pressure = base_press + pressure_deviation
            flow_deviation = rnd.uniform(-20.0, 15.0)
            flow = base_flow + flow_deviation

        # Realistic Sensor Missing Value injection (2% of samples)
        if rnd.random() < 0.02 and event_type == "NORMAL":
            orp = np.nan

        time_since_onset_min = rnd.uniform(5.0, 180.0) if event_type != "NORMAL" else 0.0

        records.append({
            "sample_id": f"WQ-{i:05d}",
            "event_type": event_type,
            "source_node": source_node,
            "free_chlorine_mg_l": round(chlorine, 3),
            "chlorine_rate_of_change": round(cl_rate_of_change, 3),
            "turbidity_ntu": round(turbidity, 2),
            "turbidity_rate_of_change": round(turb_rate_of_change, 2),
            "ph": round(ph, 2),
            "conductivity_us_cm": round(conductivity, 1),
            "orp_mv": round(orp, 1) if not np.isnan(orp) else 650.0,
            "temperature_c": round(temp, 1),
            "pressure_m": round(pressure, 2),
            "pressure_deviation_m": round(pressure_deviation, 2),
            "flow_lmin": round(flow, 1),
            "flow_deviation_lmin": round(flow_deviation, 1),
            "affected_sensors_count": int(affected_sensors_count),
            "time_since_onset_min": round(time_since_onset_min, 1),
            "rainfall_mm_h": round(rainfall_mm_h, 1),
            "sewer_overflow_alert": int(sewer_overflow_alert),
            "time_of_day_hr": round(time_of_day_hr, 1),
            "recommended_advisory": (
                "DO_NOT_USE" if event_type == "CONTAMINATION_EVENT" and chlorine < 0.1
                else "BOIL_WATER" if event_type == "CONTAMINATION_EVENT"
                else "INSPECT_SENSOR" if event_type == "SENSOR_FAULT"
                else "MONITOR_HYDRAULICS" if event_type == "HYDRAULIC_DISTURBANCE"
                else "NONE"
            )
        })

    df = pd.DataFrame(records)
    csv_path = os.path.join(DATA_DIR, "contamination_dataset.csv")
    df.to_csv(csv_path, index=False)
    print(f"    Saved Contamination Dataset: {csv_path} ({len(df)} rows)")
    return df


# =============================================================================
# C. Valve-Plan Ranking Dataset Generator
# =============================================================================
def generate_valve_plan_dataset(num_samples: int = 800) -> pd.DataFrame:
    """
    Generates training records for rapid valve plan scoring and ranking:
    - Event location and type
    - Candidate valve combination (1, 2, or 3 valves)
    - Households and critical facilities impacted
    - Water conservation and hydraulic pressure retention
    - Final composite plan score
    """
    print(f"\n>>> Generating Valve Plan Ranking Dataset (C) with {num_samples} samples...")
    records = []
    rnd = np.random.default_rng(101)

    candidate_junctions = [
        "10", "15", "105", "117", "121", "123", "127", "129", "149", "181", "195", "206", "217", "247"
    ]
    candidate_valves = [v["valve_id"] for v in VALVE_CATALOG]

    for i in range(num_samples):
        event_node = str(rnd.choice(candidate_junctions))
        event_type = rnd.choice(["PIPE_BURST", "MAJOR_LEAK", "SEWAGE_INGRESS", "CHEMICAL_CONTAMINATION"])
        severity_lph = rnd.uniform(8000.0, 65000.0)
        demand_multiplier = rnd.uniform(0.8, 1.3)

        # Pick 1, 2, or 3 valves
        num_valves = rnd.choice([1, 2, 2, 3])
        valves_chosen = sorted(list(rnd.choice(candidate_valves, size=num_valves, replace=False)))
        valves_str = "+".join(valves_chosen)

        # Realistic simulation outcome modeling
        # Closer match of valve set to incident pipes produces better isolation
        is_isolated = (rnd.random() < (0.85 if num_valves >= 2 else 0.40))
        
        # Households affected
        base_hh = rnd.integers(40, 320) * num_valves
        # If hospital (node 181) or school (123) is in cut zone
        hospital_protected = not ("V-121" in valves_chosen and "V-161" in valves_chosen and rnd.random() < 0.25)
        school_protected = not ("V-111" in valves_chosen and "V-112" in valves_chosen and rnd.random() < 0.20)
        critical_fac_lost = (0 if hospital_protected else 1) + (0 if school_protected else 1)

        water_saved_lph = severity_lph * (rnd.uniform(0.88, 0.98) if is_isolated else rnd.uniform(0.15, 0.45))
        min_pressure_m = max(6.0, 32.0 - num_valves * rnd.uniform(2.0, 4.5))

        # Composite plan score
        score = 80.0
        score += 25.0 if is_isolated else -45.0
        score -= critical_fac_lost * 45.0
        score -= min(25.0, base_hh * 0.04)
        score += min(15.0, (water_saved_lph / 20000.0) * 5.0)
        score -= num_valves * 2.5
        score = max(5.0, min(99.5, score + rnd.normal(0.0, 1.5)))

        records.append({
            "plan_id": f"VP-{i:05d}",
            "event_location": event_node,
            "event_type": event_type,
            "severity_lph": round(severity_lph, 1),
            "demand_multiplier": round(demand_multiplier, 2),
            "candidate_valves": valves_str,
            "valve_count": num_valves,
            "is_event_isolated": int(is_isolated),
            "households_affected": int(base_hh),
            "hospital_protected": int(hospital_protected),
            "school_protected": int(school_protected),
            "critical_facilities_lost_count": int(critical_fac_lost),
            "water_saved_lph": round(water_saved_lph, 1),
            "min_remaining_pressure_m": round(min_pressure_m, 1),
            "expected_repair_hours": round(2.0 + num_valves * 0.5 + (0.8 if base_hh > 200 else 0.0), 1),
            "plan_score": round(score, 1)
        })

    df = pd.DataFrame(records)
    csv_path = os.path.join(DATA_DIR, "valve_plans_dataset.csv")
    df.to_csv(csv_path, index=False)
    print(f"    Saved Valve Plan Dataset: {csv_path} ({len(df)} rows)")
    return df


# =============================================================================
# D. Sewer Overflow and Flood-Warning Dataset Generator
# =============================================================================
def generate_sewer_flood_dataset(num_samples: int = 1000) -> pd.DataFrame:
    """
    Generates training records for predicting sewer overflow and drinking-water cross contamination:
    - Rainfall intensity (15m, 30m, 60m) and forecasts (1h, 2h, 6h)
    - Manhole physical telemetry (level, rise rate, base flow)
    - Drain blockages and pump failure states
    - Overflow occurrence within 1h, 2h, 6h
    - Drinking-water ingress contamination risk label
    """
    print(f"\n>>> Generating Sewer Overflow & Flood Dataset (D) with {num_samples} samples...")
    records = []
    rnd = np.random.default_rng(202)

    manholes = [mh["id"] for mh in SEWER_MANHOLES]

    for i in range(num_samples):
        mh_id = rnd.choice(manholes)
        mh_def = next(m for m in SEWER_MANHOLES if m["id"] == mh_id)

        # Storm intensity tier
        rain_tier = rnd.choice(["CLEAR", "LIGHT", "MODERATE", "HEAVY", "EXTREME"], p=[0.40, 0.25, 0.20, 0.10, 0.05])

        if rain_tier == "CLEAR":
            rain_15m = 0.0
            rain_30m = 0.0
            rain_60m = 0.0
            fc_1h = rnd.uniform(0.0, 1.0)
            fc_2h = rnd.uniform(0.0, 2.0)
            fc_6h = rnd.uniform(0.0, 3.0)
        elif rain_tier == "LIGHT":
            rain_15m = rnd.uniform(1.0, 5.0)
            rain_30m = rnd.uniform(1.0, 4.0)
            rain_60m = rnd.uniform(0.5, 3.0)
            fc_1h = rnd.uniform(2.0, 6.0)
            fc_2h = rnd.uniform(1.0, 4.0)
            fc_6h = rnd.uniform(0.0, 2.0)
        elif rain_tier == "MODERATE":
            rain_15m = rnd.uniform(8.0, 20.0)
            rain_30m = rnd.uniform(6.0, 18.0)
            rain_60m = rnd.uniform(5.0, 15.0)
            fc_1h = rnd.uniform(10.0, 25.0)
            fc_2h = rnd.uniform(8.0, 20.0)
            fc_6h = rnd.uniform(4.0, 12.0)
        elif rain_tier == "HEAVY":
            rain_15m = rnd.uniform(25.0, 48.0)
            rain_30m = rnd.uniform(22.0, 45.0)
            rain_60m = rnd.uniform(18.0, 38.0)
            fc_1h = rnd.uniform(30.0, 55.0)
            fc_2h = rnd.uniform(25.0, 45.0)
            fc_6h = rnd.uniform(12.0, 25.0)
        else:  # EXTREME
            rain_15m = rnd.uniform(55.0, 90.0)
            rain_30m = rnd.uniform(50.0, 80.0)
            rain_60m = rnd.uniform(40.0, 70.0)
            fc_1h = rnd.uniform(60.0, 95.0)
            fc_2h = rnd.uniform(50.0, 80.0)
            fc_6h = rnd.uniform(25.0, 50.0)

        drain_blocked = int(rnd.random() < 0.12)
        pump_failed = int(rnd.random() < 0.08)

        # Hydraulic dynamics
        c_factor = mh_def["impervious_pct"] * 0.88 + 0.10
        runoff_lps = (c_factor * rain_15m * mh_def["catchment_ha"] * 10.0) / 3.6
        capacity_lps = mh_def["base_flow_lps"] * 4.5 * (0.35 if drain_blocked else 1.0) * (0.50 if pump_failed else 1.0)

        net_lps = (mh_def["base_flow_lps"] + runoff_lps) - capacity_lps
        rise_rate_m_hr = max(0.0, net_lps / 70.0)

        starting_depth = mh_def["depth_m"]
        overflow_thresh = mh_def["overflow_threshold_m"]
        curr_level = min(starting_depth, 0.75 + (rise_rate_m_hr * rnd.uniform(0.4, 0.9)))

        # Ground elevation and depression effect
        is_low_elevation = mh_def["elevation_m"] < 16.0

        # Overflow outcomes
        overflown_1h = int(curr_level + rise_rate_m_hr * 1.0 >= overflow_thresh or (rain_tier in ("HEAVY", "EXTREME") and drain_blocked))
        overflown_2h = int(overflown_1h or (curr_level + rise_rate_m_hr * 2.0 >= overflow_thresh) or rain_tier == "EXTREME")
        overflown_6h = int(overflown_2h or (fc_6h > 15.0 and is_low_elevation))

        # Severity
        if overflown_1h or (overflown_2h and rain_tier in ("HEAVY", "EXTREME")):
            flood_severity = "CRITICAL"
        elif overflown_2h or rain_tier in ("HEAVY", "MODERATE"):
            flood_severity = "WARNING"
        elif overflown_6h or rain_tier == "LIGHT":
            flood_severity = "WATCH"
        else:
            flood_severity = "NORMAL"

        # Drinking water cross contamination threat
        # Higher if manhole overflows and is adjacent to trunk main
        drinking_pipe_pressure_m = rnd.uniform(12.0, 36.0)
        contamination_risk = int(
            (overflown_2h == 1 and drinking_pipe_pressure_m < 20.0) or
            (overflown_1h == 1 and rnd.random() < 0.75)
        )

        records.append({
            "record_id": f"SF-{i:05d}",
            "manhole_id": mh_id,
            "ward": mh_def["ward"],
            "elevation_m": mh_def["elevation_m"],
            "depth_m": starting_depth,
            "current_water_level_m": round(curr_level, 2),
            "rise_rate_m_hr": round(rise_rate_m_hr, 2),
            "rain_last_15m_mm_h": round(rain_15m, 1),
            "rain_last_30m_mm_h": round(rain_30m, 1),
            "rain_last_60m_mm_h": round(rain_60m, 1),
            "forecast_1h_mm_h": round(fc_1h, 1),
            "forecast_2h_mm_h": round(fc_2h, 1),
            "forecast_6h_mm_h": round(fc_6h, 1),
            "drain_blocked": drain_blocked,
            "pump_offline": pump_failed,
            "historical_waterlogging": mh_def["historical_waterlogging_freq"],
            "nearby_water_main": mh_def["nearby_water_main"],
            "overflow_in_1h": overflown_1h,
            "overflow_in_2h": overflown_2h,
            "overflow_in_6h": overflown_6h,
            "flood_severity": flood_severity,
            "drinking_water_contamination_risk": contamination_risk,
            "action_required": "DEPLOY_JETTING_CREW" if drain_blocked else "ACTIVATE_PUMP" if pump_failed else "MONITOR"
        })

    df = pd.DataFrame(records)
    csv_path = os.path.join(DATA_DIR, "sewer_flood_dataset.csv")
    df.to_csv(csv_path, index=False)
    print(f"    Saved Sewer Flood Dataset: {csv_path} ({len(df)} rows)")
    return df


# =============================================================================
# E. Train Models & Feature Importances for Explainability
# =============================================================================
def train_and_export_additional_models():
    """
    Trains and serializes:
    1. Contamination Anomaly Classifier (RandomForest) -> models/contamination_clf.joblib
    2. Sewer Overflow 2h Predictor (RandomForest) -> models/sewer_overflow_clf.joblib
    Computes explainable feature importance matrices and holdout test metrics.
    """
    print("\n>>> Training ML Models on newly generated datasets...")

    # 1. Contamination Classifier
    c_csv = os.path.join(DATA_DIR, "contamination_dataset.csv")
    if os.path.exists(c_csv):
        df_c = pd.read_csv(c_csv)
        features_c = [
            "free_chlorine_mg_l", "chlorine_rate_of_change", "turbidity_ntu", "turbidity_rate_of_change",
            "ph", "conductivity_us_cm", "orp_mv", "temperature_c", "pressure_m",
            "pressure_deviation_m", "flow_deviation_lmin", "affected_sensors_count", "rainfall_mm_h"
        ]
        X = df_c[features_c].fillna(df_c[features_c].mean())
        y = df_c["event_type"]

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        clf_c = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
        clf_c.fit(X_train, y_train)

        acc = accuracy_score(y_test, clf_c.predict(X_test))
        importances_c = dict(zip(features_c, [round(float(v), 4) for v in clf_c.feature_importances_]))

        joblib.dump(clf_c, os.path.join(MODELS_DIR, "contamination_clf.joblib"))
        print(f"    Contamination Classifier trained. Test Accuracy: {acc:.4f}")
        print(f"    Top Feature Importances: {sorted(importances_c.items(), key=lambda x: x[1], reverse=True)[:4]}")

        # Save explainability metadata
        with open(os.path.join(MODELS_DIR, "contamination_metadata.json"), "w") as f:
            json.dump({
                "model": "RandomForestClassifier",
                "accuracy": acc,
                "classes": list(clf_c.classes_),
                "features": features_c,
                "feature_importances": importances_c,
                "trained_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }, f, indent=2)

    # 2. Sewer Overflow 2h Classifier
    s_csv = os.path.join(DATA_DIR, "sewer_flood_dataset.csv")
    if os.path.exists(s_csv):
        df_s = pd.read_csv(s_csv)
        features_s = [
            "elevation_m", "current_water_level_m", "rise_rate_m_hr",
            "rain_last_15m_mm_h", "rain_last_30m_mm_h", "rain_last_60m_mm_h",
            "forecast_1h_mm_h", "forecast_2h_mm_h", "drain_blocked", "pump_offline"
        ]
        X = df_s[features_s]
        y = df_s["overflow_in_2h"]

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        clf_s = RandomForestClassifier(n_estimators=80, max_depth=8, random_state=42)
        clf_s.fit(X_train, y_train)

        acc_s = accuracy_score(y_test, clf_s.predict(X_test))
        importances_s = dict(zip(features_s, [round(float(v), 4) for v in clf_s.feature_importances_]))

        joblib.dump(clf_s, os.path.join(MODELS_DIR, "sewer_overflow_clf.joblib"))
        print(f"    Sewer Overflow Predictor trained. Test Accuracy: {acc_s:.4f}")
        print(f"    Top Feature Importances: {sorted(importances_s.items(), key=lambda x: x[1], reverse=True)[:4]}")

        with open(os.path.join(MODELS_DIR, "sewer_metadata.json"), "w") as f:
            json.dump({
                "model": "RandomForestClassifier",
                "target": "overflow_in_2h",
                "accuracy": acc_s,
                "features": features_s,
                "feature_importances": importances_s,
                "trained_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }, f, indent=2)

    print("\n>>> All additional datasets and models exported successfully!")


if __name__ == "__main__":
    generate_contamination_dataset(1200)
    generate_valve_plan_dataset(800)
    generate_sewer_flood_dataset(1000)
    train_and_export_additional_models()
