"""
sewer_flood_engine.py - Sewer Overflow & Flood Warning Simulation Engine for NirX.

Models an urban drainage and sanitation network co-located with the Net3 water grid:
- Manholes, sewer mains, stormwater drains, culverts
- Retention basins, stormwater pumping stations, outfalls
- Low-lying flood-prone risk zones
- Real-time rainfall observations (15m, 30m, 60m) and forecasts (1h, 2h, 6h)
- Dynamic manhole water level rise, pump status, and drain blockage states
- Cross-contamination threat detection for drinking water pipes, valve chambers, and hospitals/schools
- Field dispatch and public health emergency actions
"""

import math
import time
import random
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from copy import deepcopy

from simulation import project_to_lat_lng, BASE_LAT, BASE_LNG

# -----------------------------------------------------------------------------
# Co-located Drainage & Sanitation Assets Overlay
# Positioned in Net3 spatial coordinate system (X: 10 to 80, Y: 10 to 80)
# -----------------------------------------------------------------------------

# Manhole Network (20 key inspection chambers)
SEWER_MANHOLES: List[Dict[str, Any]] = [
    {
        "id": "M-01", "name": "Manhole M-01", "ward": "Ward 1",
        "coords": {"x": 12.0, "y": 68.0}, "elevation_m": 28.5, "depth_m": 3.2,
        "overflow_threshold_m": 2.9, "catchment_ha": 3.5, "impervious_pct": 0.65,
        "base_flow_lps": 18.0, "drain_id": "D-01", "nearby_water_main": "101",
        "nearby_valve": "V-101", "historical_waterlogging_freq": "LOW"
    },
    {
        "id": "M-04", "name": "Manhole M-04", "ward": "Ward 2",
        "coords": {"x": 22.0, "y": 62.0}, "elevation_m": 24.2, "depth_m": 3.0,
        "overflow_threshold_m": 2.7, "catchment_ha": 4.8, "impervious_pct": 0.75,
        "base_flow_lps": 24.0, "drain_id": "D-02", "nearby_water_main": "102",
        "nearby_valve": "V-102", "historical_waterlogging_freq": "MODERATE",
        "nearby_facility": "Shanti Nagar Slum Cluster"
    },
    {
        "id": "M-07", "name": "Manhole M-07", "ward": "Ward 3",
        "coords": {"x": 35.0, "y": 65.0}, "elevation_m": 22.8, "depth_m": 3.4,
        "overflow_threshold_m": 3.0, "catchment_ha": 5.2, "impervious_pct": 0.70,
        "base_flow_lps": 28.0, "drain_id": "D-03", "nearby_water_main": "103",
        "nearby_valve": "V-103", "historical_waterlogging_freq": "LOW",
        "nearby_facility": "Sub-District Health Centre"
    },
    {
        "id": "M-11", "name": "Manhole M-11", "ward": "Ward 4",
        "coords": {"x": 48.0, "y": 58.0}, "elevation_m": 19.5, "depth_m": 3.1,
        "overflow_threshold_m": 2.8, "catchment_ha": 4.1, "impervious_pct": 0.68,
        "base_flow_lps": 22.0, "drain_id": "D-04", "nearby_water_main": "112",
        "nearby_valve": "V-112", "historical_waterlogging_freq": "MODERATE",
        "nearby_facility": "Government School"
    },
    {
        "id": "M-14", "name": "Manhole M-14", "ward": "Ward 12",
        "coords": {"x": 32.0, "y": 44.0}, "elevation_m": 17.8, "depth_m": 3.5,
        "overflow_threshold_m": 3.1, "catchment_ha": 6.5, "impervious_pct": 0.82,
        "base_flow_lps": 38.0, "drain_id": "D-05", "nearby_water_main": "111",
        "nearby_valve": "V-111", "historical_waterlogging_freq": "HIGH",
        "nearby_facility": "Ward 12 Anganwadi"
    },
    {
        "id": "M-18", "name": "Manhole M-18", "ward": "Ward 9",
        "coords": {"x": 45.0, "y": 38.0}, "elevation_m": 14.1, "depth_m": 3.3,
        "overflow_threshold_m": 2.9, "catchment_ha": 7.4, "impervious_pct": 0.88,
        "base_flow_lps": 42.0, "drain_id": "D-07", "nearby_water_main": "121",
        "nearby_valve": "V-121", "historical_waterlogging_freq": "VERY_HIGH",
        "nearby_facility": "Ambedkar Colony",
        "is_culvert_inlet": True
    },
    {
        "id": "M-22", "name": "Manhole M-22", "ward": "Ward 7",
        "coords": {"x": 58.0, "y": 35.0}, "elevation_m": 16.5, "depth_m": 3.2,
        "overflow_threshold_m": 2.8, "catchment_ha": 5.8, "impervious_pct": 0.72,
        "base_flow_lps": 31.0, "drain_id": "D-08", "nearby_water_main": "161",
        "nearby_valve": "V-161", "historical_waterlogging_freq": "MODERATE",
        "nearby_facility": "Civil Hospital"
    },
    {
        "id": "M-25", "name": "Manhole M-25", "ward": "Ward 5",
        "coords": {"x": 62.0, "y": 52.0}, "elevation_m": 21.0, "depth_m": 2.9,
        "overflow_threshold_m": 2.6, "catchment_ha": 3.9, "impervious_pct": 0.60,
        "base_flow_lps": 19.0, "drain_id": "D-09", "nearby_water_main": "113",
        "nearby_valve": "V-113", "historical_waterlogging_freq": "LOW",
        "nearby_facility": "Vandana Seniors Care Home"
    },
    {
        "id": "M-28", "name": "Manhole M-28", "ward": "Ward 11",
        "coords": {"x": 42.0, "y": 24.0}, "elevation_m": 13.6, "depth_m": 3.6,
        "overflow_threshold_m": 3.2, "catchment_ha": 8.0, "impervious_pct": 0.85,
        "base_flow_lps": 45.0, "drain_id": "D-10", "nearby_water_main": "131",
        "nearby_valve": "V-131", "historical_waterlogging_freq": "HIGH",
        "nearby_facility": "Railway Transit Settlement"
    },
    {
        "id": "M-30", "name": "Manhole M-30", "ward": "Ward 8",
        "coords": {"x": 68.0, "y": 22.0}, "elevation_m": 15.0, "depth_m": 3.0,
        "overflow_threshold_m": 2.7, "catchment_ha": 4.5, "impervious_pct": 0.64,
        "base_flow_lps": 20.0, "drain_id": "D-11", "nearby_water_main": "141",
        "nearby_valve": "V-141", "historical_waterlogging_freq": "LOW"
    },
    {
        "id": "M-33", "name": "Manhole M-33", "ward": "Ward 6",
        "coords": {"x": 75.0, "y": 14.0}, "elevation_m": 12.5, "depth_m": 3.4,
        "overflow_threshold_m": 3.0, "catchment_ha": 6.0, "impervious_pct": 0.70,
        "base_flow_lps": 26.0, "drain_id": "D-12", "nearby_water_main": "151",
        "nearby_valve": "V-151", "historical_waterlogging_freq": "MODERATE"
    }
]

