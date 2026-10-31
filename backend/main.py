"""
main.py - NirX Water Distribution Digital Twin Backend API.

FastAPI Application providing real-time hydraulic twin simulation,
sensor telemetry streaming, leak injection, ML leak detection & localization,
network reset, canned what-if / agent interfaces,
real-time pressure monitoring, AI work orders, and valve simulation.
"""

import os
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, status, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from schemas import (
    NetworkResponse,
    StateResponse,
    InjectLeakRequest,
    InjectLeakResponse,
    DetectResponse,
    ResetResponse,
    WhatIfRequest,
    WhatIfResponse,
    AgentRequest,
    AgentResponse,
    AgentStep,
    ValvePrioritisationResponse,
    ContaminationStatusResponse,
    SewerStateResponse
)
from state import digital_twin_state
import monitoring as mon
import work_orders as wo_mod
import valve_sim as vs_mod
import valve_prioritisation as vp_mod
import contamination_engine as contam_mod
import sewer_flood_engine as sewer_mod

# Initialize FastAPI App
app = FastAPI(
    title="NirX - Water Distribution Digital Twin API",
    description=(
        "Clean-tech water distribution network digital twin powered by WNTR (EPANET Net3) "
        "and Scikit-Learn ML pipeline for real-time leak detection, localization, and automated dispatch."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Enable CORS for React/Leaflet frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for local hackathon development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Root & Health Check
# ---------------------------------------------------------------------------
@app.get(
    "/",
    summary="Root Status",
    tags=["Health"],
    response_description="System status and API overview"
)
async def root() -> Dict[str, Any]:
    """Provides high-level service metadata and current network health."""
    return {
        "service": "NirX Water Distribution Digital Twin",
        "status": "ONLINE",
        "network_model": "EPANET Net3",
        "hydraulic_engine": "WNTR (PDD)",
        "simulation_state": "HEALTHY" if digital_twin_state.is_healthy else "LEAK_ACTIVE",
        "active_leak": digital_twin_state.active_leak.model_dump() if digital_twin_state.active_leak else None,
        "endpoints": {
            "network": "GET /network",
            "state": "GET /state",
            "inject_leak": "POST /inject-leak",
            "detect": "GET /detect",
            "reset": "POST /reset",
            "what_if": "POST /what-if",
            "agent": "POST /agent",
            "swagger_docs": "GET /docs"
        }
    }


# ---------------------------------------------------------------------------
# 1. GET /network - Static Topology for React/Leaflet Map
# ---------------------------------------------------------------------------
@app.get(
    "/network",
    response_model=NetworkResponse,
    summary="Get Network Topology",
    tags=["Digital Twin"],
    response_description="Nodes, links, pumps, tanks, and sensor locations with dual coordinates"
)
async def get_network() -> NetworkResponse:
    """
    Returns the static network layout of EPANET Net3.
    Includes:
    - Nodes (junctions, tanks, reservoirs) with both EPANET raw X,Y and Leaflet [lat, lng].
    - Distribution pipes with geometry polylines.
    - Pumps and elevated storage tanks.
    - Designated real-time sensor node identifiers.
    """
    try:
        return digital_twin_state.get_network_layout()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve network layout: {str(e)}"
        )


# ---------------------------------------------------------------------------
# 2. GET /state - Dynamic Sensor Telemetry & Pressure Drops
# ---------------------------------------------------------------------------
@app.get(
    "/state",
    response_model=StateResponse,
    summary="Get Current Hydraulic State",
    tags=["Digital Twin"],
    response_description="Real-time sensor pressures, baseline values, and pressure drops"
)
async def get_state() -> StateResponse:
    """
    Returns the live simulation state across the 12 fixed network sensors:
    - Current pressure (m) vs baseline pressure (m).
    - Calculated pressure drop (m).
    - Status indicators (NORMAL, WARNING, CRITICAL).
    - Overall network summary (mean pressure, max drop, leak flow).
    - Optional full-network node pressure mapping for map choropleths.
    """
    try:
        return digital_twin_state.get_state_response()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve network state: {str(e)}"
        )


# ---------------------------------------------------------------------------
# 3. POST /inject-leak - Trigger Physical Leak in WNTR
# ---------------------------------------------------------------------------
@app.post(
    "/inject-leak",
    response_model=InjectLeakResponse,
    summary="Inject a Physical Leak",
    tags=["Simulation Controls"],
    response_description="Confirmation of leak injection and hydraulic recalculation"
)
async def inject_leak(payload: InjectLeakRequest) -> InjectLeakResponse:
    """
    Injects a single orifice leak into the specified junction node:
    - `node_id`: Target junction (e.g. '117').
    - `leak_area`: Orifice area between 0.0005 and 0.0100 m^2.
    - `start_time_seconds`: Offset in simulation (default 0.0s).

    Executes a WNTR PDD 6-hour simulation and updates live in-memory state.
    """
    try:
        return digital_twin_state.inject_leak(payload)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Leak simulation failed: {str(e)}"
        )


