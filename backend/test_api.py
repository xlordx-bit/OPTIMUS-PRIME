"""
test_api.py - Automated End-to-End Test Suite for NirX Digital Twin API.

Validates the complete hackathon demo sequence:
1. Healthy baseline state verification
2. Physical leak injection at junction 117
3. Telemetry pressure drop confirmation
4. Machine Learning detection, localization, and work order generation
5. Network reset back to healthy baseline
6. Mocked /what-if and /agent endpoints
"""

import sys
import json
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_model_performance_reports_held_out_accuracy():
    response = client.get("/model-performance")

    assert response.status_code == 200
    assert response.json() == {
        "leak_detection_accuracy": 0.8534,
        "localization_top1_accuracy": 0.1163,
        "localization_top3_accuracy": 0.3256,
    }


# Terminal color formatting
GREEN = "\033[92m"
RED = "\033[91m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
RESET = "\033[0m"
BOLD = "\033[1m"


def header(title: str):
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN}{title.center(60)}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}\n")


def test_end_to_end_demo():
    header("NIRX END-TO-END DEMO TEST SUITE")

    # -----------------------------------------------------------------------
    # Step 1: Health & Root Status
    # -----------------------------------------------------------------------
    print(f"[{BOLD}1/7{RESET}] Testing Root Health Status (GET /)...")
    res = client.get("/")
    assert res.status_code == 200, f"Root returned {res.status_code}"
    data = res.json()
    print(f"    {GREEN}[OK] Service: {data['service']} | Status: {data['status']}{RESET}")

    # -----------------------------------------------------------------------
    # Step 2: Static Network Topology (GET /network)
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}2/7{RESET}] Testing Network Topology for Frontend Map (GET /network)...")
    res = client.get("/network")
    assert res.status_code == 200, f"Network failed: {res.text}"
    net = res.json()
    assert net["summary"]["total_nodes"] == 97
    assert net["summary"]["total_pipes"] == 117
    assert len(net["sensor_node_ids"]) == 12
    first_node = net["nodes"][0]
    print(f"    {GREEN}[OK] Network: {net['network_name']}{RESET}")
    print(f"    {GREEN}[OK] Total Nodes: {net['summary']['total_nodes']} | Pipes: {net['summary']['total_pipes']} | Sensors: {len(net['sensor_node_ids'])}{RESET}")
    print(f"    {GREEN}[OK] Coordinate check: Node '{first_node['id']}' has raw {first_node['coordinates']} and Leaflet GPS {first_node['lat_lng']}{RESET}")

    # -----------------------------------------------------------------------
    # Step 3: Baseline Healthy State (GET /state & GET /detect)
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}3/7{RESET}] Testing Baseline Healthy State (GET /state & GET /detect)...")
    res = client.get("/state")
    assert res.status_code == 200
    st0 = res.json()
    assert st0["is_healthy"] is True
    print(f"    {GREEN}[OK] Network State: is_healthy={st0['is_healthy']} | Max Sensor Drop={st0['summary']['max_pressure_drop_m']:.2f}m{RESET}")

    res = client.get("/detect")
    assert res.status_code == 200
    det0 = res.json()
    assert det0["leak_detected"] is False
    print(f"    {GREEN}[OK] Initial ML Detection: leak_detected={det0['leak_detected']} (Confidence: {det0['confidence']*100:.1f}%){RESET}")

    # -----------------------------------------------------------------------
    # Step 4: Inject Leak at Junction 117 (POST /inject-leak)
    # -----------------------------------------------------------------------
    leak_target = "117"
    leak_area = 0.002  # 0.002 m²
    print(f"\n[{BOLD}4/7{RESET}] Injecting Leak at Node {leak_target} with {leak_area} m² (POST /inject-leak)...")
    res = client.post("/inject-leak", json={"node_id": leak_target, "leak_area": leak_area})
    assert res.status_code == 200, f"Injection failed: {res.text}"
    inj = res.json()
    assert inj["success"] is True
    assert inj["injected_node"] == leak_target
    print(f"    {YELLOW}[LEAK] Active at Junction {inj['injected_node']}{RESET}")
    print(f"    {YELLOW}[FLOW] Actual Flow Loss: {inj['actual_leak_flow_lph']:,.0f} Liters/Hour{RESET}")
    print(f"    {YELLOW}[DROP] Max Sensor Pressure Drop: {inj['max_pressure_drop_m']:.2f} meters{RESET}")

    # Verify /state now shows degraded pressure
    res = client.get("/state")
    st1 = res.json()
    assert st1["is_healthy"] is False
    assert st1["is_leak_injected"] is True
    print(f"    {GREEN}[OK] /state updated: is_healthy={st1['is_healthy']} | Active Leak flow={st1['active_leak']['actual_leak_flow_lph']:,.0f} L/h{RESET}")

    # -----------------------------------------------------------------------
    # Step 5: Run ML Pipeline & Generate Work Order (GET /detect)
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}5/7{RESET}] Running ML Detection, Localization & Dispatch (GET /detect)...")
    res = client.get("/detect")
    assert res.status_code == 200
    det1 = res.json()
    assert det1["leak_detected"] is True
    assert len(det1["top_suspects"]) == 3
    assert det1["work_order_template"] is not None

    print(f"    {RED}{BOLD}[ALERT] LEAK DETECTED: leak_detected={det1['leak_detected']}{RESET}")
    print(f"    {GREEN}[OK] Model: {det1['detector_model']} | Anomaly Score: {det1['anomaly_score']}{RESET}")
    print(f"    {GREEN}[OK] Estimated Leak Volume: {det1['estimated_leak_rate_lph']:,.0f} L/h (Area: {det1['estimated_leak_area_m2']} m²){RESET}")
    print(f"\n    {BOLD}Top-3 Suspect Nodes Identified by Random Forest:{RESET}")
    for s in det1["top_suspects"]:
        highlight = f"{YELLOW}{BOLD}* TOP SUSPECT{RESET}" if s["rank"] == 1 else ""
        print(f"      [{s['rank']}] Node {s['node_id']:<4} | Probability: {s['probability']*100:>5.1f}% | Lat/Lng: {s['lat_lng']} {highlight}")

    wo = det1["work_order_template"]
    print(f"\n    {BOLD}Automated Work Order Generated:{RESET}")
    print(f"      Work Order ID : {wo['work_order_id']}")
    print(f"      Priority      : {wo['priority']}")
    print(f"      Primary Target: Junction {wo['primary_suspect_node']}")
    print(f"      Action Plan   : {wo['recommended_action']}")

    # -----------------------------------------------------------------------
    # Step 6: Reset Network to Baseline Healthy (POST /reset)
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}6/7{RESET}] Resetting Digital Twin to Healthy Baseline (POST /reset)...")
    res = client.post("/reset")
    assert res.status_code == 200
    rst = res.json()
    assert rst["success"] is True
    assert rst["state"]["is_healthy"] is True
    assert rst["state"]["is_leak_injected"] is False

    # Check detector again
    det2 = client.get("/detect").json()
    assert det2["leak_detected"] is False
    print(f"    {GREEN}[OK] Network successfully restored to healthy state (leak_detected={det2['leak_detected']}){RESET}")

    # -----------------------------------------------------------------------
    # Step 7: Round 1 Canned Endpoints (/what-if and /agent)
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}7/10{RESET}] Testing Mocked Scenario Endpoints (POST /what-if & POST /agent)...")
    res = client.post("/what-if", json={"action_type": "valve_closure", "target_link_id": "111"})
    assert res.status_code == 200
    whatif = res.json()
    print(f"    {GREEN}[OK] /what-if scenario: '{whatif['scenario_name']}' -> Projected Savings: {whatif['projected_savings_lph']:,.0f} L/h{RESET}")

    res = client.post("/agent", json={"prompt": "Diagnose anomaly"})
    assert res.status_code == 200
    ag = res.json()
    print(f"    {GREEN}[OK] /agent reasoning trace steps: {len(ag['reasoning_trace'])} | Status: {ag['status']}{RESET}")

    # -----------------------------------------------------------------------
    # Step 8: Real-Time Pressure Monitoring Endpoints
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}8/10{RESET}] Testing Pressure Monitoring Endpoints (/monitoring/*)...")
    res = client.get("/monitoring/overview")
    assert res.status_code == 200
    m_ov = res.json()
    assert "average_pressure_psi" in m_ov
    assert "total_sensors" in m_ov
    print(f"    {GREEN}[OK] /monitoring/overview: Avg {m_ov['average_pressure_psi']:.1f} PSI | Total Sensors: {m_ov['total_sensors']}{RESET}")

    res = client.get("/monitoring/sensors")
    assert res.status_code == 200
    m_sensors = res.json()
    assert m_sensors["count"] == 12
    print(f"    {GREEN}[OK] /monitoring/sensors: {m_sensors['count']} stations verified with PSI and flow estimates{RESET}")

    res = client.get("/monitoring/sensors/117?points=10")
    assert res.status_code == 200
    m_detail = res.json()
    assert m_detail["points"] == 10
    print(f"    {GREEN}[OK] /monitoring/sensors/117: {len(m_detail['history'])} time-series telemetry points generated{RESET}")

    res = client.get("/monitoring/alerts")
    assert res.status_code == 200
    print(f"    {GREEN}[OK] /monitoring/alerts: threshold evaluation active{RESET}")

    # -----------------------------------------------------------------------
    # Step 9: AI Work Orders Endpoints
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}9/10{RESET}] Testing AI Work Orders Endpoints (/work-orders*)...")
    res = client.get("/work-orders")
    assert res.status_code == 200
    wo_list = res.json()
    assert "work_orders" in wo_list
    assert "summary" in wo_list
    print(f"    {GREEN}[OK] /work-orders: Found {len(wo_list['work_orders'])} tickets | Summary: {wo_list['summary']}{RESET}")

    # Create a manual work order
    res = client.post("/work-orders", json={
        "sensor_id": "117",
        "severity": "CRITICAL",
        "problem_description": "Automated test fissure dispatch",
        "incident_type": "TEST_INCIDENT",
        "suspected_cause": "Pipe shear stress",
        "recommended_action": "Isolate pipe link 111"
    })
    assert res.status_code == 200
    new_wo = res.json()
    wo_id = new_wo["work_order_id"]
    print(f"    {GREEN}[OK] POST /work-orders: Created ticket '{wo_id}' (Severity: {new_wo['severity']}){RESET}")

    # Update work order status
    res = client.patch(f"/work-orders/{wo_id}", json={"status": "IN_PROGRESS"})
    assert res.status_code == 200
    assert res.json()["status"] == "IN_PROGRESS"
    print(f"    {GREEN}[OK] PATCH /work-orders/{wo_id}: Status transitioned to IN_PROGRESS{RESET}")

    # -----------------------------------------------------------------------
    # Step 10: Valve Simulation Endpoints
    # -----------------------------------------------------------------------
    print(f"\n[{BOLD}10/10{RESET}] Testing What-If Valve Simulation Endpoints (/simulation/*)...")
    res = client.get("/simulation/network")
    assert res.status_code == 200
    sim_net = res.json()
    assert len(sim_net["valves"]) > 0
    print(f"    {GREEN}[OK] /simulation/network: {len(sim_net['valves'])} valves available for digital twin isolation{RESET}")

    # Simulate closing a valve
    res = client.post("/simulation/valve", json={"valve_id": "V-111", "action": "CLOSE"})
    assert res.status_code == 200
    v_res = res.json()
    assert v_res["new_status"] == "CLOSED"
    print(f"    {GREEN}[OK] POST /simulation/valve: Valve V-111 closed in simulation{RESET}")

    # Run hydraulic simulation
    res = client.post("/simulation/run")
    assert res.status_code == 200
    sim_run = res.json()
    assert "affected_junction_count" in sim_run
    assert "sensor_impacts" in sim_run
    print(f"    {GREEN}[OK] POST /simulation/run: Propagation evaluated {sim_run['affected_junction_count']} affected junctions | Flow reduction: {sim_run['network_summary']['flow_reduction_pct']:.1f}%{RESET}")

    # Reset valves to open
    res = client.post("/simulation/reset")
    assert res.status_code == 200
    rst_valves = res.json()
    assert rst_valves["success"] is True
    assert len(rst_valves["valve_states"]) == 10
    assert all(v["status"] == "OPEN" for v in rst_valves["valve_states"])
    print(f"    {GREEN}[OK] POST /simulation/reset: All {len(rst_valves['valve_states'])} valves restored to OPEN{RESET}")

    header("ALL 10 DEMO SEQUENCE CHECKS PASSED (100% SUCCESS)")


if __name__ == "__main__":
    test_end_to_end_demo()