# Drainage Conduits / Storm Sewers connecting manholes
SEWER_CONDUITS: List[Dict[str, Any]] = [
    {"id": "S-201", "start": "M-01", "end": "M-04", "diameter_mm": 600, "length_m": 240, "slope": 0.008, "capacity_lps": 85.0},
    {"id": "S-202", "start": "M-04", "end": "M-07", "diameter_mm": 700, "length_m": 310, "slope": 0.006, "capacity_lps": 115.0},
    {"id": "S-203", "start": "M-07", "end": "M-11", "diameter_mm": 800, "length_m": 280, "slope": 0.005, "capacity_lps": 140.0},
    {"id": "S-204", "start": "M-04", "end": "M-14", "diameter_mm": 900, "length_m": 350, "slope": 0.007, "capacity_lps": 190.0},
    {"id": "S-205", "start": "M-14", "end": "M-18", "diameter_mm": 1000, "length_m": 290, "slope": 0.004, "capacity_lps": 220.0},
    {"id": "S-206", "start": "M-18", "end": "M-22", "diameter_mm": 1100, "length_m": 380, "slope": 0.003, "capacity_lps": 260.0},
    {"id": "S-207", "start": "M-11", "end": "M-25", "diameter_mm": 750, "length_m": 320, "slope": 0.005, "capacity_lps": 125.0},
    {"id": "S-208", "start": "M-25", "end": "M-22", "diameter_mm": 800, "length_m": 290, "slope": 0.006, "capacity_lps": 150.0},
    {"id": "S-209", "start": "M-18", "end": "M-28", "diameter_mm": 1200, "length_m": 310, "slope": 0.004, "capacity_lps": 310.0},
    {"id": "S-210", "start": "M-28", "end": "M-30", "diameter_mm": 1200, "length_m": 420, "slope": 0.003, "capacity_lps": 300.0},
    {"id": "S-211", "start": "M-30", "end": "M-33", "diameter_mm": 1400, "length_m": 360, "slope": 0.002, "capacity_lps": 380.0},
]

