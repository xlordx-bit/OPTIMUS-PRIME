"""
Pydantic Schemas for NirX Water Distribution Digital Twin API.
Defines strictly typed request and response contracts for:
- /network: Static topology (nodes, links, sensors) for React/Leaflet map.
- /state: Live hydraulic readings, sensor pressure drops, and leak status.
- /inject-leak: Triggering physical leak injection in WNTR simulation.
- /detect: ML detection alert, top-3 suspect nodes with probabilities, and template work order.
- /reset: Resetting the twin to baseline healthy operation.
- /what-if: Canned hypothetical scenario simulation (Round 1 constraint).
- /agent: Canned intelligent dispatch/reasoning response (Round 1 constraint).
"""

from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Coordinate & Location Primitives
# ---------------------------------------------------------------------------
class Coordinates2D(BaseModel):
    """Raw EPANET network coordinates (X, Y) in map units."""
    x: float = Field(..., description="X coordinate in EPANET Net3 units")
    y: float = Field(..., description="Y coordinate in EPANET Net3 units")


# ---------------------------------------------------------------------------
# GET /network Schemas
# ---------------------------------------------------------------------------
class NetworkNode(BaseModel):
    """Represents a junction, tank, or reservoir in the water network."""
    id: str = Field(..., description="Unique node identifier (e.g. '117', 'River')")
    type: str = Field(..., description="Node classification: 'junction', 'tank', or 'reservoir'")
    coordinates: Coordinates2D = Field(..., description="Raw EPANET X, Y coordinates")
    lat_lng: List[float] = Field(..., description="[Latitude, Longitude] projected for standard Leaflet map tiles")
    elevation: float = Field(..., description="Node ground elevation in meters")
    base_demand: float = Field(..., description="Base water demand in cubic meters per second (m^3/s)")
    is_sensor: bool = Field(..., description="True if a pressure monitoring sensor is installed at this node")


class NetworkPipe(BaseModel):
    """Represents a distribution pipe between two nodes."""
    id: str = Field(..., description="Unique pipe link identifier (e.g. '101')")
    start_node: str = Field(..., description="ID of source/upstream node")
    end_node: str = Field(..., description="ID of target/downstream node")
    length: float = Field(..., description="Length of the pipe in meters")
    diameter: float = Field(..., description="Internal diameter in meters")
    roughness: float = Field(..., description="Hazen-Williams roughness coefficient")
    coordinates: List[List[float]] = Field(..., description="[[x1, y1], [x2, y2]] raw coordinates for polyline")
    lat_lng_path: List[List[float]] = Field(..., description="[[lat1, lng1], [lat2, lng2]] Leaflet polyline path")


class NetworkPump(BaseModel):
    """Represents a booster or intake pump."""
    id: str = Field(..., description="Unique pump identifier")
    start_node: str = Field(..., description="Source node ID")
    end_node: str = Field(..., description="Discharge node ID")


class NetworkTank(BaseModel):
    """Represents an elevated storage tank."""
    id: str = Field(..., description="Tank identifier")
    elevation: float = Field(..., description="Base elevation in meters")
    init_level: float = Field(..., description="Initial water level in meters")
    min_level: float = Field(..., description="Minimum water level in meters")
    max_level: float = Field(..., description="Maximum water level in meters")
    diameter: float = Field(..., description="Tank diameter in meters")


class NetworkReservoir(BaseModel):
    """Represents an infinite water source / reservoir."""
    id: str = Field(..., description="Reservoir identifier (e.g. 'River', 'Lake')")
    head: float = Field(..., description="Total hydraulic head in meters")


class NetworkSummary(BaseModel):
    """High-level asset counts for dashboard cards."""
    total_nodes: int = Field(..., description="Total junctions, tanks, and reservoirs")
    total_junctions: int = Field(..., description="Number of customer demand junctions")
    total_pipes: int = Field(..., description="Number of pipe segments")
    total_pumps: int = Field(..., description="Number of active pump stations")
    total_tanks: int = Field(..., description="Number of elevated storage tanks")
    total_reservoirs: int = Field(..., description="Number of raw source reservoirs")
    total_sensors: int = Field(..., description="Number of real-time monitoring sensors")


