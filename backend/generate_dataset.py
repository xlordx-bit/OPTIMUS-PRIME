"""
generate_dataset.py - NirX Synthetic Leak Dataset Generator & ML Model Trainer.

Simulates 400 leak scenarios and 150 no-leak baseline scenarios on EPANET Net3
using WNTR (Pressure Dependent Demand - PDD model, 6-hour simulation).
Adds 0.5m Gaussian sensor noise to simulate real-world telemetry noise.

Trains:
1. Detector: IsolationForest + Binary Classifier for leak anomaly scoring.
2. Localizer: RandomForestClassifier for top-3 suspect node ranking with probabilities.
3. Sizer: RandomForestRegressor for estimating leak rate in Liters/Hour (L/h).

Saves models and metadata into backend/models/ for live inference in main.py.
"""

import os
import sys
import json
import time
import random
import multiprocessing
from typing import List, Dict, Any, Tuple

import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import IsolationForest, RandomForestClassifier, RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, r2_score, accuracy_score

# WNTR Hydraulic Engine
import wntr


# ---------------------------------------------------------------------------
# Constants & Sensor Topology
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODELS_DIR = os.path.join(BASE_DIR, "models")
INP_PATH = os.path.join(DATA_DIR, "Net3.inp")
DATASET_CSV = os.path.join(DATA_DIR, "leak_dataset.csv")
METADATA_PATH = os.path.join(MODELS_DIR, "metadata.json")

# 12 fixed sensor nodes spatially distributed across Net3 network quadrants
SENSOR_NODES = [
    "10",   # Northwest inlet / high elevation
    "15",   # Northeast boundary
    "105",  # Northwest interior
    "117",  # Central-west distribution
    "123",  # North-central hub
    "129",  # Northeast elevated zone
    "149",  # Central hub
    "181",  # Southwest interior
    "195",  # Central-south distribution
    "206",  # South trunk
    "217",  # Southeast perimeter
    "247"   # Far south boundary
]

SIMULATION_DURATION_SECONDS = 6 * 3600  # 6 hours
EVAL_TIME_STEP_SECONDS = 6 * 3600       # Final steady-state time step (hour 6)
NOISE_STD_METERS = 0.5                  # 0.5m Gaussian noise as requested


# ---------------------------------------------------------------------------
# Multiprocessing Worker Function
# Must be defined at module level for Windows pickle compatibility
# ---------------------------------------------------------------------------
def simulate_single_scenario(args: Tuple) -> Dict[str, Any]:
    """
    Executes a single 6-hour WNTR PDD simulation for either a leak or no-leak case.
    Runs inside a multiprocessing pool worker process.
    """
    scenario_id, inp_file, target_node, leak_area, sensor_list, baseline_pressures = args

    try:
        # Load independent network model instance in worker
        wn = wntr.network.WaterNetworkModel(inp_file)
        wn.options.hydraulic.demand_model = 'PDD'
        wn.options.time.duration = SIMULATION_DURATION_SECONDS

        is_leak = 1 if (target_node is not None and leak_area > 0.0) else 0

        if is_leak:
            node = wn.get_node(target_node)
            # Add orifice leak: discharge coeff = 0.75, active from start
            node.add_leak(wn, area=leak_area, discharge_coeff=0.75, start_time=0)

        # Run WNTR hydraulic solver
        sim = wntr.sim.WNTRSimulator(wn)
        results = sim.run_sim()

        # Extract pressures at sensors at evaluation timestamp
        pressures = results.node['pressure'].loc[EVAL_TIME_STEP_SECONDS, sensor_list].to_dict()

        # Extract actual leak flow in L/h (1 m^3/s = 3.6e6 L/h)
        if is_leak and target_node in results.node.get('leak_demand', {}):
            leak_demand_m3s = results.node['leak_demand'].loc[EVAL_TIME_STEP_SECONDS, target_node]
            leak_flow_lph = float(leak_demand_m3s * 3.6e6)
        else:
            leak_flow_lph = 0.0

        # Calculate pressure drops: baseline - simulated + random Gaussian noise
        scenario_record = {
            "scenario_id": scenario_id,
            "is_leak": is_leak,
            "target_node": target_node if is_leak else "NO_LEAK",
            "leak_area_m2": float(leak_area) if is_leak else 0.0,
            "actual_leak_flow_lph": leak_flow_lph,
        }

        for node_id in sensor_list:
            base_p = baseline_pressures[node_id]
            curr_p = pressures[node_id]
            raw_drop = float(base_p - curr_p)
            # Apply 0.5m noise
            noisy_drop = raw_drop + float(np.random.normal(0.0, NOISE_STD_METERS))
            scenario_record[f"raw_drop_{node_id}"] = raw_drop
            scenario_record[f"drop_{node_id}"] = noisy_drop
            scenario_record[f"pressure_{node_id}"] = curr_p

        return scenario_record

    except Exception as e:
        # Fallback in case of solver non-convergence
        return {
            "scenario_id": scenario_id,
            "is_leak": 0,
            "target_node": "ERROR",
            "leak_area_m2": 0.0,
            "actual_leak_flow_lph": 0.0,
            "error": str(e)
        }