# Infrastructure Facilities
SEWER_FACILITIES: List[Dict[str, Any]] = [
    {
        "id": "SP-01", "name": "Northwest Stormwater Lift Station", "type": "pump_station",
        "coords": {"x": 30.0, "y": 42.0}, "capacity_lps": 450.0, "status": "OPERATIONAL",
        "power_source": "GRID_PLUS_BACKUP_DIESEL", "serves_manholes": ["M-14", "M-18"]
    },
    {
        "id": "SP-02", "name": "Lowland Central Drainage Booster", "type": "pump_station",
        "coords": {"x": 44.0, "y": 36.0}, "capacity_lps": 600.0, "status": "OPERATIONAL",
        "power_source": "GRID", "serves_manholes": ["M-18", "M-28"]
    },
    {
        "id": "RET-01", "name": "Ward 9 Stormwater Detention Basin", "type": "retention_basin",
        "coords": {"x": 48.0, "y": 34.0}, "capacity_m3": 45000.0, "current_fill_pct": 28.0,
        "max_depth_m": 4.5, "status": "AVAILABLE"
    },
    {
        "id": "OF-01", "name": "West River Main Outfall", "type": "outfall",
        "coords": {"x": 78.0, "y": 12.0}, "type_detail": "Tidal Flap Gate", "status": "OPEN"
    }
]

# Flood-Prone Vulnerability Zones
FLOOD_ZONES: List[Dict[str, Any]] = [
    {
        "id": "FP-01", "name": "Ward 9 Lowland Depressed Basin", "risk_level": "VERY_HIGH",
        "mean_elevation_m": 13.8, "critical_threshold_rain_mm_h": 22.0,
        "center": {"x": 45.0, "y": 37.0}, "radius_m": 420,
        "vulnerable_population": 4600, "affected_facilities": ["Ambedkar Colony", "Drain D-07 Inlet"],
        "nearby_drinking_mains": ["121", "161"]
    },
    {
        "id": "FP-02", "name": "Ward 11 Railway Underpass Culvert", "risk_level": "HIGH",
        "mean_elevation_m": 13.2, "critical_threshold_rain_mm_h": 28.0,
        "center": {"x": 42.0, "y": 24.0}, "radius_m": 350,
        "vulnerable_population": 3100, "affected_facilities": ["Railway Transit Settlement"],
        "nearby_drinking_mains": ["131"]
    },
    {
        "id": "FP-03", "name": "Ward 2 Shanti Nagar Drain Bottleneck", "risk_level": "MODERATE",
        "mean_elevation_m": 24.0, "critical_threshold_rain_mm_h": 38.0,
        "center": {"x": 22.0, "y": 62.0}, "radius_m": 280,
        "vulnerable_population": 3200, "affected_facilities": ["Shanti Nagar Slum Cluster"],
        "nearby_drinking_mains": ["102"]
    }
]