class NetworkResponse(BaseModel):
    """Full static topology payload returned by GET /network."""
    network_name: str = Field("EPANET Net3", description="Name of the hydraulic model")
    summary: NetworkSummary = Field(..., description="Summary statistics of network assets")
    sensor_node_ids: List[str] = Field(..., description="List of node IDs where telemetry sensors are active")
    nodes: List[NetworkNode] = Field(..., description="List of all nodes with geographic/spatial properties")
    pipes: List[NetworkPipe] = Field(..., description="List of all pipe links with geometry")
    pumps: List[NetworkPump] = Field(default_factory=list, description="Pumps in the network")
    tanks: List[NetworkTank] = Field(default_factory=list, description="Storage tanks in the network")
    reservoirs: List[NetworkReservoir] = Field(default_factory=list, description="Source reservoirs in the network")


# ---------------------------------------------------------------------------
# GET /state Schemas
# ---------------------------------------------------------------------------
class ActiveLeakInfo(BaseModel):
    """Information regarding the currently active injected leak."""
    node_id: str = Field(..., description="Junction where the leak is located")
    leak_area_m2: float = Field(..., description="Leak opening area in m^2")
    actual_leak_flow_lph: float = Field(..., description="Simulated leak loss rate in Liters/Hour")
    injected_at_hour: float = Field(..., description="Simulation hour at which leak started")


class SensorState(BaseModel):
    """Real-time reading at a designated sensor node."""
    node_id: str = Field(..., description="Sensor junction ID")
    coordinates: Coordinates2D = Field(..., description="Sensor X, Y coordinates")
    lat_lng: List[float] = Field(..., description="[lat, lng] coordinates")
    current_pressure_m: float = Field(..., description="Current pressure head in meters")
    baseline_pressure_m: float = Field(..., description="Baseline healthy pressure head in meters")
    pressure_drop_m: float = Field(..., description="Pressure drop (baseline - current) in meters")
    sensor_noise_m: float = Field(0.0, description="Random sensor telemetry noise applied")
    status: str = Field("NORMAL", description="Status indicator: 'NORMAL', 'WARNING', or 'CRITICAL'")


class StateSummary(BaseModel):
    """Aggregate state indicators across the network."""
    mean_sensor_pressure_m: float = Field(..., description="Average sensor pressure in meters")
    max_pressure_drop_m: float = Field(..., description="Maximum observed pressure drop across all sensors")
    total_leakage_flow_lph: float = Field(..., description="Total ongoing leak water loss rate in Liters/Hour")
    sensors_with_pressure_drop_count: int = Field(..., description="Sensors reporting drop > 1.0 meter")


class StateResponse(BaseModel):
    """Current dynamic state payload returned by GET /state."""
    timestamp_iso: str = Field(..., description="ISO 8601 timestamp of simulation state")
    simulation_duration_hours: float = Field(6.0, description="WNTR PDD duration simulated")
    is_healthy: bool = Field(..., description="True if no leak exists and pressures are normal")
    is_leak_injected: bool = Field(..., description="True if a physical leak is currently active")
    active_leak: Optional[ActiveLeakInfo] = Field(None, description="Details of active leak, if any")
    summary: StateSummary = Field(..., description="High-level telemetry metrics")
    sensors: List[SensorState] = Field(..., description="Telemetry snapshot from all fixed sensors")
    all_node_pressures: Optional[Dict[str, float]] = Field(
        None, 
        description="Optional full-network node ID to pressure mapping for map choropleths/heatmaps"
    )


# ---------------------------------------------------------------------------
# POST /inject-leak Schemas
# ---------------------------------------------------------------------------
class InjectLeakRequest(BaseModel):
    """Payload to trigger leak injection into the digital twin."""
    node_id: str = Field("117", description="Target junction node ID (must be a valid junction)")
    leak_area: float = Field(
        0.002, 
        ge=0.0005, 
        le=0.0100, 
        description="Leak orifice area in m^2 (typically between 0.0005 and 0.0100)"
    )
    start_time_seconds: float = Field(
        0.0, 
        ge=0.0, 
        description="Simulation start offset for leak in seconds (default 0.0)"
    )


