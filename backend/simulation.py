"""
simulation.py - WNTR Hydraulic Simulation Engine for NirX.

Loads EPANET Net3 network using Pressure Dependent Demand (PDD/PDA) model.
Manages:
- Baseline healthy simulation (6-hour duration).
- Leak injection (orifice area between 0.0005 and 0.0100 m^2).
- Pressure drop calculations across 12 fixed telemetry sensors.
- Static network asset extraction (nodes, coordinates, pipes, pumps, tanks).
"""

import os
from typing import Dict, List, Tuple, Optional, Any

import numpy as np
import wntr

from schemas import (
    NetworkResponse,
    NetworkSummary,
    NetworkNode,
    NetworkPipe,
    NetworkPump,
    NetworkTank,
    NetworkReservoir,
    Coordinates2D,
    ActiveLeakInfo,
    SensorState,
    StateSummary,
    StateResponse
)

# Network file paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INP_PATH = os.path.join(BASE_DIR, "data", "Net3.inp")

# 12 designated sensor nodes across Net3
SENSOR_NODES = [
    "10", "15", "105", "117", "123", "129", 
    "149", "181", "195", "206", "217", "247"
]

# Coordinate Projection Anchor for Leaflet map tiles
BASE_LAT = 37.7749       # San Francisco anchor center
BASE_LNG = -122.4194
CENTER_X = 26.43         # Net3 bounding center X
CENTER_Y = 15.53         # Net3 bounding center Y
SCALE_DEG = 0.003        # 1 EPANET unit ~ 0.003 deg (~300m)

SIM_DURATION_SECONDS = 6 * 3600  # 6 hours
EVAL_TIME_STEP_SECONDS = 6 * 3600


def project_to_lat_lng(x: float, y: float) -> List[float]:
    """Projects Net3 arbitrary coordinates to geographic [latitude, longitude]."""
    lat = round(BASE_LAT + (y - CENTER_Y) * SCALE_DEG, 6)
    lng = round(BASE_LNG + (x - CENTER_X) * SCALE_DEG, 6)
    return [lat, lng]


