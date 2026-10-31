"""
valve_sim.py - What-If Valve Simulation Engine for NirX Digital Twin.

Provides a graph-based network simulation for valve open/close operations.
Uses NetworkX to model junctions, pipes, and valves as a graph.
Computes simplified pressure and flow propagation without modifying live state.
This is a simplified explainable model - NOT a physically accurate hydraulic solver.
It is designed so that EPANET integration can replace the propagation model later.
"""

import math
import random
from typing import Dict, List, Optional, Tuple, Any
from copy import deepcopy

import networkx as nx

from monitoring import SENSOR_LABELS, SENSOR_ZONES
from simulation import SENSOR_NODES

# -----------------------------------------------------------------------------
# Valve Definitions (simulated - not tied to live physical hardware)
# -----------------------------------------------------------------------------

# Each valve sits on a pipe and controls flow through it
VALVE_DEFINITIONS = [
    {"valve_id": "V-101", "pipe_id": "101", "start_node": "10",  "end_node": "15",  "default_status": "OPEN"},
    {"valve_id": "V-102", "pipe_id": "102", "start_node": "15",  "end_node": "105", "default_status": "OPEN"},
    {"valve_id": "V-111", "pipe_id": "111", "start_node": "117", "end_node": "123", "default_status": "OPEN"},
    {"valve_id": "V-112", "pipe_id": "112", "start_node": "123", "end_node": "129", "default_status": "OPEN"},
    {"valve_id": "V-113", "pipe_id": "113", "start_node": "129", "end_node": "149", "default_status": "OPEN"},
    {"valve_id": "V-121", "pipe_id": "121", "start_node": "181", "end_node": "195", "default_status": "OPEN"},
    {"valve_id": "V-131", "pipe_id": "131", "start_node": "195", "end_node": "206", "default_status": "OPEN"},
    {"valve_id": "V-141", "pipe_id": "141", "start_node": "206", "end_node": "217", "default_status": "OPEN"},
    {"valve_id": "V-151", "pipe_id": "151", "start_node": "217", "end_node": "247", "default_status": "OPEN"},
    {"valve_id": "V-161", "pipe_id": "161", "start_node": "117", "end_node": "181", "default_status": "OPEN"},
]