class InjectLeakResponse(BaseModel):
    """Response after leak injection and hydraulic recalculation."""
    success: bool = Field(..., description="True if leak was successfully applied and simulated")
    message: str = Field(..., description="Status summary message")
    injected_node: str = Field(..., description="Node where leak was applied")
    leak_area_m2: float = Field(..., description="Applied orifice area in m^2")
    actual_leak_flow_lph: float = Field(..., description="Calculated leak discharge in Liters/Hour")
    max_pressure_drop_m: float = Field(..., description="Max drop observed at any sensor in meters")
    active_leak: ActiveLeakInfo = Field(..., description="Details of the active leak")


# ---------------------------------------------------------------------------
# GET /detect Schemas
# ---------------------------------------------------------------------------
class SuspectNode(BaseModel):
    """Suspect leak location output by the localization model."""
    node_id: str = Field(..., description="Candidate junction ID")
    probability: float = Field(..., description="Localization model confidence probability (0.0 to 1.0)")
    rank: int = Field(..., description="Candidate ranking (1 = most likely)")
    coordinates: Coordinates2D = Field(..., description="Junction X, Y coordinates")
    lat_lng: List[float] = Field(..., description="Junction [lat, lng] coordinates")


class WorkOrderTemplate(BaseModel):
    """Automated dispatch work order generated when a leak is detected."""
    work_order_id: str = Field(..., description="Unique work order tracking ID (e.g. 'WO-NIRX-2026-8941')")
    created_at_iso: str = Field(..., description="ISO 8601 generation timestamp")
    priority: str = Field(..., description="'CRITICAL', 'HIGH', 'MEDIUM', or 'LOW'")
    status: str = Field("PENDING_DISPATCH", description="Current ticket status")
    incident_type: str = Field("WATER_MAIN_BURST", description="Incident classification")
    primary_suspect_node: str = Field(..., description="Top suspected junction ID")
    candidate_suspect_nodes: List[str] = Field(..., description="Top 3 ranked junction candidates")
    estimated_water_loss_lph: float = Field(..., description="Estimated water loss rate in Liters/Hour")
    recommended_action: str = Field(..., description="Immediate guidance for field crew")
    isolation_valve_recommendation: str = Field(..., description="Specific isolation instructions")


class DetectResponse(BaseModel):
    """Full ML inference payload returned by GET /detect."""
    leak_detected: bool = Field(..., description="Detection result: True if leak anomaly detected, False if healthy")
    detector_model: str = Field("IsolationForest + Dynamic Drop Heuristic", description="Detection algorithm used")
    anomaly_score: float = Field(..., description="Anomaly score (-1.0 to 1.0, lower = more anomalous)")
    confidence: float = Field(..., description="Overall confidence level (0.0 to 1.0)")
    estimated_leak_rate_lph: float = Field(..., description="Sizer model estimate of leak volume in Liters/Hour")
    estimated_leak_area_m2: float = Field(..., description="Estimated orifice area in m^2")
    top_suspects: List[SuspectNode] = Field(
        default_factory=list, 
        description="Top 3 candidate nodes with localization probabilities"
    )
    work_order_template: Optional[WorkOrderTemplate] = Field(
        None, 
        description="Work order auto-generated if a leak is detected"
    )


# ---------------------------------------------------------------------------
# POST /reset Schemas
# ---------------------------------------------------------------------------
class ResetResponse(BaseModel):
    """Response returned by POST /reset after resetting to baseline healthy state."""
    success: bool = Field(..., description="True if network was successfully reset")
    message: str = Field(..., description="Reset status message")
    reset_at_iso: str = Field(..., description="ISO timestamp of reset event")
    state: StateResponse = Field(..., description="Baseline healthy state snapshot")


# ---------------------------------------------------------------------------
# POST /what-if (Round 1 Mocked Schema)
# ---------------------------------------------------------------------------
class WhatIfRequest(BaseModel):
    """Simulate a what-if operational intervention."""
    action_type: str = Field("valve_closure", description="Intervention type: 'valve_closure', 'pressure_reduction', or 'pump_speed'")
    target_link_id: Optional[str] = Field("111", description="Pipe or pump link to adjust")
    target_node_id: Optional[str] = Field(None, description="Node to isolate")
    pressure_reduction_pct: Optional[float] = Field(20.0, description="Percentage pressure reduction")