# ---------------------------------------------------------------------------
# Main Orchestration & Dataset Generation
# ---------------------------------------------------------------------------
def compute_baseline_pressures(inp_file: str, sensor_list: List[str]) -> Dict[str, float]:
    """Runs a clean 6-hour baseline simulation without leaks to establish reference pressures."""
    print(">>> Running baseline healthy simulation to establish reference pressures...")
    wn = wntr.network.WaterNetworkModel(inp_file)
    wn.options.hydraulic.demand_model = 'PDD'
    wn.options.time.duration = SIMULATION_DURATION_SECONDS
    sim = wntr.sim.WNTRSimulator(wn)
    results = sim.run_sim()

    baseline_pressures = results.node['pressure'].loc[EVAL_TIME_STEP_SECONDS, sensor_list].to_dict()
    print("Baseline reference pressures at 12 sensors (meters):")
    for s_id, p in baseline_pressures.items():
        print(f"  Sensor [{s_id:>3}]: {p:.3f} m")
    return baseline_pressures


def generate_scenario_tasks(
    inp_file: str,
    sensor_list: List[str],
    baseline_pressures: Dict[str, float],
    num_leaks: int = 400,
    num_no_leaks: int = 150
) -> List[Tuple]:
    """Generates task tuples for multiprocessing simulation."""
    wn = wntr.network.WaterNetworkModel(inp_file)
    junctions = list(wn.junction_name_list)

    tasks = []
    task_counter = 1

    # 1. Generate ~400 leak scenarios
    print(f">>> Preparing {num_leaks} leak scenarios (area in 0.0005 - 0.0100 m^2)...")
    for _ in range(num_leaks):
        target = random.choice(junctions)
        # Uniform random leak area between 0.0005 and 0.0100 m^2
        area = round(random.uniform(0.0005, 0.0100), 6)
        tasks.append((task_counter, inp_file, target, area, sensor_list, baseline_pressures))
        task_counter += 1

    # 2. Generate ~150 no-leak scenarios
    print(f">>> Preparing {num_no_leaks} no-leak baseline scenarios...")
    for _ in range(num_no_leaks):
        tasks.append((task_counter, inp_file, None, 0.0, sensor_list, baseline_pressures))
        task_counter += 1

    random.shuffle(tasks)
    return tasks


def run_parallel_simulations(tasks: List[Tuple]) -> pd.DataFrame:
    """Executes all scenarios across multiprocessing worker pool."""
    cpu_cores = max(1, min(multiprocessing.cpu_count() - 1, 8))
    print(f">>> Launching multiprocessing pool with {cpu_cores} worker processes for {len(tasks)} runs...")

    start_t = time.time()
    results = []

    with multiprocessing.Pool(processes=cpu_cores) as pool:
        for i, res in enumerate(pool.imap_unordered(simulate_single_scenario, tasks), 1):
            if "error" not in res:
                results.append(res)
            if i % 50 == 0 or i == len(tasks):
                elapsed = time.time() - start_t
                rate = i / elapsed if elapsed > 0 else 0
                print(f"    Completed {i}/{len(tasks)} scenarios ({rate:.1f} sims/sec)...")

    elapsed_total = time.time() - start_t
    print(f">>> Finished {len(results)} valid simulations in {elapsed_total:.2f} seconds!")

    df = pd.DataFrame(results)
    os.makedirs(DATA_DIR, exist_ok=True)
    df.to_csv(DATASET_CSV, index=False)
    print(f">>> Saved complete dataset to: {DATASET_CSV}")
    return df