class ValveSimulationEngine:
    """
    Graph-based valve simulation engine.
    Operates entirely on a separate simulated state - never modifies live network.
    """

    def __init__(self, network_response=None, state_response=None):
        # Simulated valve states (independent of physical network)
        self._valve_states: Dict[str, str] = {
            v["valve_id"]: v["default_status"] for v in VALVE_DEFINITIONS
        }
        # Store for pre-simulation baseline
        self._baseline_pressures: Dict[str, float] = {}
        self._current_pressures: Dict[str, float] = {}
        self._graph: Optional[nx.Graph] = None
        self._network = network_response
        self._state = state_response

        if network_response and state_response:
            self._build_graph(network_response, state_response)

    def update_state(self, network_response, state_response):
        """Update the simulation with the latest network/state data."""
        self._network = network_response
        self._state = state_response
        self._build_graph(network_response, state_response)

    def _build_graph(self, network_response, state_response):
        """Build NetworkX graph from network topology."""
        G = nx.Graph()

        # Add junction nodes with pressure attributes
        pressure_by_node = {s.node_id: s.current_pressure_m for s in state_response.sensors}
        for node in network_response.nodes:
            pressure = pressure_by_node.get(node.id, 35.0 + random.uniform(-5, 5))
            G.add_node(node.id, node_type=node.type, pressure=pressure, elevation=node.elevation)
            self._baseline_pressures[node.id] = pressure
            self._current_pressures[node.id] = pressure

        # Add pipe edges
        for pipe in network_response.pipes:
            G.add_edge(
                pipe.start_node, pipe.end_node,
                pipe_id=pipe.id,
                length=pipe.length,
                diameter=pipe.diameter,
                valve_id=None,
                is_closed=False,
            )

        # Attach valve info to edges
        valve_by_pipe = {v["pipe_id"]: v for v in VALVE_DEFINITIONS}
        for u, v, data in G.edges(data=True):
            pid = data.get("pipe_id", "")
            if pid in valve_by_pipe:
                valve_def = valve_by_pipe[pid]
                data["valve_id"] = valve_def["valve_id"]
                data["is_closed"] = (self._valve_states.get(valve_def["valve_id"], "OPEN") == "CLOSED")

        self._graph = G

    def get_network_topology(self) -> Dict:
        """Returns the simulated network topology for frontend rendering."""
        if not self._network or not self._state:
            return {"nodes": [], "pipes": [], "valves": []}

        nodes_out = []
        pressure_by_id = {n: p for n, p in self._current_pressures.items()}

        for node in self._network.nodes:
            pressure = pressure_by_id.get(node.id, 35.0)
            pressure_psi = pressure * 1.42234
            sensor = next((s for s in self._state.sensors if s.node_id == node.id), None)
            status = "NORMAL"
            if sensor:
                status = sensor.status
            elif pressure_psi < 30:
                status = "CRITICAL"
            elif pressure_psi < 50:
                status = "WARNING"

            nodes_out.append({
                "id": node.id,
                "type": node.type,
                "coordinates": {"x": node.coordinates.x, "y": node.coordinates.y},
                "lat_lng": node.lat_lng,
                "elevation": node.elevation,
                "pressure_m": round(pressure, 2),
                "pressure_psi": round(pressure_psi, 2),
                "status": status,
                "is_sensor": node.is_sensor,
                "label": SENSOR_LABELS.get(node.id, f"Node {node.id}"),
            })

        pipes_out = []
        valve_by_pipe = {v["pipe_id"]: v for v in VALVE_DEFINITIONS}
        for pipe in self._network.pipes:
            valve = valve_by_pipe.get(pipe.id)
            valve_status = "NONE"
            valve_id = None
            if valve:
                valve_id = valve["valve_id"]
                valve_status = self._valve_states.get(valve_id, "OPEN")
            pipes_out.append({
                "id": pipe.id,
                "start_node": pipe.start_node,
                "end_node": pipe.end_node,
                "coordinates": pipe.coordinates,
                "length": pipe.length,
                "diameter": pipe.diameter,
                "valve_id": valve_id,
                "valve_status": valve_status,
            })

        valves_out = []
        for vdef in VALVE_DEFINITIONS:
            # Find midpoint between start/end node
            start_node = next((n for n in self._network.nodes if n.id == vdef["start_node"]), None)
            end_node = next((n for n in self._network.nodes if n.id == vdef["end_node"]), None)
            coords = {"x": 0, "y": 0}
            if start_node and end_node:
                coords = {
                    "x": (start_node.coordinates.x + end_node.coordinates.x) / 2,
                    "y": (start_node.coordinates.y + end_node.coordinates.y) / 2,
                }
            valves_out.append({
                "valve_id": vdef["valve_id"],
                "pipe_id": vdef["pipe_id"],
                "start_node": vdef["start_node"],
                "end_node": vdef["end_node"],
                "status": self._valve_states.get(vdef["valve_id"], "OPEN"),
                "coordinates": coords,
            })

        return {
            "nodes": nodes_out,
            "pipes": pipes_out,
            "valves": valves_out,
            "sensor_node_ids": list(SENSOR_NODES),
        }

    def set_valve(self, valve_id: str, action: str) -> bool:
        """Set a valve OPEN or CLOSED in simulation state only."""
        if valve_id not in self._valve_states:
            return False
        self._valve_states[valve_id] = "CLOSED" if action.upper() == "CLOSE" else "OPEN"
        return True

    def run_simulation(self) -> Dict:
        """
        Runs simplified pressure and flow propagation.
        Uses graph reachability to find disconnected zones.
        Uses simplified pressure decay model (not EPANET-accurate).
        Returns before/after comparison with affected junctions.
        """
        if not self._graph or not self._network:
            return {"error": "Simulation graph not initialized"}

        G = deepcopy(self._graph)

        # Apply current valve states to graph edges
        closed_valves = [vid for vid, status in self._valve_states.items() if status == "CLOSED"]
        closed_pipes = []
        valve_by_id = {v["valve_id"]: v for v in VALVE_DEFINITIONS}

        for vid in closed_valves:
            vdef = valve_by_id.get(vid)
            if not vdef:
                continue
            # Remove edge to simulate closure
            sn, en = vdef["start_node"], vdef["end_node"]
            if G.has_edge(sn, en):
                G.remove_edge(sn, en)
                closed_pipes.append(vdef["pipe_id"])

        # Find source nodes (reservoirs + tanks)
        source_nodes = {n.id for n in self._network.nodes if n.type in ("reservoir", "tank")}

        # Find disconnected components (nodes unreachable from any source)
        disconnected_junctions = []
        for node in self._network.nodes:
            if node.type != "junction":
                continue
            reachable = any(
                nx.has_path(G, node.id, src)
                for src in source_nodes
                if src in G.nodes and node.id in G.nodes
            )
            if not reachable:
                disconnected_junctions.append(node.id)

        # Simplified pressure propagation
        # For each junction, pressure = baseline * (1 - decay based on distance from closed valve and pipe count)
        new_pressures = dict(self._baseline_pressures)
        affected_junctions = []

        for vid in closed_valves:
            vdef = valve_by_id.get(vid)
            if not vdef:
                continue
            # BFS from closure point, apply progressive pressure decay
            start = vdef["end_node"]
            if start not in G.nodes:
                continue
            visited = {}
            queue = [(start, 0)]
            while queue:
                curr, depth = queue.pop(0)
                if curr in visited:
                    continue
                visited[curr] = depth
                for neighbor in G.neighbors(curr):
                    if neighbor not in visited:
                        queue.append((neighbor, depth + 1))

            for junc_id, depth in visited.items():
                if G.nodes.get(junc_id, {}).get("node_type") != "junction":
                    continue
                base_p = self._baseline_pressures.get(junc_id, 35.0)
                decay = min(0.85, depth * 0.08 + 0.05)
                new_p = max(0.0, base_p * (1 - decay))
                old_p = new_pressures.get(junc_id, base_p)
                if new_p < old_p:
                    new_pressures[junc_id] = new_p
                    affected_junctions.append({
                        "node_id": junc_id,
                        "old_pressure_m": round(base_p, 2),
                        "old_pressure_psi": round(base_p * 1.42234, 2),
                        "new_pressure_m": round(new_p, 2),
                        "new_pressure_psi": round(new_p * 1.42234, 2),
                        "pressure_change_m": round(new_p - base_p, 2),
                        "pressure_change_psi": round((new_p - base_p) * 1.42234, 2),
                        "depth_from_closure": depth,
                        "disconnected": junc_id in disconnected_junctions,
                        "label": SENSOR_LABELS.get(junc_id, f"Junction {junc_id}"),
                    })

        # Sensor-level summary
        sensor_impacts = []
        for sid in SENSOR_NODES:
            old_p = self._baseline_pressures.get(sid, 35.0)
            new_p = new_pressures.get(sid, old_p)
            change_m = new_p - old_p
            change_psi = change_m * 1.42234
            status = "NORMAL"
            if new_p * 1.42234 < 28:
                status = "CRITICAL"
            elif new_p * 1.42234 < 45:
                status = "WARNING"
            sensor_impacts.append({
                "sensor_id": sid,
                "label": SENSOR_LABELS.get(sid, f"Sensor {sid}"),
                "old_pressure_m": round(old_p, 2),
                "old_pressure_psi": round(old_p * 1.42234, 2),
                "new_pressure_m": round(new_p, 2),
                "new_pressure_psi": round(new_p * 1.42234, 2),
                "pressure_change_m": round(change_m, 2),
                "pressure_change_psi": round(change_psi, 2),
                "post_sim_status": status,
                "disconnected": sid in disconnected_junctions,
            })

        # Flow impact estimate
        avg_pressure_before = sum(self._baseline_pressures.get(s, 35) for s in SENSOR_NODES) / len(SENSOR_NODES)
        avg_pressure_after = sum(new_pressures.get(s, 35) for s in SENSOR_NODES) / len(SENSOR_NODES)
        avg_flow_before = 145.0
        avg_flow_after = max(0.0, avg_flow_before * (avg_pressure_after / max(avg_pressure_before, 1.0)))
        flow_reduction_pct = ((avg_flow_before - avg_flow_after) / avg_flow_before) * 100

        # Update current pressures for rendering
        self._current_pressures.update(new_pressures)

        # Build updated node list with new pressures
        updated_nodes = []
        for node in self._network.nodes:
            p = new_pressures.get(node.id, self._baseline_pressures.get(node.id, 35.0))
            p_psi = p * 1.42234
            status = "NORMAL"
            if node.id in disconnected_junctions:
                status = "CRITICAL"
            elif p_psi < 28:
                status = "CRITICAL"
            elif p_psi < 45:
                status = "WARNING"
            updated_nodes.append({
                "id": node.id,
                "type": node.type,
                "coordinates": {"x": node.coordinates.x, "y": node.coordinates.y},
                "lat_lng": node.lat_lng,
                "pressure_m": round(p, 2),
                "pressure_psi": round(p_psi, 2),
                "status": status,
                "is_sensor": node.is_sensor,
                "label": SENSOR_LABELS.get(node.id, f"Node {node.id}"),
                "disconnected": node.id in disconnected_junctions,
            })

        return {
            "simulation_type": "GRAPH_BASED_SIMPLIFIED",
            "disclaimer": "Simplified graph propagation model - not EPANET-accurate. For demonstration only.",
            "closed_valves": closed_valves,
            "closed_pipes": closed_pipes,
            "disconnected_junctions": disconnected_junctions,
            "affected_junction_count": len(affected_junctions),
            "affected_junctions": affected_junctions[:20],  # limit output
            "sensor_impacts": sensor_impacts,
            "network_summary": {
                "avg_pressure_before_m": round(avg_pressure_before, 2),
                "avg_pressure_after_m": round(avg_pressure_after, 2),
                "avg_pressure_before_psi": round(avg_pressure_before * 1.42234, 2),
                "avg_pressure_after_psi": round(avg_pressure_after * 1.42234, 2),
                "avg_flow_before_lmin": round(avg_flow_before, 1),
                "avg_flow_after_lmin": round(avg_flow_after, 1),
                "flow_reduction_pct": round(flow_reduction_pct, 1),
                "disconnected_zone_count": len(disconnected_junctions),
            },
            "updated_nodes": updated_nodes,
        }

    def reset_simulation(self) -> Dict:
        """Resets all valve states back to default (all OPEN)."""
        for vdef in VALVE_DEFINITIONS:
            self._valve_states[vdef["valve_id"]] = vdef["default_status"]
        if self._network and self._state:
            self._build_graph(self._network, self._state)
            self._current_pressures = dict(self._baseline_pressures)
        return {"success": True, "message": "Simulation reset to baseline. All valves restored to default positions."}

    def get_valve_status(self) -> List[Dict]:
        """Returns current status of all simulated valves."""
        valve_by_id = {v["valve_id"]: v for v in VALVE_DEFINITIONS}
        return [
            {
                "valve_id": vid,
                "status": status,
                "pipe_id": valve_by_id.get(vid, {}).get("pipe_id", ""),
                "start_node": valve_by_id.get(vid, {}).get("start_node", ""),
                "end_node": valve_by_id.get(vid, {}).get("end_node", ""),
            }
            for vid, status in self._valve_states.items()
        ]


# Global singleton simulation engine (initialized lazily)
_valve_engine: Optional[ValveSimulationEngine] = None


def get_valve_engine(network_response=None, state_response=None) -> ValveSimulationEngine:
    global _valve_engine
    if _valve_engine is None:
        _valve_engine = ValveSimulationEngine(network_response, state_response)
    elif network_response and state_response:
        _valve_engine.update_state(network_response, state_response)
    return _valve_engine