class WhatIfResponse(BaseModel):
    """Canned/Mocked response for /what-if route per Round 1 constraints."""
    scenario_id: str = Field("WHATIF-SIM-4091", description="Simulation identifier")
    status: str = Field("SIMULATED_MOCK", description="Execution status")
    scenario_name: str = Field("Emergency Pipe 111 Isolation & PRV Throttling", description="Human-readable scenario title")
    projected_leak_reduction_pct: float = Field(87.4, description="Projected water loss reduction percentage")
    projected_savings_lph: float = Field(140350.0, description="Estimated water savings in Liters/Hour")
    service_disruption_impact: str = Field("Low - 2 customer junctions affected, secondary feed active", description="Customer impact assessment")
    pressure_head_change_summary: Dict[str, float] = Field(
        default_factory=lambda: {"zone_a_mean_drop_m": 1.2, "zone_b_mean_drop_m": 0.3},
        description="Zone-level pressure shifts"
    )
    recommended_execution_order: List[str] = Field(
        default_factory=lambda: [
            "1. Close Isolation Gate Valve V-101 adjacent to Pipe 111",
            "2. Ramp Pump 10 down to 80% capacity to prevent pressure transient wave",
            "3. Dispatch Repair Crew 4 to Junction 117"
        ],
        description="Step-by-step field execution order"
    )


# ---------------------------------------------------------------------------
# POST /agent (Round 1 Mocked Schema)
# ---------------------------------------------------------------------------
class AgentRequest(BaseModel):
    """Query the autonomous operations agent."""
    prompt: str = Field("What is the optimal containment plan for the current anomaly?", description="User query or autonomous trigger")
    context_override: Optional[Dict[str, Any]] = Field(None, description="Optional telemetry overrides")


class AgentStep(BaseModel):
    """Single step in an agent reasoning chain."""
    step: int = Field(..., description="Step sequence number")
    thought: str = Field(..., description="Internal agent deliberation")
    tool_invoked: str = Field(..., description="Simulated tool call")
    result: str = Field(..., description="Observed outcome")


class AgentResponse(BaseModel):
    """Canned/Mocked response for /agent route per Round 1 constraints."""
    agent_id: str = Field("NIRX-AGENT-v1", description="Autonomous agent version")
    status: str = Field("COMPLETED", description="Agent execution status")
    reasoning_trace: List[AgentStep] = Field(
        default_factory=lambda: [
            AgentStep(
                step=1,
                thought="Detected sudden pressure drop of 1.48m across sensors [117, 105, 195]. Baseline deviations indicate an active rupture.",
                tool_invoked="wntr_detector.evaluate_anomaly",
                result="Anomaly confirmed: p-value < 0.001, confidence 94.2%"
            ),
            AgentStep(
                step=2,
                thought="Localizer model ranks Junction 117 at 78.4% probability, followed by Junction 123 at 14.1%.",
                tool_invoked="wntr_localizer.predict_top3",
                result="Top candidate: Node 117 (Lat: 37.8063, Lng: -122.4359)"
            ),
            AgentStep(
                step=3,
                thought="Simulating downstream pressure impact if isolating Valve V-101. No hospital or critical zone drops below minimum 20m head.",
                tool_invoked="wntr_hydraulic.what_if_isolation",
                result="Isolation feasible: 0 critical service violations."
            )
        ],
        description="Multi-step reasoning chain"
    )
    summary_verdict: str = Field(
        "Active 160,000 L/h burst identified at Junction 117. Recommend immediate closure of Valve V-101 and dispatch of emergency utility crew.",
        description="High-level plain English executive summary"
    )
    suggested_actions: List[str] = Field(
        default_factory=lambda: [
            "Issue automated emergency Work Order #WO-NIRX-2026-8941",
            "Send Leaflet pinpoint route to Field Truck #7",
            "Engage PRV-2 to dampen secondary pressure surge"
        ],
        description="Prioritized immediate actions"
    )


# ---------------------------------------------------------------------------
# Feature 1: Valve-Cut Prioritisation Schemas
# ---------------------------------------------------------------------------
class CriticalFacilityRecord(BaseModel):
    id: str
    name: str
    type: str
    node_id: str
    ward: str
    min_pressure_m: float
    estimated_pressure_m: float
    is_supplied: bool