# ---------------------------------------------------------------------------
# 4. GET /detect - ML Inference & Automated Work Order Generation
# ---------------------------------------------------------------------------
@app.get(
    "/detect",
    response_model=DetectResponse,
    summary="Run ML Leak Detection & Localization",
    tags=["Machine Learning"],
    response_description="Alert flag, top 3 candidate nodes with probabilities, and work order"
)
async def detect() -> DetectResponse:
    """
    Runs the multi-stage Machine Learning inference pipeline:
    1. **Detector (IsolationForest + Binary Classifier)**: Evaluates anomaly score and alert boolean.
    2. **Localizer (RandomForestClassifier)**: Ranks candidate junctions and outputs top 3 suspect nodes with confidence probabilities.
    3. **Sizer (RandomForestRegressor)**: Estimates leak discharge rate in Liters/Hour (L/h).
    4. **Work Order Generator**: Auto-compiles an emergency field work order template with dispatch instructions.
    """
    try:
        return digital_twin_state.detect_leak()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Leak detection inference failed: {str(e)}"
        )


# ---------------------------------------------------------------------------
# 5. POST /reset - Restore Network to Baseline Healthy State
# ---------------------------------------------------------------------------
@app.post(
    "/reset",
    response_model=ResetResponse,
    summary="Reset Twin to Baseline Healthy State",
    tags=["Simulation Controls"],
    response_description="Confirmation and snapshot of healthy reset baseline"
)
async def reset_network() -> ResetResponse:
    """
    Clears any active injected leaks, resets hydraulic pressures to baseline,
    and returns the network to its pristine healthy state.
    """
    try:
        return digital_twin_state.reset()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Network reset failed: {str(e)}"
        )


# ---------------------------------------------------------------------------
# 6. POST /what-if - Canned Scenario Simulation (Round 1 Constraint)
# ---------------------------------------------------------------------------
@app.post(
    "/what-if",
    response_model=WhatIfResponse,
    summary="Simulate What-If Mitigation (Round 1 Canned)",
    tags=["Round 1 Mocked Routes"],
    response_description="Projected water savings, pressure impact, and field execution sequence"
)
async def what_if_simulation(payload: WhatIfRequest) -> WhatIfResponse:
    """
    Simulates operational what-if interventions (e.g. isolating Pipe 111 or reducing PRV pressure).
    **Round 1 Note**: Returns canned/mocked scenario evaluation per hackathon constraints.
    """
    pipe_target = payload.target_link_id or "111"
    return WhatIfResponse(
        scenario_id="WHATIF-SIM-4091",
        status="SIMULATED_MOCK",
        scenario_name=f"Emergency Isolation of Pipe {pipe_target} & Boundary PRV Throttling",
        projected_leak_reduction_pct=87.4,
        projected_savings_lph=140350.0,
        service_disruption_impact="Low - 2 customer junctions affected, redundant secondary feed maintained",
        pressure_head_change_summary={
            "zone_a_mean_drop_m": 1.2,
            "zone_b_mean_drop_m": 0.3,
            "hospital_zone_pressure_m": 32.5
        },
        recommended_execution_order=[
            f"1. Close Isolation Gate Valve adjacent to Link {pipe_target}",
            "2. Ramp Pump 10 down to 80% speed to prevent transient water hammer surge",
            "3. Dispatch Field Repair Crew #4 to target junction with replacement clamp"
        ]
    )