class SewerFloodEngine:
    """
    Simulates urban hydrology, drainage channel hydraulic capacity,
    manhole overflow risk (1h, 2h, 6h), and drinking-water cross-contamination threats.
    """

    def __init__(self):
        # Current rainfall telemetry (mm/h)
        self.rain_15m: float = 0.0
        self.rain_30m: float = 0.0
        self.rain_60m: float = 0.0
        self.forecast_1h: float = 2.0
        self.forecast_2h: float = 5.0
        self.forecast_6h: float = 8.0

        # Physical disturbances
        self.blocked_drains: List[str] = []
        self.offline_pumps: List[str] = []

    def set_rainfall_scenario(
        self,
        intensity_level: str = "HEAVY",
        block_drain_d7: bool = True,
        pump_sp2_offline: bool = False
    ) -> Dict[str, Any]:
        """
        Configures rainfall intensity and infrastructure failure scenarios.
        Intensity Levels: 'LIGHT', 'MODERATE', 'HEAVY', 'EXTREME', 'CLEAR'
        """
        intensity_level = intensity_level.upper()
        if intensity_level == "CLEAR":
            self.rain_15m = 0.0
            self.rain_30m = 0.0
            self.rain_60m = 0.0
            self.forecast_1h = 0.0
            self.forecast_2h = 0.0
            self.forecast_6h = 0.0
        elif intensity_level == "LIGHT":
            self.rain_15m = 3.5
            self.rain_30m = 3.0
            self.rain_60m = 2.5
            self.forecast_1h = 4.0
            self.forecast_2h = 3.0
            self.forecast_6h = 1.0
        elif intensity_level == "MODERATE":
            self.rain_15m = 14.0
            self.rain_30m = 12.0
            self.rain_60m = 10.0
            self.forecast_1h = 16.0
            self.forecast_2h = 12.0
            self.forecast_6h = 6.0
        elif intensity_level == "HEAVY":
            self.rain_15m = 38.0
            self.rain_30m = 34.0
            self.rain_60m = 28.0
            self.forecast_1h = 42.0
            self.forecast_2h = 35.0
            self.forecast_6h = 18.0
        elif intensity_level == "EXTREME":
            self.rain_15m = 65.0
            self.rain_30m = 58.0
            self.rain_60m = 48.0
            self.forecast_1h = 68.0
            self.forecast_2h = 55.0
            self.forecast_6h = 32.0

        self.blocked_drains = ["D-07"] if block_drain_d7 else []
        self.offline_pumps = ["SP-02"] if pump_sp2_offline else []

        return self.calculate_overflow_and_contamination_risk()

    def calculate_overflow_and_contamination_risk(self) -> Dict[str, Any]:
        """
        Estimates stormwater runoff, conduit surcharge, manhole overflow probability,
        and drinking water contamination risk.
        """
        manhole_states = []
        high_risk_manholes = []
        threatened_water_mains = []

        total_rain_current = max(self.rain_15m, self.rain_30m, self.rain_60m)

        for mh in SEWER_MANHOLES:
            # 1. Stormwater Inflow calculation using Rational Formula: Q = C * I * A / 360
            # C: runoff coef (impervious_pct * 0.9 + (1-impervious_pct)*0.3)
            c_factor = mh["impervious_pct"] * 0.88 + (1.0 - mh["impervious_pct"]) * 0.25
            runoff_lps = (c_factor * total_rain_current * mh["catchment_ha"] * 10.0) / 3.6

            # Outflow capacity throttle if drain blocked or pump offline
            base_capacity_lps = mh["base_flow_lps"] * 4.5
            if mh["drain_id"] in self.blocked_drains:
                base_capacity_lps *= 0.35  # 65% capacity reduction due to blockage
            if "SP-02" in self.offline_pumps and mh["id"] in ("M-18", "M-28"):
                base_capacity_lps *= 0.45

            net_accumulation_lps = (mh["base_flow_lps"] + runoff_lps) - base_capacity_lps

            # Dynamic water level in manhole
            base_level_m = 0.8
            rise_rate_m_hr = max(0.0, net_accumulation_lps / 75.0)
            current_level_m = min(mh["depth_m"], base_level_m + (rise_rate_m_hr * 0.8))

            # Overflow risk score for 1h, 2h, 6h
            dist_to_overflow = max(0.05, mh["overflow_threshold_m"] - current_level_m)

            # Probabilities (0.0 to 1.0)
            # Increase with rainfall, forecast, rise rate, and historical frequency
            hist_boost = 0.15 if mh["historical_waterlogging_freq"] in ("HIGH", "VERY_HIGH") else 0.0
            drain_boost = 0.25 if mh["drain_id"] in self.blocked_drains else 0.0
            pump_boost = 0.20 if "SP-02" in self.offline_pumps and mh["id"] in ("M-18", "M-28") else 0.0

            rain_factor_1h = min(1.0, (self.forecast_1h / 35.0) * 0.6 + (rise_rate_m_hr / 1.5) * 0.4)
            rain_factor_2h = min(1.0, (self.forecast_2h / 30.0) * 0.6 + (rise_rate_m_hr / 1.2) * 0.4)
            rain_factor_6h = min(1.0, (self.forecast_6h / 25.0) * 0.5 + (rise_rate_m_hr / 1.0) * 0.5)

            risk_1h = min(0.99, max(0.02, rain_factor_1h + hist_boost + drain_boost + pump_boost))
            risk_2h = min(0.99, max(0.05, rain_factor_2h + hist_boost + drain_boost + pump_boost + 0.08))
            risk_6h = min(0.99, max(0.08, rain_factor_6h + hist_boost * 0.8))

            if total_rain_current < 1.0:
                risk_1h = 0.02
                risk_2h = 0.04
                risk_6h = 0.05
                current_level_m = 0.65
                rise_rate_m_hr = 0.0

            # Categorize Risk
            status = "NORMAL"
            if risk_2h >= 0.75 or current_level_m >= mh["overflow_threshold_m"]:
                status = "CRITICAL"
            elif risk_2h >= 0.50:
                status = "WARNING"
            elif risk_2h >= 0.25:
                status = "WATCH"

            mh_state = {
                "id": mh["id"],
                "name": mh["name"],
                "ward": mh["ward"],
                "coordinates": mh["coords"],
                "lat_lng": project_to_lat_lng(mh["coords"]["x"], mh["coords"]["y"]),
                "elevation_m": mh["elevation_m"],
                "depth_m": mh["depth_m"],
                "overflow_threshold_m": mh["overflow_threshold_m"],
                "current_level_m": round(current_level_m, 2),
                "fill_percentage": round((current_level_m / mh["depth_m"]) * 100, 1),
                "rise_rate_m_hr": round(rise_rate_m_hr, 2),
                "overflow_risk_1h_pct": round(risk_1h * 100, 1),
                "overflow_risk_2h_pct": round(risk_2h * 100, 1),
                "overflow_risk_6h_pct": round(risk_6h * 100, 1),
                "status": status,
                "is_drain_blocked": mh["drain_id"] in self.blocked_drains,
                "nearby_water_main": mh["nearby_water_main"],
                "nearby_valve": mh["nearby_valve"],
                "nearby_facility": mh.get("nearby_facility", "Standard Residential")
            }
            manhole_states.append(mh_state)

            if status in ("CRITICAL", "WARNING"):
                high_risk_manholes.append(mh_state)
                # Check cross-contamination risk to drinking water main
                threatened_water_mains.append({
                    "pipe_id": mh["nearby_water_main"],
                    "nearby_valve": mh["nearby_valve"],
                    "source_manhole": mh["id"],
                    "ward": mh["ward"],
                    "contamination_probability_pct": round(risk_2h * 92, 1),
                    "nearby_facility": mh.get("nearby_facility", "Residential Zone")
                })

        # Sort threatened mains by risk descending
        threatened_water_mains.sort(key=lambda m: m["contamination_probability_pct"], reverse=True)

        # Build Field Crew Response Recommendations
        field_actions = []
        primary_threat = high_risk_manholes[0] if high_risk_manholes else None

        if primary_threat:
            p_mh = primary_threat["id"]
            p_ward = primary_threat["ward"]
            p_drain = next((m["drain_id"] for m in SEWER_MANHOLES if m["id"] == p_mh), "D-07")
            p_pipe = primary_threat["nearby_water_main"]
            p_prob = int(primary_threat["overflow_risk_2h_pct"])

            example_summary = (
                f"Manhole {p_mh} has an {p_prob}% chance of overflowing within two hours due to heavy rainfall "
                f"and reduced outflow. Nearby water main W-{p_pipe} may be exposed to contamination. "
                f"Deploy a jetting crew to Drain {p_drain}, inspect {p_mh}, and issue an avoid-floodwater advisory for {p_ward}."
            )

            field_actions = [
                f"1. Emergency Dispatch: Send Jetting / Suction Crew #3 to Drain {p_drain} and Manhole {p_mh} immediately.",
                f"2. Pumping Activation: Engage Lowland Booster SP-02 and open diversion gate to Ward 9 Detention Basin RET-01.",
                f"3. Water Security: Pressurize drinking water main W-{p_pipe} above 25m head to prevent negative-pressure back-siphonage ingress.",
                f"4. Public Notice: Issue Avoid-Floodwater Advisory and precautionary Boil-Water Advisory for {p_ward}.",
                f"5. Critical Facilities: Deploy perimeter sandbags around {primary_threat['nearby_facility']} and inspect hospital intake chamber."
            ]
        else:
            example_summary = "Drainage system operating within normal hydraulic margins. No immediate overflow risk."
            field_actions = ["1. Routine CCTV inspection of main interceptor S-205.", "2. Maintain stormwater detention basin at baseline ready state."]

        # Enrich Facilities
        enriched_facilities = []
        for fac in SEWER_FACILITIES:
            f_copy = dict(fac)
            f_copy["lat_lng"] = project_to_lat_lng(fac["coords"]["x"], fac["coords"]["y"])
            if fac["id"] in self.offline_pumps:
                f_copy["status"] = "OFFLINE_FAILED"
            enriched_facilities.append(f_copy)

        # Enrich Flood Zones
        enriched_flood_zones = []
        for fz in FLOOD_ZONES:
            fz_copy = dict(fz)
            fz_copy["lat_lng"] = project_to_lat_lng(fz["center"]["x"], fz["center"]["y"])
            # Adjust current status based on rain
            if total_rain_current >= fz["critical_threshold_rain_mm_h"] * 0.9:
                fz_copy["current_status"] = "SEVERE_FLOOD_WARNING"
            elif total_rain_current >= fz["critical_threshold_rain_mm_h"] * 0.5:
                fz_copy["current_status"] = "FLOOD_WATCH"
            else:
                fz_copy["current_status"] = "NORMAL"
            enriched_flood_zones.append(fz_copy)

        return {
            "timestamp_iso": datetime.now(timezone.utc).isoformat(),
            "rainfall_current_mm_h": round(total_rain_current, 1),
            "rainfall_15m_mm_h": self.rain_15m,
            "rainfall_30m_mm_h": self.rain_30m,
            "rainfall_60m_mm_h": self.rain_60m,
            "forecast_1h_mm_h": self.forecast_1h,
            "forecast_2h_mm_h": self.forecast_2h,
            "forecast_6h_mm_h": self.forecast_6h,
            "active_blockages": self.blocked_drains,
            "offline_pumps": self.offline_pumps,
            "manholes": manhole_states,
            "conduits": SEWER_CONDUITS,
            "facilities": enriched_facilities,
            "flood_zones": enriched_flood_zones,
            "high_risk_manhole_count": len(high_risk_manholes),
            "threatened_water_mains": threatened_water_mains,
            "summary_verdict": example_summary,
            "recommended_field_actions": field_actions
        }

    def get_sewer_topology(self) -> Dict[str, Any]:
        """Returns the static layout of the sanitation/drainage network for frontend rendering."""
        mhs_out = []
        for mh in SEWER_MANHOLES:
            mhs_out.append({
                "id": mh["id"],
                "name": mh["name"],
                "ward": mh["ward"],
                "coordinates": mh["coords"],
                "lat_lng": project_to_lat_lng(mh["coords"]["x"], mh["coords"]["y"]),
                "elevation_m": mh["elevation_m"],
                "depth_m": mh["depth_m"],
                "overflow_threshold_m": mh["overflow_threshold_m"],
                "nearby_water_main": mh["nearby_water_main"],
                "nearby_valve": mh["nearby_valve"],
                "nearby_facility": mh.get("nearby_facility", "Residential")
            })

        conduits_out = []
        mh_by_id = {m["id"]: m for m in SEWER_MANHOLES}
        for cond in SEWER_CONDUITS:
            start_mh = mh_by_id.get(cond["start"])
            end_mh = mh_by_id.get(cond["end"])
            path = []
            if start_mh and end_mh:
                path = [
                    project_to_lat_lng(start_mh["coords"]["x"], start_mh["coords"]["y"]),
                    project_to_lat_lng(end_mh["coords"]["x"], end_mh["coords"]["y"])
                ]
            conduits_out.append({
                **cond,
                "lat_lng_path": path
            })

        facs_out = []
        for f in SEWER_FACILITIES:
            facs_out.append({
                **f,
                "lat_lng": project_to_lat_lng(f["coords"]["x"], f["coords"]["y"])
            })

        return {
            "network_type": "URBAN_SANITATION_AND_STORMWATER",
            "manholes": mhs_out,
            "conduits": conduits_out,
            "facilities": facs_out,
            "flood_zones": FLOOD_ZONES
        }


_sewer_engine: Optional[SewerFloodEngine] = None

def get_sewer_engine() -> SewerFloodEngine:
    global _sewer_engine
    if _sewer_engine is None:
        _sewer_engine = SewerFloodEngine()
    return _sewer_engine