class ValvePlanItem(BaseModel):
    valves: List[str]
    valve_labels: List[str]
    closed_pipes: List[str]
    is_event_isolated: bool
    affected_households: int
    affected_population: int
    disconnected_nodes_count: int
    critical_facilities_protected: List[CriticalFacilityRecord]
    critical_facilities_lost: List[CriticalFacilityRecord]
    all_critical_protected: bool
    water_saved_lph: float
    min_remaining_pressure_m: float
    expected_duration_hours: float
    alternate_path_exists: bool
    score: float
    trade_off_label: Optional[str] = None


class ValvePrioritisationResponse(BaseModel):
    target_node: str
    event_type: str
    leak_rate_lph: float
    recommended_plan: ValvePlanItem
    alternative_plans: List[ValvePlanItem]
    summary: str
    confidence_score: float
    candidate_valves_evaluated: int


# ---------------------------------------------------------------------------
# Feature 2: Contamination Schemas
# ---------------------------------------------------------------------------
class WaterQualitySensorReading(BaseModel):
    sensor_id: str
    node_id: str
    free_chlorine_mg_l: float
    chlorine_baseline_mg_l: float
    chlorine_delta_mg_l: float
    turbidity_ntu: float
    turbidity_baseline_ntu: float
    turbidity_delta_ntu: float
    ph: float
    conductivity_us_cm: float
    orp_mv: float
    temperature_c: float
    pressure_m: float
    status: str
    anomalies: List[str]
    is_source_suspect: bool


class ContaminationSourceCandidate(BaseModel):
    node_id: str
    confidence_pct: float
    rank: int
    ward: str


class PublicAdvisoryInfo(BaseModel):
    type: str
    title: str
    message: str
    is_active: bool
    ward: str
    recommended_actions: List[str]


class ContaminationStatusResponse(BaseModel):
    timestamp_iso: str
    status: str
    severity_level: str
    ml_classification: str
    confidence_score: float
    safety_rules_summary: Dict[str, bool]
    sensor_telemetry: List[WaterQualitySensorReading]
    abnormal_sensor_count: int
    abnormal_sensors: List[str]
    likely_source_nodes: List[ContaminationSourceCandidate]
    direction_of_spread: str
    affected_zone_nodes: List[str]
    recommended_isolation_valves: List[str]
    public_advisory: PublicAdvisoryInfo
    spread_timeline: List[Dict[str, Any]]


# ---------------------------------------------------------------------------
# Feature 3: Sewer Overflow and Flood Schemas
# ---------------------------------------------------------------------------
class SewerManholeState(BaseModel):
    id: str
    name: str
    ward: str
    coordinates: Dict[str, float]
    lat_lng: List[float]
    elevation_m: float
    depth_m: float
    overflow_threshold_m: float
    current_level_m: float
    fill_percentage: float
    rise_rate_m_hr: float
    overflow_risk_1h_pct: float
    overflow_risk_2h_pct: float
    overflow_risk_6h_pct: float
    status: str
    is_drain_blocked: bool
    nearby_water_main: str
    nearby_valve: str
    nearby_facility: str


class ThreatenedWaterMain(BaseModel):
    pipe_id: str
    nearby_valve: str
    source_manhole: str
    ward: str
    contamination_probability_pct: float
    nearby_facility: str


class SewerStateResponse(BaseModel):
    timestamp_iso: str
    rainfall_current_mm_h: float
    rainfall_15m_mm_h: float
    rainfall_30m_mm_h: float
    rainfall_60m_mm_h: float
    forecast_1h_mm_h: float
    forecast_2h_mm_h: float
    forecast_6h_mm_h: float
    active_blockages: List[str]
    offline_pumps: List[str]
    manholes: List[SewerManholeState]
    conduits: List[Dict[str, Any]]
    facilities: List[Dict[str, Any]]
    flood_zones: List[Dict[str, Any]]
    high_risk_manhole_count: int
    threatened_water_mains: List[ThreatenedWaterMain]
    summary_verdict: str
    recommended_field_actions: List[str]