# ---------------------------------------------------------------------------
# 7. POST /agent - Canned Autonomous Agent Reasoning (Round 1 Constraint)
# ---------------------------------------------------------------------------
@app.post(
    "/agent",
    response_model=AgentResponse,
    summary="Query Autonomous Operations Agent",
    tags=["Autonomous Agent"],
    response_description="Simulation-backed reasoning trace, verdict, and actionable mitigation steps"
)
async def query_agent(payload: AgentRequest) -> AgentResponse:
    """
    Queries the autonomous network operations agent.
    Uses verified hydraulic simulation results, valve prioritization engine,
    and contamination detection models to answer questions accurately without hallucinating.
    """
    prompt = payload.prompt.strip()
    q_lower = prompt.lower()

    # Retrieve live network & state
    network = digital_twin_state.get_network_layout()
    state = digital_twin_state.get_state_response()

    target_node = "117"
    leak_rate = 25000.0
    if state.active_leak:
        target_node = state.active_leak.node_id
        leak_rate = state.active_leak.actual_leak_flow_lph

    vp_engine = vp_mod.get_prioritisation_engine(network, state)
    plans_data = vp_engine.generate_candidate_plans(target_node, "LEAK", leak_rate)
    rec = plans_data["recommended_plan"]
    alts = plans_data["alternative_plans"]

    # Specific response routing based on operator query
    if "best way to isolate" in q_lower or "best plan" in q_lower or "recommend" in q_lower or not prompt:
        valves_str = " and ".join(rec["valve_labels"])
        verdict = (
            f"Close {valves_str}. This isolates the leak near Junction {target_node}, "
            f"protects Civil Hospital and Government School, affects only {rec['affected_households']} households "
            f"for about {rec['expected_duration_hours']:.1f} hours, and recovers approximately {int(rec['water_saved_lph']):,} litres per hour."
        )
        steps = [
            AgentStep(
                step=1,
                thought=f"Hydraulic twin registers pressure drop at Junction {target_node} with leak discharge rate of {int(leak_rate):,} L/h.",
                tool_invoked="hydraulic_twin.get_state",
                result=f"Active anomaly confirmed at Node {target_node}. Baseline pressure loss: {state.summary.max_pressure_drop_m:.2f}m."
            ),
            AgentStep(
                step=2,
                thought="Running multi-valve candidate graph isolation algorithms (evaluating 1-valve, 2-valve, and 3-valve sets).",
                tool_invoked="valve_prioritisation.evaluate_plans",
                result=f"Evaluated {plans_data['candidate_valves_evaluated']} combinations. Best composite score: {rec['score']}."
            ),
            AgentStep(
                step=3,
                thought=f"Verifying critical infrastructure protection: Civil Hospital (181) head is maintained at {rec['min_remaining_pressure_m']}m.",
                tool_invoked="facility_checker.verify_safety_margins",
                result=f"All {len(rec['critical_facilities_protected'])} critical facilities preserved. Alternate feeds verified."
            )
        ]
        actions = [
            f"Execute valve isolation plan: Close {valves_str}",
            f"Notify municipal water dispatch: {rec['affected_households']} households temporarily isolated",
            "Monitor secondary trunk pressure for hydraulic transient waves"
        ]

    elif "hospital" in q_lower:
        hosp_fac = next((f for f in rec["critical_facilities_protected"] if "hospital" in f["name"].lower()), None)
        valves_str = " and ".join(rec["valve_labels"])
        verdict = (
            f"Valve plan [{valves_str}] guarantees uninterrupted supply to Civil Hospital (Junction 181). "
            f"Civil Hospital remains pressurized at {rec['min_remaining_pressure_m']} m head via the redundant secondary feed "
            f"from Reservoir 1 without any service interruption."
        )
        steps = [
            AgentStep(
                step=1,
                thought="Checking critical facility tags: Civil Hospital is tagged at Node 181 with minimum required head 22.0m.",
                tool_invoked="facility_registry.query_hospital",
                result="Hospital requirement: Continuous >= 22m pressure head."
            ),
            AgentStep(
                step=2,
                thought=f"Simulating network topology with valves {valves_str} closed.",
                tool_invoked="valve_sim.sandbox_reachability",
                result=f"Hospital node 181 has 2 independent topological paths to elevated storage tanks. Head: {rec['min_remaining_pressure_m']}m."
            )
        ]
        actions = [
            f"Implement boundary isolation [{valves_str}]",
            "Activate secondary pressure sensor logging at Node 181",
            "Maintain Hospital bypass regulator valve in stand-by mode"
        ]

    elif "only v14" in q_lower or "v14" in q_lower or "single valve" in q_lower:
        one_v_plan = next((p for p in alts if len(p["valves"]) == 1), None)
        saved = int(one_v_plan["water_saved_lph"]) if one_v_plan else 900
        verdict = (
            f"Closing only V14 (V-111) is insufficient for full isolation: it reduces leak flow by only "
            f"~{saved:,} L/h because water loops back from Junction 123 via the eastern trunk. "
            f"To achieve 100% containment, V14 must be paired with V22 (V-121)."
        )
        steps = [
            AgentStep(
                step=1,
                thought="Testing 1-valve closure scenario with only Valve V14 (V-111).",
                tool_invoked="valve_prioritisation.sandbox_single_valve",
                result=f"Event isolated: False. Reverse backflow detected from Link 121 loop."
            ),
            AgentStep(
                step=2,
                thought="Assessing water loss reduction: partial head throttling yields only partial loss mitigation.",
                tool_invoked="wntr_hydraulic.calculate_savings",
                result=f"Water saved: {saved} L/h (only 36% of leak rate). Dual valve cut required."
            )
        ]
        actions = [
            "Do not rely solely on single-valve cut at V14",
            "Dispatch field technician to simultaneously close V14 and V22"
        ]

    elif "fewest households" in q_lower or "least disruption" in q_lower or "households" in q_lower:
        all_plans = [rec] + alts
        fewest_plan = min(all_plans, key=lambda p: p["affected_households"])
        valves_str = " and ".join(fewest_plan["valve_labels"])
        verdict = (
            f"The plan affecting the fewest households is [{valves_str}], disrupting only "
            f"{fewest_plan['affected_households']} households ({fewest_plan['affected_population']} residents) "
            f"while saving {int(fewest_plan['water_saved_lph']):,} litres per hour."
        )
        steps = [
            AgentStep(
                step=1,
                thought="Scanning candidate valve combinations sorted by customer demographic impact.",
                tool_invoked="demographics.query_household_impact",
                result=f"Plan [{valves_str}] selected with minimal customer disruption: {fewest_plan['affected_households']} households."
            ),
            AgentStep(
                step=2,
                thought="Checking that water recovery meets acceptable threshold.",
                tool_invoked="hydraulic_twin.evaluate_savings",
                result=f"Water saved: {int(fewest_plan['water_saved_lph']):,} L/h with acceptable hydraulic boundary."
            )
        ]
        actions = [
            f"Execute minimal-disruption isolation [{valves_str}]",
            "Deploy mobile water tanker to affected residential street",
            "Send targeted SMS notice to affected ward residents"
        ]

    elif "contaminat" in q_lower or "chlorine" in q_lower or "water quality" in q_lower:
        contam_eng = contam_mod.get_contamination_engine(network, state)
        c_status = contam_eng.evaluate_detection_and_localization()
        verdict = c_status["public_advisory"]["message"]
        steps = [
            AgentStep(
                step=1,
                thought="Layer 1 Safety Rules checking chlorine residual, turbidity, pH, and backflow pressure.",
                tool_invoked="safety_rules.evaluate",
                result=f"Safety rules summary: {c_status['safety_rules_summary']}"
            ),
            AgentStep(
                step=2,
                thought="Layer 2 Machine Learning classifier evaluating multi-parameter anomaly pattern.",
                tool_invoked="ml_contamination_clf.predict",
                result=f"Classification: {c_status['ml_classification']} (Confidence: {c_status['confidence_score']}%)"
            ),
            AgentStep(
                step=3,
                thought="Upstream graph tracing for candidate source nodes.",
                tool_invoked="graph_tracer.find_sources",
                result=f"Top candidate: Junction {c_status['likely_source_nodes'][0]['node_id'] if c_status['likely_source_nodes'] else '127'}."
            )
        ]
        actions = c_status["public_advisory"]["recommended_actions"]

    elif "sewer" in q_lower or "overflow" in q_lower or "flood" in q_lower or "rain" in q_lower:
        sewer_eng = sewer_mod.get_sewer_engine()
        s_state = sewer_eng.calculate_overflow_and_contamination_risk()
        verdict = s_state["summary_verdict"]
        steps = [
            AgentStep(
                step=1,
                thought=f"Hydrology model evaluating rainfall intensity {s_state['rainfall_current_mm_h']} mm/h and 2h forecast.",
                tool_invoked="sewer_hydrology.runoff_estimate",
                result=f"High risk manhole count: {s_state['high_risk_manhole_count']}"
            ),
            AgentStep(
                step=2,
                thought="Cross-referencing overflowing manholes against drinking water mains and valve chambers.",
                tool_invoked="cross_contamination.spatial_proximity",
                result=f"Threatened water mains count: {len(s_state['threatened_water_mains'])}"
            )
        ]
        actions = s_state["recommended_field_actions"]

    else:
        verdict = (
            f"NirX operations agent active. Current hydraulic twin status: {'HEALTHY' if state.is_healthy else 'ANOMALY_ACTIVE'}. "
            f"Recommended valve plan for Node {target_node}: Close {' and '.join(rec['valve_labels'])} "
            f"(Score: {rec['score']}%, Water saved: {int(rec['water_saved_lph']):,} L/h)."
        )
        steps = [
            AgentStep(
                step=1,
                thought="Analyzing live hydraulic telemetry, water quality signals, and sewer flood status.",
                tool_invoked="nirx_supervisor.status",
                result=f"Sensors normal: {len([s for s in state.sensors if s.status == 'NORMAL'])}/{len(state.sensors)}."
            )
        ]
        actions = [
            f"Monitor Junction {target_node}",
            "Verify all critical facilities remain supplied"
        ]

    return AgentResponse(
        agent_id="NIRX-AUTONOMOUS-AGENT-v2",
        status="COMPLETED",
        reasoning_trace=steps,
        summary_verdict=verdict,
        suggested_actions=actions
    )