class WaterNetworkEngine:
    """Manages WNTR simulation execution, leak injection, and telemetry state."""

    def __init__(self, inp_file: str = INP_PATH):
        self.inp_file = inp_file
        if not os.path.exists(self.inp_file):
            raise FileNotFoundError(f"EPANET input file not found: {self.inp_file}")

        # Static network metadata
        self.sensor_node_ids = SENSOR_NODES
        self._static_network: Optional[NetworkResponse] = None

        # Reference baseline pressures
        self.baseline_node_pressures: Dict[str, float] = {}
        self.baseline_sensor_pressures: Dict[str, float] = {}

        # Initialize network topology and baseline run
        self._build_static_network_cache()
        self.run_baseline_simulation()

    def _build_static_network_cache(self):
        """Parses Net3.inp and builds static layout models for frontend map."""
        wn = wntr.network.WaterNetworkModel(self.inp_file)

        nodes_list: List[NetworkNode] = []
        # Junctions
        for j_name in wn.junction_name_list:
            j = wn.get_node(j_name)
            x, y = float(j.coordinates[0]), float(j.coordinates[1])
            nodes_list.append(
                NetworkNode(
                    id=str(j_name),
                    type="junction",
                    coordinates=Coordinates2D(x=round(x, 2), y=round(y, 2)),
                    lat_lng=project_to_lat_lng(x, y),
                    elevation=float(j.elevation),
                    base_demand=float(j.base_demand),
                    is_sensor=(str(j_name) in self.sensor_node_ids)
                )
            )

        # Tanks
        tanks_list: List[NetworkTank] = []
        for t_name in wn.tank_name_list:
            t = wn.get_node(t_name)
            x, y = float(t.coordinates[0]), float(t.coordinates[1])
            nodes_list.append(
                NetworkNode(
                    id=str(t_name),
                    type="tank",
                    coordinates=Coordinates2D(x=round(x, 2), y=round(y, 2)),
                    lat_lng=project_to_lat_lng(x, y),
                    elevation=float(t.elevation),
                    base_demand=0.0,
                    is_sensor=False
                )
            )
            tanks_list.append(
                NetworkTank(
                    id=str(t_name),
                    elevation=float(t.elevation),
                    init_level=float(t.init_level),
                    min_level=float(t.min_level),
                    max_level=float(t.max_level),
                    diameter=float(t.diameter)
                )
            )

        # Reservoirs
        reservoirs_list: List[NetworkReservoir] = []
        for r_name in wn.reservoir_name_list:
            r = wn.get_node(r_name)
            x, y = float(r.coordinates[0]), float(r.coordinates[1])
            nodes_list.append(
                NetworkNode(
                    id=str(r_name),
                    type="reservoir",
                    coordinates=Coordinates2D(x=round(x, 2), y=round(y, 2)),
                    lat_lng=project_to_lat_lng(x, y),
                    elevation=0.0,
                    base_demand=0.0,
                    is_sensor=False
                )
            )
            reservoirs_list.append(
                NetworkReservoir(
                    id=str(r_name),
                    head=float(r.head_timeseries.base_value)
                )
            )

        # Pipes
        pipes_list: List[NetworkPipe] = []
        for p_name in wn.pipe_name_list:
            p = wn.get_link(p_name)
            start_node = wn.get_node(p.start_node_name)
            end_node = wn.get_node(p.end_node_name)
            x1, y1 = float(start_node.coordinates[0]), float(start_node.coordinates[1])
            x2, y2 = float(end_node.coordinates[0]), float(end_node.coordinates[1])
            pipes_list.append(
                NetworkPipe(
                    id=str(p_name),
                    start_node=str(p.start_node_name),
                    end_node=str(p.end_node_name),
                    length=float(p.length),
                    diameter=float(p.diameter),
                    roughness=float(p.roughness),
                    coordinates=[[round(x1, 2), round(y1, 2)], [round(x2, 2), round(y2, 2)]],
                    lat_lng_path=[project_to_lat_lng(x1, y1), project_to_lat_lng(x2, y2)]
                )
            )

        # Pumps
        pumps_list: List[NetworkPump] = []
        for pump_name in wn.pump_name_list:
            pump = wn.get_link(pump_name)
            pumps_list.append(
                NetworkPump(
                    id=str(pump_name),
                    start_node=str(pump.start_node_name),
                    end_node=str(pump.end_node_name)
                )
            )

        summary = NetworkSummary(
            total_nodes=len(nodes_list),
            total_junctions=len(wn.junction_name_list),
            total_pipes=len(pipes_list),
            total_pumps=len(pumps_list),
            total_tanks=len(tanks_list),
            total_reservoirs=len(reservoirs_list),
            total_sensors=len(self.sensor_node_ids)
        )

        self._static_network = NetworkResponse(
            network_name="EPANET Net3",
            summary=summary,
            sensor_node_ids=self.sensor_node_ids,
            nodes=nodes_list,
            pipes=pipes_list,
            pumps=pumps_list,
            tanks=tanks_list,
            reservoirs=reservoirs_list
        )

    def get_static_network(self) -> NetworkResponse:
        """Returns cached static topology payload for GET /network."""
        return self._static_network

    def run_baseline_simulation(self):
        """Executes a 6-hour PDD simulation on healthy network to compute baseline pressure."""
        wn = wntr.network.WaterNetworkModel(self.inp_file)
        wn.options.hydraulic.demand_model = 'PDD'
        wn.options.time.duration = SIM_DURATION_SECONDS

        sim = wntr.sim.WNTRSimulator(wn)
        results = sim.run_sim()

        # Save baseline at hour 6
        p_series = results.node['pressure'].loc[EVAL_TIME_STEP_SECONDS]
        self.baseline_node_pressures = {str(k): float(v) for k, v in p_series.items()}
        self.baseline_sensor_pressures = {
            s: self.baseline_node_pressures[s] for s in self.sensor_node_ids if s in self.baseline_node_pressures
        }

    def simulate_leak_state(
        self,
        target_node: str,
        leak_area: float,
        start_time_seconds: float = 0.0
    ) -> Tuple[Dict[str, float], float]:
        """
        Injects a leak at target_node with leak_area (m^2), runs 6-hour PDD simulation,
        and returns (all_node_pressures_dict, actual_leak_flow_lph).
        """
        wn = wntr.network.WaterNetworkModel(self.inp_file)
        wn.options.hydraulic.demand_model = 'PDD'
        wn.options.time.duration = SIM_DURATION_SECONDS

        node = wn.get_node(target_node)
        node.add_leak(
            wn, 
            area=float(leak_area), 
            discharge_coeff=0.75, 
            start_time=float(start_time_seconds)
        )

        sim = wntr.sim.WNTRSimulator(wn)
        results = sim.run_sim()

        p_series = results.node['pressure'].loc[EVAL_TIME_STEP_SECONDS]
        current_node_pressures = {str(k): float(v) for k, v in p_series.items()}

        leak_flow_lph = 0.0
        if 'leak_demand' in results.node and target_node in results.node['leak_demand']:
            leak_demand_m3s = results.node['leak_demand'].loc[EVAL_TIME_STEP_SECONDS, target_node]
            leak_flow_lph = float(leak_demand_m3s * 3.6e6)

        return current_node_pressures, leak_flow_lph