# ---------------------------------------------------------------------------
# Model Training Pipelines
# ---------------------------------------------------------------------------
def train_models(df: pd.DataFrame, sensor_list: List[str], baseline_pressures: Dict[str, float]):
    """
    Trains Detector (IsolationForest + Classifier), Localizer (RandomForestClassifier),
    and Sizer (RandomForestRegressor) and exports them to backend/models/.
    """
    os.makedirs(MODELS_DIR, exist_ok=True)
    feature_cols = [f"drop_{node}" for node in sensor_list]

    print("\n" + "="*60)
    print("TRAINING NIRX ML PIPELINE")
    print("="*60)

    # 1. Detector Model (Isolation Forest + Calibrated Binary Classifier)
    print("\n[1/3] Training Detector (Isolation Forest & Binary Classifier)...")
    X_all = df[feature_cols].values
    y_leak = df['is_leak'].values

    # Isolation Forest for unsupervised anomaly detection
    # Train on all with expected contamination = fraction of leaks
    contamination_rate = float(np.mean(y_leak))
    iso_forest = IsolationForest(
        n_estimators=120,
        contamination=min(max(contamination_rate, 0.05), 0.5),
        random_state=42,
        n_jobs=-1
    )
    iso_forest.fit(X_all)

    # Also train a robust binary RandomForest detector for sharp classification probabilities
    X_train_det, X_test_det, y_train_det, y_test_det = train_test_split(
        X_all, y_leak, test_size=0.2, random_state=42, stratify=y_leak
    )
    det_clf = RandomForestClassifier(n_estimators=100, max_depth=8, random_state=42, n_jobs=-1)
    det_clf.fit(X_train_det, y_train_det)
    det_acc = accuracy_score(y_test_det, det_clf.predict(X_test_det))
    print(f"    Detector Test Accuracy: {det_acc * 100:.2f}%")

    # 2. Localizer Model (RandomForestClassifier on leak scenarios)
    print("\n[2/3] Training Localizer (RandomForestClassifier for Top-3 Suspect Nodes)...")
    leak_df = df[df['is_leak'] == 1].copy()
    X_leak = leak_df[feature_cols].values
    y_node = leak_df['target_node'].values

    localizer = RandomForestClassifier(
        n_estimators=200,
        max_depth=16,
        min_samples_split=2,
        random_state=42,
        n_jobs=-1
    )
    localizer.fit(X_leak, y_node)

    # Top-3 Accuracy check
    top3_correct = 0
    probs = localizer.predict_proba(X_leak)
    classes = localizer.classes_
    for i, true_node in enumerate(y_node):
        top3_indices = np.argsort(probs[i])[-3:][::-1]
        top3_nodes = [classes[idx] for idx in top3_indices]
        if true_node in top3_nodes:
            top3_correct += 1
    top3_acc = top3_correct / len(y_node)
    print(f"    Localizer Top-3 Candidate Accuracy: {top3_acc * 100:.2f}%")
    print(f"    Total Distinct Junction Classes: {len(classes)}")

    # 3. Sizer Model (RandomForestRegressor for leak flow in L/h)
    print("\n[3/3] Training Sizer (RandomForestRegressor for Leak Flow L/h)...")
    y_flow = leak_df['actual_leak_flow_lph'].values
    X_train_sz, X_test_sz, y_train_sz, y_test_sz = train_test_split(
        X_leak, y_flow, test_size=0.2, random_state=42
    )
    sizer = RandomForestRegressor(
        n_estimators=120,
        max_depth=12,
        random_state=42,
        n_jobs=-1
    )
    sizer.fit(X_train_sz, y_train_sz)
    sz_r2 = r2_score(y_test_sz, sizer.predict(X_test_sz))
    print(f"    Sizer Test R² Score: {sz_r2:.4f}")

    # Export models to disk
    joblib.dump(iso_forest, os.path.join(MODELS_DIR, "detector_iso.joblib"))
    joblib.dump(det_clf, os.path.join(MODELS_DIR, "detector_clf.joblib"))
    joblib.dump(localizer, os.path.join(MODELS_DIR, "localizer_clf.joblib"))
    joblib.dump(sizer, os.path.join(MODELS_DIR, "sizer_reg.joblib"))

    # Save metadata dictionary
    metadata = {
        "network_name": "Net3.inp",
        "sensor_nodes": sensor_list,
        "feature_columns": feature_cols,
        "baseline_pressures": baseline_pressures,
        "noise_std_meters": NOISE_STD_METERS,
        "junction_classes": list(classes),
        "metrics": {
            "detector_accuracy": float(det_acc),
            "localizer_top3_accuracy": float(top3_acc),
            "sizer_r2_score": float(sz_r2),
            "total_samples": len(df),
            "leak_samples": len(leak_df),
            "no_leak_samples": len(df) - len(leak_df),
        },
        "trained_at_epoch": time.time(),
        "trained_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n>>> Successfully exported all trained models & metadata to: {MODELS_DIR}")
    print("="*60 + "\n")


# ---------------------------------------------------------------------------
# Main Execution Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    multiprocessing.freeze_support()
    random.seed(42)
    np.random.seed(42)

    if not os.path.exists(INP_PATH):
        print(f"Error: Net3.inp not found at {INP_PATH}")
        sys.exit(1)

    print(f"Starting NirX dataset generation pipeline...")
    print(f"INP File: {INP_PATH}")
    print(f"Sensors: {SENSOR_NODES}")

    # 1. Establish reference baseline pressures
    base_pressures = compute_baseline_pressures(INP_PATH, SENSOR_NODES)

    # 2. Build task list
    simulation_tasks = generate_scenario_tasks(
        inp_file=INP_PATH,
        sensor_list=SENSOR_NODES,
        baseline_pressures=base_pressures,
        num_leaks=400,
        num_no_leaks=150
    )

    # 3. Run multiprocessing simulations
    df_data = run_parallel_simulations(simulation_tasks)

    # 4. Train and export models
    train_models(df_data, SENSOR_NODES, base_pressures)