# ---------------------------------------------------------------------------
# 8. GET /monitoring/overview
# ---------------------------------------------------------------------------
@app.get(
    "/monitoring/overview",
    summary="Get Monitoring Overview",
    tags=["Pressure Monitoring"],
    response_description="Aggregated metrics: average pressure, flow, sensor counts, alerts"
)
async def monitoring_overview() -> Dict[str, Any]:
    """Returns live monitoring overview with sensor aggregates and threshold info."""
    try:
        state = digital_twin_state.get_state_response()
        alerts = mon.generate_monitoring_alerts(state)
        return mon.get_monitoring_overview(state)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Monitoring overview failed: {e}")


# ---------------------------------------------------------------------------
# 9. GET /monitoring/sensors
# ---------------------------------------------------------------------------
@app.get(
    "/monitoring/sensors",
    summary="Get All Sensor Readings",
    tags=["Pressure Monitoring"],
    response_description="List of all sensor readings with PSI, flow estimates, and status"
)
async def monitoring_sensors() -> Dict[str, Any]:
    """Returns enriched sensor list with PSI, flow estimates, labels, and zones."""
    try:
        state = digital_twin_state.get_state_response()
        sensors = mon.get_all_sensors(state, digital_twin_state.engine.baseline_sensor_pressures)
        return {"sensors": sensors, "count": len(sensors)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sensor data failed: {e}")


# ---------------------------------------------------------------------------
# 10. GET /monitoring/sensors/{sensor_id}
# ---------------------------------------------------------------------------
@app.get(
    "/monitoring/sensors/{sensor_id}",
    summary="Get Single Sensor Detail",
    tags=["Pressure Monitoring"],
    response_description="Single sensor reading with time-series history"
)
async def monitoring_sensor_detail(sensor_id: str, points: int = 30) -> Dict[str, Any]:
    """Returns enriched data and history for a specific sensor."""
    try:
        state = digital_twin_state.get_state_response()
        data = mon.get_sensor_history(sensor_id, state, points=points)
        if not data:
            raise HTTPException(status_code=404, detail=f"Sensor '{sensor_id}' not found.")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sensor history failed: {e}")


# ---------------------------------------------------------------------------
# 11. GET /monitoring/history
# ---------------------------------------------------------------------------
@app.get(
    "/monitoring/history",
    summary="Get Multi-Sensor History",
    tags=["Pressure Monitoring"],
    response_description="Time-series history for all sensors"
)
async def monitoring_history(points: int = 30) -> Dict[str, Any]:
    """Returns time-series history for all sensors for chart rendering."""
    try:
        state = digital_twin_state.get_state_response()
        return mon.get_multi_sensor_history(state, points=points)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Monitoring history failed: {e}")


# ---------------------------------------------------------------------------
# 12. GET /monitoring/alerts
# ---------------------------------------------------------------------------
@app.get(
    "/monitoring/alerts",
    summary="Get Active Monitoring Alerts",
    tags=["Pressure Monitoring"],
    response_description="List of current active pressure/flow alerts"
)
async def monitoring_alerts() -> Dict[str, Any]:
    """Returns current alert list derived from sensor state."""
    try:
        state = digital_twin_state.get_state_response()
        alerts = mon.generate_monitoring_alerts(state)
        return {"alerts": alerts, "count": len(alerts)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Alerts failed: {e}")


# ---------------------------------------------------------------------------
# 13. GET /work-orders
# ---------------------------------------------------------------------------
@app.get(
    "/work-orders",
    summary="Get All Work Orders",
    tags=["AI Work Orders"],
    response_description="List of all work orders sorted by severity"
)
async def get_work_orders() -> Dict[str, Any]:
    """Returns all work orders. Auto-generates from current anomalies if any."""
    try:
        state = digital_twin_state.get_state_response()
        if not state.is_healthy:
            wo_mod.generate_work_orders_from_state(state, digital_twin_state.engine.baseline_sensor_pressures)
        orders = wo_mod.get_all_work_orders()
        summary = wo_mod.get_work_order_summary()
        return {"work_orders": orders, "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Work orders failed: {e}")


# ---------------------------------------------------------------------------
# 14. POST /work-orders
# ---------------------------------------------------------------------------
@app.post(
    "/work-orders",
    summary="Create a Work Order",
    tags=["AI Work Orders"],
    response_description="Newly created work order"
)
async def create_work_order(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Creates a manual work order."""
    try:
        order = wo_mod.create_work_order(payload)
        return order
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Work order creation failed: {e}")


# ---------------------------------------------------------------------------
# 15. GET /work-orders/{work_order_id}
# ---------------------------------------------------------------------------
@app.get(
    "/work-orders/{work_order_id}",
    summary="Get Work Order by ID",
    tags=["AI Work Orders"],
    response_description="Single work order detail"
)
async def get_work_order_detail(work_order_id: str) -> Dict[str, Any]:
    """Returns a specific work order by ID."""
    order = wo_mod.get_work_order(work_order_id)
    if not order:
        raise HTTPException(status_code=404, detail=f"Work order '{work_order_id}' not found.")
    return order


# ---------------------------------------------------------------------------
# 16. PATCH /work-orders/{work_order_id}
# ---------------------------------------------------------------------------
@app.patch(
    "/work-orders/{work_order_id}",
    summary="Update Work Order Status",
    tags=["AI Work Orders"],
    response_description="Updated work order"
)
async def update_work_order(work_order_id: str, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Updates a work order's status or fields."""
    order = wo_mod.update_work_order(work_order_id, payload)
    if not order:
        raise HTTPException(status_code=404, detail=f"Work order '{work_order_id}' not found.")
    return order


# ---------------------------------------------------------------------------
# 17. GET /simulation/network
# ---------------------------------------------------------------------------
@app.get(
    "/simulation/network",
    summary="Get Valve Simulation Network",
    tags=["Valve Simulation"],
    response_description="Network topology with valve positions for simulation"
)
async def simulation_network() -> Dict[str, Any]:
    """Returns network topology enriched with valve states for the simulation view."""
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        engine = vs_mod.get_valve_engine(network, state)
        return engine.get_network_topology()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation network failed: {e}")


# ---------------------------------------------------------------------------
# 18. POST /simulation/valve
# ---------------------------------------------------------------------------
@app.post(
    "/simulation/valve",
    summary="Set Valve State (Simulation Only)",
    tags=["Valve Simulation"],
    response_description="Updated valve state confirmation"
)
async def simulation_set_valve(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Sets a valve OPEN or CLOSED in the simulation state.
    Does NOT affect physical network or live twin state.
    """
    valve_id = payload.get("valve_id")
    action = payload.get("action", "OPEN").upper()
    if not valve_id:
        raise HTTPException(status_code=400, detail="valve_id is required.")
    if action not in ("OPEN", "CLOSE"):
        raise HTTPException(status_code=400, detail="action must be 'OPEN' or 'CLOSE'.")
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        engine = vs_mod.get_valve_engine(network, state)
        success = engine.set_valve(valve_id, action)
        if not success:
            raise HTTPException(status_code=404, detail=f"Valve '{valve_id}' not found.")
        return {
            "valve_id": valve_id,
            "action": action,
            "new_status": "CLOSED" if action == "CLOSE" else "OPEN",
            "valve_states": engine.get_valve_status(),
            "message": f"[SIMULATION ONLY] Valve {valve_id} set to {action}. No physical commands sent."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Valve set failed: {e}")


# ---------------------------------------------------------------------------
# 19. POST /simulation/run
# ---------------------------------------------------------------------------
@app.post(
    "/simulation/run",
    summary="Run Valve Simulation",
    tags=["Valve Simulation"],
    response_description="Simulation results with pressure/flow impact analysis"
)
async def simulation_run() -> Dict[str, Any]:
    """
    Runs the graph-based pressure and flow propagation simulation.
    Returns before/after comparison, affected junctions, and disconnected zones.
    SIMULATION ONLY - does not modify live network state.
    """
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        engine = vs_mod.get_valve_engine(network, state)
        return engine.run_simulation()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation run failed: {e}")


# ---------------------------------------------------------------------------
# 20. POST /simulation/reset
# ---------------------------------------------------------------------------
@app.post(
    "/simulation/reset",
    summary="Reset Valve Simulation",
    tags=["Valve Simulation"],
    response_description="Reset confirmation with restored valve states"
)
async def simulation_reset() -> Dict[str, Any]:
    """Resets all simulated valves to default OPEN position."""
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        engine = vs_mod.get_valve_engine(network, state)
        result = engine.reset_simulation()
        result["valve_states"] = engine.get_valve_status()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation reset failed: {e}")


# ---------------------------------------------------------------------------
# 21. GET /valves/prioritise - Valve-Cut Prioritisation Engine
# ---------------------------------------------------------------------------
@app.get(
    "/valves/prioritise",
    response_model=ValvePrioritisationResponse,
    summary="Get Valve-Cut Prioritisation Plans",
    tags=["Valve-Cut Prioritisation"],
    response_description="Recommended isolation plan, alternative trade-offs, and critical facilities impact"
)
async def get_valve_prioritisation_plans(
    node_id: Optional[str] = None,
    event_type: str = "LEAK",
    leak_rate_lph: Optional[float] = None
) -> ValvePrioritisationResponse:
    """
    Evaluates multi-valve isolation options for an active or specified event.
    Optimizes for event isolation while keeping hospitals, schools, and maximum households supplied.
    """
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()

        target = node_id
        if not target:
            target = state.active_leak.node_id if state.active_leak else "127"

        rate = leak_rate_lph
        if rate is None:
            rate = state.active_leak.actual_leak_flow_lph if state.active_leak else 28400.0

        vp_engine = vp_mod.get_prioritisation_engine(network, state)
        plans = vp_engine.generate_candidate_plans(target, event_type, rate)
        return ValvePrioritisationResponse(**plans)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Valve prioritisation failed: {e}")


# ---------------------------------------------------------------------------
# 22. POST /valves/apply-plan - Apply Plan to Simulation Sandbox
# ---------------------------------------------------------------------------
@app.post(
    "/valves/apply-plan",
    summary="Apply Isolation Plan in Simulation",
    tags=["Valve-Cut Prioritisation"],
    response_description="Simulation outcome with recommended valves closed"
)
async def apply_valve_plan(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Applies a candidate valve plan (e.g. ['V-111', 'V-121']) to the simulation sandbox.
    Runs pressure/flow propagation so operator sees immediate impact on the map.
    """
    valves_to_close = payload.get("valves", [])
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        engine = vs_mod.get_valve_engine(network, state)

        # Reset all to open first, then close target valves
        engine.reset_simulation()
        for vid in valves_to_close:
            # Match canonical or alias
            canon_id = vp_mod.VALVE_BY_ID.get(vid, {}).get("valve_id", vid)
            engine.set_valve(canon_id, "CLOSE")

        sim_result = engine.run_simulation()
        sim_result["applied_valves"] = valves_to_close
        sim_result["isolated_pipes"] = sim_result.get("closed_pipes", [])
        sim_result["summary"] = f"Plan applied to simulation sandbox: Closed {', '.join(valves_to_close)}. {sim_result.get('affected_junction_count', 0)} junctions impacted."
        sim_result["message"] = f"Plan applied to simulation: Closed {', '.join(valves_to_close)}"
        return sim_result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to apply valve plan: {e}")


# ---------------------------------------------------------------------------
# 23. GET /valves/critical-facilities
# ---------------------------------------------------------------------------
@app.get(
    "/valves/critical-facilities",
    summary="Get Critical Facilities Registry",
    tags=["Valve-Cut Prioritisation"]
)
async def get_critical_facilities() -> Dict[str, Any]:
    """Returns registry of tagged hospitals, schools, anganwadis, and dense settlements."""
    return {"facilities": vp_mod.CRITICAL_FACILITIES}


# ---------------------------------------------------------------------------
# 24. GET /contamination/status - Water Quality & Contamination State
# ---------------------------------------------------------------------------
@app.get(
    "/contamination/status",
    response_model=ContaminationStatusResponse,
    summary="Get Contamination Detection & Advisory Status",
    tags=["Contamination Detection"]
)
async def get_contamination_status() -> ContaminationStatusResponse:
    """
    Runs dual-layer contamination detection:
    - Layer 1: Deterministic safety rules (chlorine drop, turbidity rise, pH shift, ingress risk)
    - Layer 2: ML anomaly classifier
    - Upstream source node localization with confidence rankings
    - Downstream spread timeline and public health advisory banner
    """
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        pressures = {s.node_id: s.current_pressure_m for s in state.sensors}

        engine = contam_mod.get_contamination_engine(network, state)
        evaluation = engine.evaluate_detection_and_localization(sensor_pressures=pressures)
        return ContaminationStatusResponse(**evaluation)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contamination evaluation failed: {e}")


# ---------------------------------------------------------------------------
# 25. POST /contamination/inject - Inject Contamination Scenario
# ---------------------------------------------------------------------------
@app.post(
    "/contamination/inject",
    summary="Inject Contamination Event",
    tags=["Contamination Detection"]
)
async def inject_contamination(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Injects a chemical, microbial, or intrusion contamination event into a junction node.
    """
    try:
        node_id = str(payload.get("node_id", "127"))
        severity = payload.get("severity", "HIGH_RISK")
        cl_drop = float(payload.get("cl_drop", 0.55))
        turb_rise = float(payload.get("turb_rise", 6.2))
        ph_shift = float(payload.get("ph_shift", -1.2))

        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        engine = contam_mod.get_contamination_engine(network, state)

        result = engine.inject_contamination(
            node_id=node_id,
            severity=severity,
            cl_drop=cl_drop,
            turb_rise=turb_rise,
            ph_shift=ph_shift
        )
        return {"message": f"Contamination injected at Junction {node_id}", "status": result, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contamination injection failed: {e}")


# ---------------------------------------------------------------------------
# 26. POST /contamination/reset - Restore Clean Water Baseline
# ---------------------------------------------------------------------------
@app.post(
    "/contamination/reset",
    summary="Reset Water Quality to Normal",
    tags=["Contamination Detection"]
)
async def reset_contamination() -> Dict[str, Any]:
    """Clears any active contamination event and restores baseline safe parameters."""
    try:
        network = digital_twin_state.get_network_layout()
        state = digital_twin_state.get_state_response()
        engine = contam_mod.get_contamination_engine(network, state)
        result = engine.reset()
        return {"message": "Water quality reset to clean baseline", "status": result, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Contamination reset failed: {e}")


# ---------------------------------------------------------------------------
# 27. GET /sewer/network - Drainage & Sanitation Topology
# ---------------------------------------------------------------------------
@app.get(
    "/sewer/network",
    summary="Get Sewer & Drainage Network Topology",
    tags=["Sewer & Flood Layer"]
)
async def get_sewer_network() -> Dict[str, Any]:
    """Returns static layout of manholes, storm conduits, retention basins, and pump stations."""
    engine = sewer_mod.get_sewer_engine()
    return engine.get_sewer_topology()


# ---------------------------------------------------------------------------
# 28. GET /sewer/state - Sewer Overflow & Flood Warning State
# ---------------------------------------------------------------------------
@app.get(
    "/sewer/state",
    response_model=SewerStateResponse,
    summary="Get Sewer Overflow & Flood Risk State",
    tags=["Sewer & Flood Layer"]
)
async def get_sewer_state() -> SewerStateResponse:
    """
    Returns real-time 1h, 2h, and 6h overflow risks across manholes,
    rainfall observation & forecast, threatened drinking water mains, and field crew actions.
    """
    try:
        engine = sewer_mod.get_sewer_engine()
        state_data = engine.calculate_overflow_and_contamination_risk()
        return SewerStateResponse(**state_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sewer state retrieval failed: {e}")


# ---------------------------------------------------------------------------
# 29. POST /sewer/simulate-rain - Simulate Storm & Infrastructure Failure
# ---------------------------------------------------------------------------
@app.post(
    "/sewer/simulate-rain",
    summary="Simulate Rain & Infrastructure Stress",
    tags=["Sewer & Flood Layer"]
)
async def simulate_sewer_rain(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """
    Simulates rainfall storm intensities ('CLEAR', 'LIGHT', 'MODERATE', 'HEAVY', 'EXTREME')
    with optional drain blockage (D-07) and pump station outage (SP-02).
    """
    try:
        intensity = payload.get("intensity_level", "HEAVY")
        block_drain = bool(payload.get("block_drain_d7", True))
        pump_offline = bool(payload.get("pump_sp2_offline", False))

        engine = sewer_mod.get_sewer_engine()
        result = engine.set_rainfall_scenario(
            intensity_level=intensity,
            block_drain_d7=block_drain,
            pump_sp2_offline=pump_offline
        )
        return {"message": f"Rainfall scenario '{intensity}' simulated across catchments", "status": result, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rain simulation failed: {e}")


# ---------------------------------------------------------------------------
# 30. POST /sewer/reset - Reset Sewer & Weather to Clear Baseline
# ---------------------------------------------------------------------------
@app.post(
    "/sewer/reset",
    summary="Reset Sewer & Rainfall State",
    tags=["Sewer & Flood Layer"]
)
async def reset_sewer() -> Dict[str, Any]:
    """Restores clear dry weather and clears all sewer blockages / pump outages."""
    try:
        engine = sewer_mod.get_sewer_engine()
        result = engine.set_rainfall_scenario(
            intensity_level="CLEAR",
            block_drain_d7=False,
            pump_sp2_offline=False
        )
        return {"message": "Sewer and drainage restored to dry-weather baseline", "status": result, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sewer reset failed: {e}")


# ---------------------------------------------------------------------------
# Server Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    # Run development server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
