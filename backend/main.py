"""
main.py - NirX Water Distribution Digital Twin Backend API.

FastAPI Application providing real-time hydraulic twin simulation,
sensor telemetry streaming, leak injection, ML leak detection & localization,
network reset, and canned what-if / agent interfaces for Round 1.
"""

import os
from typing import Dict, Any
from fastapi import FastAPI, HTTPException, status
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
    AgentResponse
)
from state import digital_twin_state

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
    summary="Query Autonomous Operations Agent (Round 1 Canned)",
    tags=["Round 1 Mocked Routes"],
    response_description="Multi-step reasoning trace, summary verdict, and actionable mitigation steps"
)
async def query_agent(payload: AgentRequest) -> AgentResponse:
    """
    Queries the autonomous network operations agent for root-cause analysis and dispatch recommendations.
    **Round 1 Note**: Returns canned/mocked multi-step chain-of-thought per hackathon constraints.
    """
    return AgentResponse()


# ---------------------------------------------------------------------------
# Server Entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    # Run development server on port 8000
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
