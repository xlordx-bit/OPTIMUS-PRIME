import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'

type NetworkNode = {
  id: string
  type: string
  coordinates: { x: number; y: number }
  lat_lng: number[]
  elevation?: number
  base_demand?: number
  is_sensor: boolean
}

type NetworkPipe = {
  id: string
  start_node: string
  end_node: string
  coordinates: number[][]
  lat_lng_path?: number[][]
}

type NetworkResponse = {
  network_name: string
  summary: {
    total_nodes: number
    total_junctions: number
    total_pipes: number
    total_pumps: number
    total_tanks: number
    total_reservoirs: number
    total_sensors: number
  }
  nodes: NetworkNode[]
  pipes: NetworkPipe[]
}

type Sensor = {
  node_id: string
  current_pressure_m: number
  baseline_pressure_m: number
  pressure_drop_m: number
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | string
}

type ActiveLeak = {
  node_id: string
  leak_area_m2: number
  actual_leak_flow_lph: number
  injected_at_hour?: number
}

type NetworkState = {
  timestamp_iso: string
  is_healthy: boolean
  is_leak_injected: boolean
  active_leak: ActiveLeak | null
  summary: {
    mean_sensor_pressure_m: number
    max_pressure_drop_m: number
    total_leakage_flow_lph: number
    sensors_with_pressure_drop_count: number
  }
  sensors: Sensor[]
}

type Suspect = {
  node_id: string
  probability: number
  rank: number
  coordinates?: { x: number; y: number }
  lat_lng?: number[]
}

type WorkOrder = {
  work_order_id: string
  priority: string
  status: string
  primary_suspect_node: string
  candidate_suspect_nodes?: string[]
  estimated_water_loss_lph: number
  recommended_action: string
  isolation_valve_recommendation: string
}

type Detection = {
  leak_detected: boolean
  detector_model: string
  anomaly_score: number
  confidence: number
  estimated_leak_rate_lph: number
  estimated_leak_area_m2: number
  top_suspects: Suspect[]
  work_order_template: WorkOrder | null
}

type WhatIfResponse = {
  scenario_id: string
  status: string
  scenario_name: string
  projected_leak_reduction_pct: number
  projected_savings_lph: number
  service_disruption_impact: string
  pressure_head_change_summary: Record<string, number>
  recommended_execution_order: string[]
}

type AgentStep = {
  step: number
  thought: string
  tool_invoked: string
  result: string
}

type AgentResponse = {
  agent_id: string
  status: string
  reasoning_trace: AgentStep[]
  summary_verdict: string
  suggested_actions: string[]
}

type Operation = 'inject' | 'reset' | 'detect' | 'whatif' | 'agent' | 'wo_update' | 'valve' | 'sim_run' | 'sim_reset' | null
type ActiveTab = 'overview' | 'diagnostics' | 'whatif' | 'agent' | 'monitoring' | 'workorders' | 'valvesim'

// ── Monitoring Types ──────────────────────────────────────────────────────────
type MonitoringOverview = {
  timestamp: string
  is_healthy: boolean
  is_simulated: boolean
  average_pressure_psi: number
  average_pressure_m: number
  average_flow_lmin: number
  total_sensors: number
  normal_sensors: number
  warning_sensors: number
  critical_sensors: number
  total_leakage_lph: number
  max_pressure_drop_m: number
  active_alert_count: number
  thresholds: { pressure_warning_psi: number; pressure_critical_psi: number; flow_warning_lmin: number; flow_critical_lmin: number }
}

type MonitoringSensor = {
  sensor_id: string
  label: string
  zone: string
  status: string
  current_pressure_psi: number
  current_pressure_m: number
  baseline_pressure_psi: number
  pressure_drop_psi: number
  flow_lmin: number
  is_simulated: boolean
  lat_lng: number[]
}

type SensorHistoryPoint = {
  timestamp: string
  timestamp_unix: number
  pressure_psi: number
  pressure_m: number
  flow_lmin: number
  sensor_id: string
}

type MonitoringAlert = {
  alert_id: string
  timestamp: string
  sensor_id: string
  label: string
  type: string
  message: string
  severity: string
  active: boolean
}

// ── Work Order Types ──────────────────────────────────────────────────────────
type WorkOrderItem = {
  work_order_id: string
  created_at: string
  sensor_id: string
  location: string
  zone: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
  incident_type: string
  problem_description: string
  suspected_cause: string
  recommended_action: string
  current_pressure_psi: number
  current_pressure_m: number
  pressure_drop_m: number
  flow_lmin: number
  auto_generated: boolean
  history: { timestamp: string; from_status: string; to_status: string }[]
}

type WOSummary = {
  total: number
  critical: number
  high: number
  medium: number
  low: number
  pending: number
  in_progress: number
  completed: number
}

// ── Valve Simulation Types ────────────────────────────────────────────────────
type SimNode = {
  id: string
  type: string
  coordinates: { x: number; y: number }
  lat_lng: number[]
  pressure_m: number
  pressure_psi: number
  status: string
  is_sensor: boolean
  label: string
  disconnected?: boolean
}

type SimPipe = {
  id: string
  start_node: string
  end_node: string
  coordinates: number[][]
  length: number
  diameter: number
  valve_id: string | null
  valve_status: string
}

type SimValve = {
  valve_id: string
  pipe_id: string
  start_node: string
  end_node: string
  status: string
  coordinates: { x: number; y: number }
}

type SimNetwork = {
  nodes: SimNode[]
  pipes: SimPipe[]
  valves: SimValve[]
  sensor_node_ids: string[]
}

type SimResult = {
  simulation_type: string
  disclaimer: string
  closed_valves: string[]
  closed_pipes: string[]
  disconnected_junctions: string[]
  affected_junction_count: number
  sensor_impacts: {
    sensor_id: string
    label: string
    old_pressure_psi: number
    new_pressure_psi: number
    pressure_change_psi: number
    post_sim_status: string
    disconnected: boolean
  }[]
  network_summary: {
    avg_pressure_before_psi: number
    avg_pressure_after_psi: number
    avg_flow_before_lmin: number
    avg_flow_after_lmin: number
    flow_reduction_pct: number
    disconnected_zone_count: number
  }
  updated_nodes: SimNode[]
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const endpoints = [
    `/api${path}`,
    `http://127.0.0.1:8000${path}`,
    `http://localhost:8000${path}`,
  ]

  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        ...init,
        headers: {
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      })

      if (!response.ok) {
        let message = `Request failed (${response.status})`
        try {
          const json = await response.json()
          if (json && typeof json.detail === 'string') {
            message = json.detail
          }
        } catch {
          // ignore parse error
        }
        throw new Error(message)
      }

      return (await response.json()) as T
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Continue to fallback endpoints only if network error
      const isNetworkErr =
        lastError.message.includes('Failed to fetch') ||
        lastError.message.includes('NetworkError') ||
        lastError.message.includes('404')
      if (!isNetworkErr) {
        throw lastError
      }
    }
  }

  throw lastError ?? new Error('API connection failed')
}

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Waiting for readings'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Icon({
  name,
  size = 18,
}: {
  name:
    | 'drop'
    | 'activity'
    | 'pin'
    | 'pulse'
    | 'refresh'
    | 'scan'
    | 'arrow'
    | 'check'
    | 'alert'
    | 'layers'
    | 'bot'
    | 'zap'
    | 'clipboard'
    | 'gauge'
    | 'wrench'
    | 'valve'
    | 'chart'
    | 'x'
    | 'play'
  size?: number
}) {
  const paths: Record<string, React.ReactNode> = {
    drop: <path d="M12 3.2S5.5 10 5.5 15.1a6.5 6.5 0 0 0 13 0C18.5 10 12 3.2 12 3.2Z" />,
    activity: <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />,
    pin: (
      <>
        <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    pulse: (
      <>
        <path d="M3 12h4l2-5 4 10 2-5h6" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4.9 9a7.5 7.5 0 0 1 12.4-2.8L20 12M4 17v-5h5" />
        <path d="M19.1 15a7.5 7.5 0 0 1-12.4 2.8L4 12" />
      </>
    ),
    scan: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M7 12h10M12 7v10" />
      </>
    ),
    arrow: (
      <>
        <path d="M7 17 17 7M7 7h10v10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    alert: (
      <>
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
    layers: (
      <>
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </>
    ),
    bot: (
      <>
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <line x1="8" y1="16" x2="8.01" y2="16" />
        <line x1="16" y1="16" x2="16.01" y2="16" />
      </>
    ),
    zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    clipboard: (
      <>
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      </>
    ),
    gauge: (
      <>
        <path d="M12 2a10 10 0 1 0 10 10" />
        <path d="M12 12 16 8" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    wrench: (
      <>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </>
    ),
    valve: (
      <>
        <path d="M4 12h16M8 8v8M16 8v8" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    chart: (
      <>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </>
    ),
    x: <path d="M18 6 6 18M6 6l12 12" />,
    play: <polygon points="5 3 19 12 5 21 5 3" />,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function NetworkMap({
  network,
  state,
  detection,
  selectedNode,
  onSelectNode,
}: {
  network: NetworkResponse
  state: NetworkState | null
  detection: Detection | null
  selectedNode: string
  onSelectNode: (id: string) => void
}) {
  const sensorById = useMemo(
    () => new Map(state?.sensors.map((sensor) => [sensor.node_id, sensor]) ?? []),
    [state]
  )
  const suspectsMap = useMemo(
    () => new Map(detection?.top_suspects.map((s) => [s.node_id, s]) ?? []),
    [detection]
  )

  const bounds = useMemo(() => {
    const xs = network.nodes.map((node) => node.coordinates.x)
    const ys = network.nodes.map((node) => node.coordinates.y)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  }, [network.nodes])

  const position = useCallback(
    (x: number, y: number) => {
      const width = Math.max(bounds.maxX - bounds.minX, 1)
      const height = Math.max(bounds.maxY - bounds.minY, 1)
      return {
        x: 32 + ((x - bounds.minX) / width) * 696,
        y: 28 + ((bounds.maxY - y) / height) * 454,
      }
    },
    [bounds]
  )

  return (
    <svg
      className="network-map"
      viewBox="0 0 760 510"
      role="img"
      aria-label="EPANET Net3 water distribution network topology with live telemetry"
    >
      <defs>
        <pattern id="map-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(130, 179, 193, .07)" strokeWidth="1" />
        </pattern>
        <filter id="sensor-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="suspect-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="760" height="510" fill="url(#map-grid)" />

      {/* Pipes */}
      {network.pipes.map((pipe) => {
        const [start, end] = pipe.coordinates
        if (!start || !end) return null
        const a = position(start[0], start[1])
        const b = position(end[0], end[1])
        const isAffected = state?.active_leak
          ? pipe.start_node === state.active_leak.node_id || pipe.end_node === state.active_leak.node_id
          : false
        return (
          <line
            key={pipe.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className={isAffected ? 'pipe-line pipe-line--affected' : 'pipe-line'}
          />
        )
      })}

      {/* Nodes */}
      {network.nodes.map((node) => {
        const point = position(node.coordinates.x, node.coordinates.y)
        const sensor = sensorById.get(node.id)
        const suspect = suspectsMap.get(node.id)
        const status = sensor?.status.toLowerCase() ?? 'normal'
        const isActiveLeak = state?.active_leak?.node_id === node.id
        const isSelected = selectedNode === node.id

        return (
          <g
            key={node.id}
            className={`map-node ${isActiveLeak ? 'map-node--leak' : ''} ${
              isSelected ? 'map-node--selected' : ''
            }`}
            onClick={() => onSelectNode(node.id)}
            style={{ cursor: 'pointer' }}
          >
            {/* Active leak animated waves */}
            {isActiveLeak && (
              <>
                <circle cx={point.x} cy={point.y} r="22" className="leak-ring leak-ring--outer" />
                <circle cx={point.x} cy={point.y} r="14" className="leak-ring" />
              </>
            )}

            {/* Suspect halo from ML model */}
            {suspect && !isActiveLeak && (
              <circle
                cx={point.x}
                cy={point.y}
                r={suspect.rank === 1 ? 16 : 11}
                className={`suspect-ring suspect-ring--rank${suspect.rank}`}
                filter="url(#suspect-glow)"
              />
            )}

            {/* Selection ring */}
            {isSelected && !isActiveLeak && (
              <circle cx={point.x} cy={point.y} r="10" className="selection-ring" />
            )}

            {/* Main node dot */}
            <circle
              cx={point.x}
              cy={point.y}
              r={sensor ? 5.5 : node.type === 'junction' ? 2.5 : 5}
              className={`node-dot node-dot--${sensor ? status : node.type} ${
                suspect ? 'node-dot--suspect' : ''
              }`}
              filter={sensor ? 'url(#sensor-glow)' : undefined}
            >
              <title>{`Node ${node.id} (${node.type})${
                sensor ? ` · Sensor: ${sensor.status} (${formatNumber(sensor.pressure_drop_m, 2)}m drop)` : ''
              }${suspect ? ` · Suspect #${suspect.rank} (${formatNumber(suspect.probability * 100, 1)}%)` : ''}`}</title>
            </circle>

            {/* Label for sensors or suspects */}
            {(sensor || suspect || isSelected) && (
              <text
                x={point.x + 8}
                y={point.y - 7}
                className={`map-label ${suspect ? 'map-label--suspect' : ''} ${
                  isSelected ? 'map-label--selected' : ''
                }`}
              >
                {suspect ? `#${suspect.rank} ` : ''}
                {node.id}
              </text>
            )}
          </g>
        )
      })}

      <g className="map-compass" transform="translate(704 58)">
        <path d="M0 14 6 0l6 14-6-4-6 4Z" />
        <text x="6" y="25" textAnchor="middle">
          N
        </text>
      </g>
    </svg>
  )
}

const SENSOR_LABELS: Record<string, string> = {
  '10': 'Intake Zone A',
  '15': 'District North',
  '105': 'Residential B',
  '117': 'Junction Hub 117',
  '123': 'Industrial Sector',
  '129': 'District East',
  '149': 'Park Zone',
  '181': 'Hospital Wing',
  '195': 'Commerce Centre',
  '206': 'Pump Station Out',
  '217': 'Elevated Tank Feed',
  '247': 'Reservoir Outlet',
}

function PressureChart({
  history,
  sensorLabel,
  baselinePsi,
  warnThreshold = 55,
  critThreshold = 40,
}: {
  history: SensorHistoryPoint[]
  sensorLabel: string
  baselinePsi: number
  warnThreshold?: number
  critThreshold?: number
}) {
  if (!history || history.length === 0) {
    return (
      <div className="telemetry-chart-container">
        <div className="chart-empty">No telemetry history recorded for this sensor.</div>
      </div>
    )
  }

  const pressures = history.map((p) => p.pressure_psi)
  const allVals = [...pressures, baselinePsi, warnThreshold, critThreshold]
  const minVal = Math.max(0, Math.floor(Math.min(...allVals) - 5))
  const maxVal = Math.ceil(Math.max(...allVals) + 5)
  const range = Math.max(maxVal - minVal, 1)

  const width = 640
  const height = 220
  const padLeft = 45
  const padRight = 20
  const padTop = 20
  const padBottom = 30
  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const getY = (val: number) => padTop + chartH - ((val - minVal) / range) * chartH
  const getX = (idx: number) => padLeft + (idx / Math.max(history.length - 1, 1)) * chartW

  const pointsStr = history
    .map((p, i) => `${getX(i).toFixed(1)},${getY(p.pressure_psi).toFixed(1)}`)
    .join(' ')

  const areaStr = `${pointsStr} ${getX(history.length - 1).toFixed(1)},${(padTop + chartH).toFixed(1)} ${padLeft},${(padTop + chartH).toFixed(1)}`

  const warnY = getY(warnThreshold)
  const critY = getY(critThreshold)
  const baseY = getY(baselinePsi)

  return (
    <div className="telemetry-chart-container">
      <div className="chart-header">
        <div>
          <h4>{sensorLabel} — Pressure Stream (Last 30 Mins)</h4>
          <span className="chart-sub">Live telemetry curve vs safety boundary thresholds</span>
        </div>
        <div className="chart-legend">
          <span className="legend-item"><i className="legend-line legend-line--stream" /> Live Pressure</span>
          <span className="legend-item"><i className="legend-line legend-line--baseline" /> Baseline ({baselinePsi.toFixed(1)} PSI)</span>
          <span className="legend-item"><i className="legend-line legend-line--warn" /> Warning ({warnThreshold} PSI)</span>
          <span className="legend-item"><i className="legend-line legend-line--crit" /> Critical ({critThreshold} PSI)</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="telemetry-svg" role="img" aria-label="Pressure chart">
        <defs>
          <linearGradient id="pressGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#56dccb" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#56dccb" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[minVal, critThreshold, warnThreshold, Math.round((maxVal + warnThreshold) / 2), maxVal].map((val, idx) => {
          const y = getY(val)
          return (
            <g key={idx}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="2,2" />
              <text x={padLeft - 8} y={y + 4} fill="#69818a" fontSize="10" textAnchor="end">{val}</text>
            </g>
          )
        })}

        {/* Threshold lines */}
        <line x1={padLeft} y1={critY} x2={width - padRight} y2={critY} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,4" />
        <line x1={padLeft} y1={warnY} x2={width - padRight} y2={warnY} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4,4" />
        <line x1={padLeft} y1={baseY} x2={width - padRight} y2={baseY} stroke="#0ea5e9" strokeWidth="1" strokeDasharray="3,3" />

        {/* Area fill */}
        <polygon points={areaStr} fill="url(#pressGrad)" />

        {/* Pressure line */}
        <polyline points={pointsStr} fill="none" stroke="#56dccb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points */}
        {history.map((p, i) => (
          <circle
            key={i}
            cx={getX(i)}
            cy={getY(p.pressure_psi)}
            r={i === history.length - 1 ? 4.5 : 2.5}
            fill={i === history.length - 1 ? '#56dccb' : '#071116'}
            stroke="#56dccb"
            strokeWidth="1.5"
          >
            <title>{`${p.timestamp}: ${p.pressure_psi.toFixed(1)} PSI`}</title>
          </circle>
        ))}

        {/* X axis labels */}
        <text x={padLeft} y={height - 8} fill="#69818a" fontSize="10">-30m</text>
        <text x={padLeft + chartW / 2} y={height - 8} fill="#69818a" fontSize="10" textAnchor="middle">-15m</text>
        <text x={width - padRight} y={height - 8} fill="#56dccb" fontSize="10" textAnchor="end" fontWeight="bold">NOW</text>
      </svg>
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')
  const [network, setNetwork] = useState<NetworkResponse | null>(null)
  const [state, setState] = useState<NetworkState | null>(null)
  const [detection, setDetection] = useState<Detection | null>(null)
  const [selectedNode, setSelectedNode] = useState('117')
  const [leakArea, setLeakArea] = useState(0.002)
  const [operation, setOperation] = useState<Operation>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // What-If State
  const [whatIfAction, setWhatIfAction] = useState<'valve_closure' | 'pressure_reduction' | 'pump_speed'>('valve_closure')
  const [whatIfLink, setWhatIfLink] = useState('111')
  const [whatIfReductionPct, setWhatIfReductionPct] = useState(20)
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResponse | null>(null)

  // AI Agent State
  const [agentPrompt, setAgentPrompt] = useState('What is the optimal containment plan for the current anomaly?')
  const [agentResult, setAgentResult] = useState<AgentResponse | null>(null)

  // Monitoring State
  const [monOverview, setMonOverview] = useState<MonitoringOverview | null>(null)
  const [monSensors, setMonSensors] = useState<MonitoringSensor[]>([])
  const [monAlerts, setMonAlerts] = useState<MonitoringAlert[]>([])
  const [selectedMonSensor, setSelectedMonSensor] = useState<string>('117')
  const [sensorHistory, setSensorHistory] = useState<SensorHistoryPoint[]>([])
  const [monLoading, setMonLoading] = useState(false)

  // Work Orders State
  const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([])
  const [woSummary, setWoSummary] = useState<WOSummary | null>(null)
  const [selectedWO, setSelectedWO] = useState<WorkOrderItem | null>(null)
  const [woLoading, setWoLoading] = useState(false)
  const [manualWOSensor, setManualWOSensor] = useState('117')
  const [manualWOSeverity, setManualWOSeverity] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('HIGH')
  const [manualWODesc, setManualWODesc] = useState('Inspect junction for suspected pipe fissure')
  const [showManualWOModal, setShowManualWOModal] = useState(false)
  const [woFilterStatus, setWoFilterStatus] = useState<string>('ALL')

  // Valve Simulation State
  const [simNetwork, setSimNetwork] = useState<SimNetwork | null>(null)
  const [simResult, setSimResult] = useState<SimResult | null>(null)
  const [selectedValve, setSelectedValve] = useState<string | null>(null)
  const [simLoading, setSimLoading] = useState(false)

  const loadNetwork = useCallback(async () => {
    const data = await apiRequest<NetworkResponse>('/network')
    setNetwork(data)
    setSelectedNode((current) =>
      data.nodes.some((node) => node.id === current && node.type === 'junction')
        ? current
        : data.nodes.find((node) => node.type === 'junction')?.id ?? '117'
    )
  }, [])

  const loadState = useCallback(async () => {
    const data = await apiRequest<NetworkState>('/state')
    setState(data)
    setApiError(null)
  }, [])

  const refreshDashboard = useCallback(async () => {
    setApiError(null)
    try {
      await Promise.all([loadNetwork(), loadState()])
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Could not connect to backend.')
    } finally {
      setInitialLoading(false)
    }
  }, [loadNetwork, loadState])

  useEffect(() => {
    void refreshDashboard()
    const timer = window.setInterval(() => {
      void loadState().catch((error: unknown) => {
        setApiError(error instanceof Error ? error.message : 'Sensor telemetry refresh paused.')
      })
    }, 6000)
    return () => window.clearInterval(timer)
  }, [loadState, refreshDashboard])

  const junctions = useMemo(
    () => network?.nodes.filter((node) => node.type === 'junction') ?? [],
    [network]
  )

  const selectedNodeDetails = useMemo(() => {
    if (!network) return null
    const n = network.nodes.find((node) => node.id === selectedNode)
    const s = state?.sensors.find((sensor) => sensor.node_id === selectedNode)
    return { node: n, sensor: s }
  }, [network, selectedNode, state])

  // --- Feature 1: Pressure Monitoring Handlers ---
  const loadMonitoringData = useCallback(async () => {
    setMonLoading(true)
    try {
      const [overview, sensorsRes, alertsRes] = await Promise.all([
        apiRequest<MonitoringOverview>('/monitoring/overview'),
        apiRequest<{ sensors: MonitoringSensor[]; count: number }>('/monitoring/sensors'),
        apiRequest<{ alerts: MonitoringAlert[]; count: number }>('/monitoring/alerts'),
      ])
      setMonOverview(overview)
      setMonSensors(sensorsRes.sensors)
      setMonAlerts(alertsRes.alerts)
    } catch (err) {
      console.error('Monitoring data load failed:', err)
    } finally {
      setMonLoading(false)
    }
  }, [])

  const loadSensorHistory = useCallback(async (sensorId: string) => {
    try {
      const data = await apiRequest<{
        sensor_id: string
        points: number
        history: SensorHistoryPoint[]
      }>(`/monitoring/sensors/${sensorId}?points=30`)
      setSensorHistory(data.history || [])
    } catch (err) {
      console.error('Sensor history load failed:', err)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'monitoring') {
      void loadMonitoringData()
      void loadSensorHistory(selectedMonSensor)
      const interval = setInterval(() => {
        void loadMonitoringData()
      }, 5000)
      return () => clearInterval(interval)
    }
  }, [activeTab, loadMonitoringData, loadSensorHistory, selectedMonSensor])

  const currentMonSensor = useMemo(() => {
    return monSensors.find((s) => s.sensor_id === selectedMonSensor) || monSensors[0]
  }, [monSensors, selectedMonSensor])

  // --- Feature 2: Work Orders Handlers ---
  const loadWorkOrders = useCallback(async () => {
    setWoLoading(true)
    try {
      const data = await apiRequest<{
        work_orders: WorkOrderItem[]
        summary: WOSummary
      }>('/work-orders')
      setWorkOrders(data.work_orders)
      setWoSummary(data.summary)
      if (data.work_orders.length > 0) {
        setSelectedWO((curr) =>
          curr
            ? data.work_orders.find((w) => w.work_order_id === curr.work_order_id) ?? data.work_orders[0]
            : data.work_orders[0]
        )
      }
    } catch (err) {
      console.error('Work orders load failed:', err)
    } finally {
      setWoLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'workorders') {
      void loadWorkOrders()
    }
  }, [activeTab, loadWorkOrders])

  async function handleUpdateWOStatus(woId: string, newStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED') {
    setOperation('wo_update')
    try {
      const updated = await apiRequest<WorkOrderItem>(`/work-orders/${woId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      setWorkOrders((prev) => prev.map((w) => (w.work_order_id === woId ? updated : w)))
      if (selectedWO?.work_order_id === woId) {
        setSelectedWO(updated)
      }
      void loadWorkOrders()
      setNotice(`Work order ${woId} moved to ${newStatus}`)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to update work order')
    } finally {
      setOperation(null)
    }
  }

  async function handleCreateManualWO(e: FormEvent) {
    e.preventDefault()
    try {
      const created = await apiRequest<WorkOrderItem>('/work-orders', {
        method: 'POST',
        body: JSON.stringify({
          sensor_id: manualWOSensor,
          severity: manualWOSeverity,
          problem_description: manualWODesc,
          incident_type: 'MANUAL_INSPECTION',
          suspected_cause: 'Field engineer manual request triggered from monitoring interface',
          recommended_action: 'Conduct ultrasonic leak localization and junction pressure check',
        }),
      })
      setWorkOrders((prev) => [created, ...prev])
      setSelectedWO(created)
      setShowManualWOModal(false)
      void loadWorkOrders()
      setNotice(`Dispatched Work Order ${created.work_order_id} for Junction ${created.sensor_id}`)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to create work order')
    }
  }

  // --- Feature 3: Valve Simulation Handlers ---
  const loadValveSim = useCallback(async () => {
    setSimLoading(true)
    try {
      const data = await apiRequest<SimNetwork>('/simulation/network')
      setSimNetwork(data)
      if (data.valves.length > 0) {
        setSelectedValve((curr) => curr ?? data.valves[0].valve_id)
      }
    } catch (err) {
      console.error('Simulation network load failed:', err)
    } finally {
      setSimLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'valvesim') {
      void loadValveSim()
    }
  }, [activeTab, loadValveSim])

  async function handleToggleValve(valveId: string, currentStatus: string) {
    setOperation('valve')
    try {
      const nextAction = currentStatus === 'CLOSED' ? 'OPEN' : 'CLOSE'
      await apiRequest<{
        valve_id: string
        action: string
        new_status: string
      }>('/simulation/valve', {
        method: 'POST',
        body: JSON.stringify({ valve_id: valveId, action: nextAction }),
      })
      await loadValveSim()
      setNotice(`Simulated Valve ${valveId} toggled to ${nextAction === 'CLOSE' ? 'CLOSED' : 'OPEN'} (Digital Twin mode)`)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to set valve')
    } finally {
      setOperation(null)
    }
  }

  async function handleRunSim() {
    setOperation('sim_run')
    try {
      const result = await apiRequest<SimResult>('/simulation/run', {
        method: 'POST',
      })
      setSimResult(result)
      setNotice(`Hydraulic graph propagation complete: ${result.affected_junction_count} junctions evaluated.`)
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Simulation run failed')
    } finally {
      setOperation(null)
    }
  }

  async function handleResetSim() {
    setOperation('sim_reset')
    try {
      await apiRequest<{ message: string }>('/simulation/reset', {
        method: 'POST',
      })
      setSimResult(null)
      await loadValveSim()
      setNotice('All simulated valves restored to default OPEN status.')
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Simulation reset failed')
    } finally {
      setOperation(null)
    }
  }

  // Handle Inject Leak
  async function handleInject(event?: FormEvent) {
    if (event) event.preventDefault()
    setOperation('inject')
    setApiError(null)
    setNotice(null)
    setDetection(null)
    try {
      const result = await apiRequest<{
        message: string
        actual_leak_flow_lph: number
        max_pressure_drop_m: number
      }>('/inject-leak', {
        method: 'POST',
        body: JSON.stringify({
          node_id: selectedNode,
          leak_area: leakArea,
          start_time_seconds: 0,
        }),
      })
      await loadState()
      setNotice(
        `${result.message} Loss rate: ${formatNumber(result.actual_leak_flow_lph, 0)} L/h (Max Drop: ${formatNumber(
          result.max_pressure_drop_m,
          2
        )}m)`
      )
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Leak injection simulation failed.')
    } finally {
      setOperation(null)
    }
  }

  // Handle Reset
  async function handleReset() {
    setOperation('reset')
    setApiError(null)
    setNotice(null)
    setDetection(null)
    setWhatIfResult(null)
    setAgentResult(null)
    try {
      const result = await apiRequest<{ message: string; state: NetworkState }>('/reset', {
        method: 'POST',
      })
      setState(result.state)
      setNotice('Network successfully restored to healthy EPANET baseline state.')
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Digital twin reset failed.')
    } finally {
      setOperation(null)
    }
  }

  // Handle Run Detection
  async function handleDetect() {
    setOperation('detect')
    setApiError(null)
    setNotice(null)
    try {
      const result = await apiRequest<Detection>('/detect')
      setDetection(result)
      if (result.leak_detected) {
        setNotice(
          `Leak anomaly detected! Model localized top suspect to Junction ${result.top_suspects[0]?.node_id ?? 'Unknown'}`
        )
      } else {
        setNotice('No hydraulic anomaly detected. All sensor pressures within normal baseline bounds.')
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Leak diagnostics failed.')
    } finally {
      setOperation(null)
    }
  }

  // Handle What-If Simulation
  async function handleWhatIf(event?: FormEvent) {
    if (event) event.preventDefault()
    setOperation('whatif')
    setApiError(null)
    setNotice(null)
    try {
      const result = await apiRequest<WhatIfResponse>('/what-if', {
        method: 'POST',
        body: JSON.stringify({
          action_type: whatIfAction,
          target_link_id: whatIfLink,
          target_node_id: selectedNode,
          pressure_reduction_pct: whatIfReductionPct,
        }),
      })
      setWhatIfResult(result)
      setNotice(`What-If simulated: "${result.scenario_name}" evaluated.`)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'What-If scenario simulation failed.')
    } finally {
      setOperation(null)
    }
  }

  // Handle AI Agent Query
  async function handleAgent(event?: FormEvent) {
    if (event) event.preventDefault()
    setOperation('agent')
    setApiError(null)
    setNotice(null)
    try {
      const result = await apiRequest<AgentResponse>('/agent', {
        method: 'POST',
        body: JSON.stringify({ prompt: agentPrompt }),
      })
      setAgentResult(result)
      setNotice(`Agent (${result.agent_id}) completed multi-step root-cause trace.`)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Autonomous operations agent failed.')
    } finally {
      setOperation(null)
    }
  }

  const isHealthy = state?.is_healthy ?? true
  const online = Boolean(network && state && !apiError)
  const statusLabel = state ? (isHealthy ? 'All Systems Healthy' : 'Active Network Anomaly') : 'Connecting Twin'

  return (
    <main className="app-shell">
      {/* Top Header */}
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="NirX Operations Center">
          <span className="brand-mark">
            <Icon name="drop" size={22} />
          </span>
          <span className="brand-copy">
            <strong>NIRX</strong>
            <small>WATER INTELLIGENCE</small>
          </span>
        </a>

        {/* Navigation Tabs */}
        <nav className="nav-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'overview' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <Icon name="layers" size={15} />
            <span>Live Operations</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'monitoring' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('monitoring')}
          >
            <Icon name="gauge" size={15} />
            <span>Pressure Monitoring</span>
            {monAlerts.length > 0 && <span className="tab-badge tab-badge--alert">{monAlerts.length}</span>}
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'workorders' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('workorders')}
          >
            <Icon name="wrench" size={15} />
            <span>AI Work Orders</span>
            {woSummary && woSummary.pending > 0 && (
              <span className="tab-badge tab-badge--warning">{woSummary.pending}</span>
            )}
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'valvesim' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('valvesim')}
          >
            <Icon name="valve" size={15} />
            <span>Valve Simulation</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'diagnostics' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('diagnostics')}
          >
            <Icon name="scan" size={15} />
            <span>ML Diagnostics</span>
            {detection?.leak_detected && <span className="tab-badge tab-badge--alert">!</span>}
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'whatif' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('whatif')}
          >
            <Icon name="zap" size={15} />
            <span>What-If</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'agent' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <Icon name="bot" size={15} />
            <span>AI Agent</span>
          </button>
        </nav>

        {/* Topbar Right */}
        <div className="topbar-right">
          <a
            className="docs-link"
            href="http://127.0.0.1:8000/docs"
            target="_blank"
            rel="noreferrer"
            title="Open Interactive FastAPI Swagger Documentation"
          >
            API Docs <Icon name="arrow" size={13} />
          </a>
          <span className={`connection-badge ${online ? 'is-online' : ''}`}>
            <span className="connection-dot" /> {online ? 'TWIN ONLINE (8000)' : 'API RECONNECTING'}
          </span>
        </div>
      </header>

      <div className="dashboard">
        {/* Page Subheader */}
        <section className="page-heading" id="overview">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" /> EPANET NET3 DIGITAL TWIN ENGINE & ML TELEMETRY
            </div>
            <h1>
              Water Distribution <span>Digital Twin.</span>
            </h1>
            <p className="page-description">
              Real-time hydraulic simulation with Pressure-Driven Demand (WNTR), automated Scikit-Learn leak
              localization, scenario containment, and intelligent crew dispatch.
            </p>
          </div>
          <div className={`system-state ${!isHealthy ? 'system-state--alert' : ''}`}>
            <span className="system-state-icon">
              <Icon name={isHealthy ? 'check' : 'alert'} size={18} />
            </span>
            <span>
              <strong>{statusLabel}</strong>
              <small>{state ? `Updated ${formatTime(state.timestamp_iso)}` : 'Connecting...'}</small>
            </span>
          </div>
        </section>

        {/* Status Alerts & Feedbacks */}
        {apiError && (
          <div className="feedback feedback--error" role="alert">
            <span>
              <strong>Backend Connection Notice:</strong> {apiError}
            </span>
            <button type="button" className="text-button" onClick={() => void refreshDashboard()}>
              Retry Connection
            </button>
          </div>
        )}

        {notice && (
          <div className="feedback feedback--success" role="status">
            <Icon name="check" size={16} />
            <span>{notice}</span>
            <button
              type="button"
              className="feedback-close"
              aria-label="Dismiss notice"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}

        {/* Top Metrics Cards */}
        <section className="metric-grid" aria-label="Key Performance Indicators">
          <article className="metric-card">
            <div className="metric-card-top">
              <span className="metric-icon metric-icon--blue">
                <Icon name="activity" />
              </span>
              <span className={`metric-chip ${isHealthy ? '' : 'metric-chip--alert'}`}>
                {isHealthy ? 'STABLE' : 'ATTENTION'}
              </span>
            </div>
            <div className="metric-label">Mean Sensor Pressure</div>
            <div className="metric-value">
              {state ? formatNumber(state.summary.mean_sensor_pressure_m, 1) : '—'}
              <span>m</span>
            </div>
            <div className="metric-foot">
              Across {state?.sensors.length ?? network?.summary.total_sensors ?? '—'} live sensor nodes
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-card-top">
              <span className="metric-icon metric-icon--cyan">
                <Icon name="drop" />
              </span>
              <span className={`metric-chip ${state?.is_leak_injected ? 'metric-chip--alert' : ''}`}>
                {state?.is_leak_injected ? 'PHYSICAL LEAK' : 'BASELINE'}
              </span>
            </div>
            <div className="metric-label">Water Loss Discharge Rate</div>
            <div className="metric-value">
              {state ? formatNumber(state.summary.total_leakage_flow_lph, 0) : '—'}
              <span className="metric-unit">L/h</span>
            </div>
            <div className="metric-foot">
              {state?.active_leak
                ? `Active rupture at Junction ${state.active_leak.node_id} (${state.active_leak.leak_area_m2} m²)`
                : 'Zero unintended volume loss'}
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-card-top">
              <span className="metric-icon metric-icon--amber">
                <Icon name="pulse" />
              </span>
              <span className="metric-chip">
                {state?.summary.sensors_with_pressure_drop_count ? 'PRESSURE DROPS' : 'NOMINAL'}
              </span>
            </div>
            <div className="metric-label">Sensors In Deficit (&gt;1m)</div>
            <div className="metric-value">
              {state ? formatNumber(state.summary.sensors_with_pressure_drop_count, 0) : '—'}
              <span>/{state?.sensors.length ?? network?.summary.total_sensors ?? '—'}</span>
            </div>
            <div className="metric-foot">
              Peak observed drop: {state ? `${formatNumber(state.summary.max_pressure_drop_m, 2)} m` : '—'}
            </div>
          </article>

          <article className="metric-card">
            <div className="metric-card-top">
              <span className="metric-icon metric-icon--green">
                <Icon name="pin" />
              </span>
              <span className="metric-chip">EPANET NET3</span>
            </div>
            <div className="metric-label">Network Assets Modelled</div>
            <div className="metric-value">
              {network ? formatNumber(network.summary.total_nodes, 0) : '—'}
              <span>nodes</span>
            </div>
            <div className="metric-foot">
              {network
                ? `${network.summary.total_pipes} pipes · ${network.summary.total_pumps} pumps · ${network.summary.total_tanks} tanks`
                : 'Loading EPANET topology...'}
            </div>
          </article>
        </section>

        {/* TAB 1: OVERVIEW & MAP */}
        {activeTab === 'overview' && (
          <>
            <section className="main-grid">
              {/* Map Panel */}
              <article className="panel map-panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">HYDRAULIC NETWORK TOPOLOGY</div>
                    <h2>{network?.network_name ?? 'EPANET Net3 Topology'}</h2>
                  </div>
                  <div className="panel-actions">
                    {selectedNodeDetails?.node && (
                      <span className="node-pill">
                        Selected: <strong>Junction {selectedNode}</strong>
                      </span>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Refresh dashboard"
                      onClick={() => void refreshDashboard()}
                      disabled={initialLoading}
                      title="Refresh hydraulic state"
                    >
                      <Icon name="refresh" />
                    </button>
                  </div>
                </div>

                <div className="map-wrap">
                  {network ? (
                    <NetworkMap
                      network={network}
                      state={state}
                      detection={detection}
                      selectedNode={selectedNode}
                      onSelectNode={(id) => setSelectedNode(id)}
                    />
                  ) : (
                    <div className="map-placeholder">
                      {initialLoading ? 'Initializing hydraulic model & topology…' : 'Topology unavailable.'}
                    </div>
                  )}

                  <div className="map-overlay map-overlay--top">
                    <span className="map-live-dot" /> LIVE WNTR TELEMETRY <span className="overlay-divider" />{' '}
                    CLICK NODE TO TARGET
                  </div>

                  <div className="map-overlay map-overlay--bottom">
                    <span>
                      <i className="legend-dot legend-dot--sensor" /> SENSOR
                    </span>
                    <span>
                      <i className="legend-dot legend-dot--normal" /> NORMAL
                    </span>
                    <span>
                      <i className="legend-dot legend-dot--warning" /> WARNING (&gt;0.8m)
                    </span>
                    <span>
                      <i className="legend-dot legend-dot--critical" /> CRITICAL (&gt;2.0m)
                    </span>
                    <span>
                      <i className="legend-dot legend-dot--suspect" /> ML SUSPECT
                    </span>
                  </div>
                </div>

                <div className="map-footer">
                  <div>
                    <strong>{network ? formatNumber(network.summary.total_pipes, 0) : '—'}</strong>
                    <span>PIPE LINKS</span>
                  </div>
                  <div>
                    <strong>{network ? formatNumber(network.summary.total_junctions, 0) : '—'}</strong>
                    <span>JUNCTIONS</span>
                  </div>
                  <div>
                    <strong>{network ? formatNumber(network.summary.total_sensors, 0) : '—'}</strong>
                    <span>MONITORS</span>
                  </div>
                  <div className="map-footer-note">
                    <Icon name="pulse" size={14} /> PDD WNTR Simulation · Click map nodes to inspect & inject
                  </div>
                </div>
              </article>

              {/* Sidebar */}
              <aside className="side-column">
                {/* Selected Node Details Card */}
                <article className="panel node-detail-panel">
                  <div className="panel-heading panel-heading--compact">
                    <div>
                      <div className="eyebrow">TARGET ASSET</div>
                      <h2>Junction {selectedNode}</h2>
                    </div>
                    <span className="status-badge">
                      {selectedNodeDetails?.sensor ? 'MONITORED SENSOR' : 'STANDARD JUNCTION'}
                    </span>
                  </div>
                  <div className="node-stats">
                    <div className="node-stat-item">
                      <span className="stat-label">Elevation</span>
                      <strong className="stat-value">{selectedNodeDetails?.node?.elevation ?? 0} m</strong>
                    </div>
                    <div className="node-stat-item">
                      <span className="stat-label">Base Demand</span>
                      <strong className="stat-value">
                        {((selectedNodeDetails?.node?.base_demand ?? 0) * 3600).toFixed(1)} m³/h
                      </strong>
                    </div>
                    {selectedNodeDetails?.sensor && (
                      <>
                        <div className="node-stat-item">
                          <span className="stat-label">Head Reading</span>
                          <strong className="stat-value">
                            {formatNumber(selectedNodeDetails.sensor.current_pressure_m, 2)} m
                          </strong>
                        </div>
                        <div className="node-stat-item">
                          <span className="stat-label">Deficit Drop</span>
                          <strong
                            className={`stat-value ${
                              selectedNodeDetails.sensor.pressure_drop_m > 0.5 ? 'stat-value--alert' : ''
                            }`}
                          >
                            +{formatNumber(selectedNodeDetails.sensor.pressure_drop_m, 2)} m
                          </strong>
                        </div>
                      </>
                    )}
                  </div>
                </article>

                {/* Leak Simulator Controls */}
                <article className="panel controls-panel">
                  <div className="panel-heading panel-heading--compact">
                    <div>
                      <div className="eyebrow">HYDRAULIC SIMULATION</div>
                      <h2>Leak Injection Studio</h2>
                    </div>
                    <span className="simulation-tag">WNTR ENGINE</span>
                  </div>

                  <form onSubmit={handleInject} className="simulation-form">
                    <label htmlFor="junction-select">Target Leak Node</label>
                    <div className="select-wrap">
                      <select
                        id="junction-select"
                        value={selectedNode}
                        onChange={(event) => setSelectedNode(event.target.value)}
                        disabled={junctions.length === 0 || operation !== null}
                      >
                        {junctions.map((node) => (
                          <option value={node.id} key={node.id}>
                            Junction {node.id} {node.is_sensor ? '(Sensor)' : ''}
                          </option>
                        ))}
                      </select>
                      <span className="select-chevron">⌄</span>
                    </div>

                    <div className="quick-presets">
                      <span>Quick Demo Targets:</span>
                      <div className="preset-buttons">
                        <button
                          type="button"
                          className="preset-pill"
                          onClick={() => {
                            setSelectedNode('117')
                            setLeakArea(0.002)
                          }}
                        >
                          Node 117 (Burst)
                        </button>
                        <button
                          type="button"
                          className="preset-pill"
                          onClick={() => {
                            setSelectedNode('123')
                            setLeakArea(0.001)
                          }}
                        >
                          Node 123 (Leak)
                        </button>
                        <button
                          type="button"
                          className="preset-pill"
                          onClick={() => {
                            setSelectedNode('257')
                            setLeakArea(0.003)
                          }}
                        >
                          Node 257 (Severe)
                        </button>
                      </div>
                    </div>

                    <div className="range-heading">
                      <label htmlFor="leak-area">Orifice Hole Area</label>
                      <strong>
                        {leakArea.toFixed(4)} <small>m²</small>
                      </strong>
                    </div>
                    <input
                      id="leak-area"
                      type="range"
                      min="0.0005"
                      max="0.0100"
                      step="0.0005"
                      value={leakArea}
                      onChange={(event) => setLeakArea(Number(event.target.value))}
                      disabled={operation !== null}
                    />
                    <div className="range-scale">
                      <span>0.0005 m² (Minor)</span>
                      <span>0.0100 m² (Catastrophic)</span>
                    </div>

                    <div className="btn-stack">
                      <button
                        type="submit"
                        className="button button--primary button--full"
                        disabled={!network || !state || operation !== null}
                      >
                        <Icon name="drop" size={16} />
                        {operation === 'inject' ? 'Simulating Hydraulic Response...' : 'Inject Physical Leak'}
                      </button>

                      <button
                        type="button"
                        className="button button--quiet button--full"
                        onClick={() => void handleReset()}
                        disabled={!state || operation !== null}
                      >
                        <Icon name="refresh" size={15} />
                        {operation === 'reset' ? 'Restoring Baseline...' : 'Reset Network to Healthy'}
                      </button>
                    </div>
                  </form>
                </article>
              </aside>
            </section>

            {/* Live Telemetry Table */}
            <section className="bottom-grid">
              <article className="panel sensor-table-panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">PRESSURE MONITORING TELEMETRY</div>
                    <h2>Sensor Readings Stream</h2>
                  </div>
                  <span className="table-sync">
                    <span className="connection-dot" />{' '}
                    {state ? `STREAM ACTIVE ${formatTime(state.timestamp_iso)}` : 'WAITING FOR DATA'}
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>SENSOR NODE</th>
                        <th>STATUS</th>
                        <th>CURRENT PRESSURE</th>
                        <th>BASELINE</th>
                        <th>PRESSURE DEFICIT</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state?.sensors.map((sensor) => {
                        const dropWidth = Math.min(100, Math.max(0, (sensor.pressure_drop_m / 3.0) * 100))
                        const isSensorSelected = selectedNode === sensor.node_id
                        return (
                          <tr
                            key={sensor.node_id}
                            className={isSensorSelected ? 'row-selected' : ''}
                            onClick={() => setSelectedNode(sensor.node_id)}
                          >
                            <td>
                              <span className="table-node">
                                <i className={`sensor-status-dot sensor-status-dot--${sensor.status.toLowerCase()}`} />
                                Node {sensor.node_id}
                              </span>
                            </td>
                            <td>
                              <span className={`status-pill status-pill--${sensor.status.toLowerCase()}`}>
                                {sensor.status}
                              </span>
                            </td>
                            <td className="table-reading">
                              {formatNumber(sensor.current_pressure_m, 2)} <small>m</small>
                            </td>
                            <td className="table-muted">{formatNumber(sensor.baseline_pressure_m, 2)} m</td>
                            <td>
                              <div className="drop-cell">
                                <div className="drop-track">
                                  <span
                                    className={
                                      sensor.pressure_drop_m >= 2.0
                                        ? 'drop-fill drop-fill--critical'
                                        : sensor.pressure_drop_m >= 0.8
                                        ? 'drop-fill drop-fill--warning'
                                        : 'drop-fill'
                                    }
                                    style={{ width: `${dropWidth}%` }}
                                  />
                                </div>
                                <span className="table-reading">
                                  {sensor.pressure_drop_m > 0 ? '+' : ''}
                                  {formatNumber(sensor.pressure_drop_m, 2)} m
                                </span>
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="action-pill-btn"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedNode(sensor.node_id)
                                }}
                              >
                                Focus
                              </button>
                            </td>
                          </tr>
                        )
                      }) ?? (
                        <tr>
                          <td className="empty-table" colSpan={6}>
                            {initialLoading ? 'Connecting to sensors…' : 'No sensor data available.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          </>
        )}

        {/* TAB 2: ML DIAGNOSTICS & WORK ORDERS */}
        {activeTab === 'diagnostics' && (
          <section className="diagnostics-view">
            <div className="diagnostics-hero-grid">
              {/* Trigger & Overview Card */}
              <article className="panel diagnostics-control-card">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">MACHINE LEARNING PIPELINE</div>
                    <h2>Dual-Model Leak Engine</h2>
                  </div>
                  <span className="model-tag">ISO-FOREST + RANDOM FOREST</span>
                </div>
                <p className="lead-copy">
                  Analyzes current hydraulic sensor deviations against trained baseline covariance to detect
                  abrupt leaks, predict orifice discharge volume, and isolate suspect coordinates.
                </p>

                <div className="diagnostics-action-bar">
                  <button
                    type="button"
                    className="button button--primary button--lg"
                    onClick={() => void handleDetect()}
                    disabled={!state || operation !== null}
                  >
                    <Icon name="scan" size={18} />
                    {operation === 'detect' ? 'Running Model Inference...' : 'Run Leak Diagnostics Now'}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => void handleReset()}
                    disabled={!state || operation !== null}
                  >
                    <Icon name="refresh" size={15} />
                    Reset Network
                  </button>
                </div>

                {detection && (
                  <div className="model-meta-strip">
                    <div>
                      <span>Detector Algorithm:</span>
                      <strong>{detection.detector_model}</strong>
                    </div>
                    <div>
                      <span>Anomaly Score:</span>
                      <strong>{formatNumber(detection.anomaly_score, 3)}</strong>
                    </div>
                    <div>
                      <span>Confidence:</span>
                      <strong>{formatNumber(detection.confidence * 100, 1)}%</strong>
                    </div>
                  </div>
                )}
              </article>

              {/* Status Verdict Card */}
              <article className="panel verdict-card">
                <div className="panel-heading panel-heading--compact">
                  <div className="eyebrow">DETECTION VERDICT</div>
                  <span className={`status-pill ${detection?.leak_detected ? 'status-pill--critical' : 'status-pill--normal'}`}>
                    {detection ? (detection.leak_detected ? 'ANOMALY DETECTED' : 'HEALTHY NETWORK') : 'PENDING EVALUATION'}
                  </span>
                </div>

                {detection ? (
                  <div className="verdict-body">
                    <div className={`verdict-circle ${detection.leak_detected ? 'verdict-circle--alert' : ''}`}>
                      <Icon name={detection.leak_detected ? 'alert' : 'check'} size={32} />
                    </div>
                    <div className="verdict-copy">
                      <h3>{detection.leak_detected ? 'Active Water Leak Verified' : 'No Anomalous Deficit'}</h3>
                      <p>
                        {detection.leak_detected
                          ? `Telemetry sensors reflect hydraulic drawdown matching orifice discharge of ~${formatNumber(
                              detection.estimated_leak_rate_lph,
                              0
                            )} L/h.`
                          : 'All sensor nodes report pressures within the 95th percentile confidence interval of EPANET Net3 baseline.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="diagnostic-empty">
                    <Icon name="scan" size={28} />
                    <p>Click "Run Leak Diagnostics" to execute inference across all sensor pressure readings.</p>
                  </div>
                )}
              </article>
            </div>

            {/* Suspects & Work Order Section */}
            {detection?.leak_detected && (
              <div className="suspects-and-workorder-grid">
                {/* Top Suspects Localization */}
                <article className="panel suspects-card">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">LOCALIZATION MODEL</div>
                      <h2>Top Suspected Junctions</h2>
                    </div>
                    <span className="chip chip--amber">RANDOM FOREST CLASSIFIER</span>
                  </div>

                  <div className="suspect-ranking-list">
                    {detection.top_suspects.map((suspect) => (
                      <div
                        key={suspect.node_id}
                        className={`suspect-rank-item ${suspect.rank === 1 ? 'suspect-rank-item--primary' : ''}`}
                        onClick={() => setSelectedNode(suspect.node_id)}
                      >
                        <div className="suspect-rank-badge">0{suspect.rank}</div>
                        <div className="suspect-info">
                          <h4>Junction {suspect.node_id}</h4>
                          <span className="suspect-geo">
                            Lat/Lng: {suspect.lat_lng ? suspect.lat_lng.map((x) => x.toFixed(4)).join(', ') : 'EPANET Grid'}
                          </span>
                        </div>
                        <div className="suspect-bar-wrap">
                          <div className="suspect-bar">
                            <span style={{ width: `${Math.min(100, suspect.probability * 100)}%` }} />
                          </div>
                          <strong>{formatNumber(suspect.probability * 100, 1)}%</strong>
                        </div>
                        <button
                          type="button"
                          className="action-pill-btn"
                          onClick={() => {
                            setSelectedNode(suspect.node_id)
                            setActiveTab('overview')
                          }}
                        >
                          View Map
                        </button>
                      </div>
                    ))}
                  </div>
                </article>

                {/* Automated Dispatch Work Order */}
                {detection.work_order_template && (
                  <article className="panel workorder-card">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow">AUTOMATED UTILITY DISPATCH</div>
                        <h2>Work Order Dispatch Ticket</h2>
                      </div>
                      <span className="priority-pill priority-pill--critical">
                        {detection.work_order_template.priority}
                      </span>
                    </div>

                    <div className="workorder-ticket">
                      <div className="ticket-header">
                        <div>
                          <span className="ticket-label">TICKET NUMBER</span>
                          <strong className="ticket-id">{detection.work_order_template.work_order_id}</strong>
                        </div>
                        <div>
                          <span className="ticket-label">STATUS</span>
                          <span className="status-pill status-pill--warning">
                            {detection.work_order_template.status}
                          </span>
                        </div>
                      </div>

                      <div className="ticket-fields">
                        <div className="ticket-field">
                          <span className="ticket-label">PRIMARY TARGET</span>
                          <strong>Junction {detection.work_order_template.primary_suspect_node}</strong>
                        </div>
                        <div className="ticket-field">
                          <span className="ticket-label">ESTIMATED WATER LOSS</span>
                          <strong>
                            {formatNumber(detection.work_order_template.estimated_water_loss_lph, 0)} Liters/Hour
                          </strong>
                        </div>
                        <div className="ticket-field ticket-field--full">
                          <span className="ticket-label">RECOMMENDED FIELD ACTION</span>
                          <p>{detection.work_order_template.recommended_action}</p>
                        </div>
                        <div className="ticket-field ticket-field--full">
                          <span className="ticket-label">ISOLATION PROCEDURE</span>
                          <p className="isolation-text">
                            {detection.work_order_template.isolation_valve_recommendation}
                          </p>
                        </div>
                      </div>

                      <div className="ticket-footer">
                        <button
                          type="button"
                          className="button button--secondary"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(detection.work_order_template, null, 2))
                            setNotice('Work order details copied to clipboard!')
                          }}
                        >
                          <Icon name="clipboard" size={15} /> Copy Dispatch Ticket
                        </button>
                        <button
                          type="button"
                          className="button button--primary"
                          onClick={() => {
                            setActiveTab('whatif')
                            setWhatIfLink('111')
                          }}
                        >
                          Simulate Containment in What-If <Icon name="arrow" size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                )}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: WHAT-IF SCENARIOS */}
        {activeTab === 'whatif' && (
          <section className="whatif-view">
            <div className="whatif-grid">
              {/* Scenario Configuration Form */}
              <article className="panel whatif-config-card">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">WHAT-IF SCENARIO ENGINE</div>
                    <h2>Containment & Throttling Simulation</h2>
                  </div>
                  <span className="simulation-tag">EPANET HYDRAULIC SOLVER</span>
                </div>
                <p className="lead-copy">
                  Test hypothetical emergency valve closures and pressure management strategies without risking
                  physical infrastructure disruption.
                </p>

                <form onSubmit={handleWhatIf} className="whatif-form">
                  <div className="form-group">
                    <label htmlFor="action-type">Intervention Strategy</label>
                    <select
                      id="action-type"
                      value={whatIfAction}
                      onChange={(e) =>
                        setWhatIfAction(e.target.value as 'valve_closure' | 'pressure_reduction' | 'pump_speed')
                      }
                      disabled={operation !== null}
                    >
                      <option value="valve_closure">Emergency Pipe Isolation (Gate Valve Closure)</option>
                      <option value="pressure_reduction">Boundary PRV Throttling (Pressure Reduction)</option>
                      <option value="pump_speed">Intake Pump Speed Derating (Hammer Prevention)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="target-pipe">Target Distribution Link / Pipe</label>
                    <input
                      id="target-pipe"
                      type="text"
                      value={whatIfLink}
                      onChange={(e) => setWhatIfLink(e.target.value)}
                      placeholder="e.g. 111, 101, 120"
                      disabled={operation !== null}
                    />
                  </div>

                  <div className="form-group">
                    <div className="range-heading">
                      <label htmlFor="prv-reduction">PRV Throttling Reduction %</label>
                      <strong>{whatIfReductionPct}%</strong>
                    </div>
                    <input
                      id="prv-reduction"
                      type="range"
                      min="5"
                      max="60"
                      step="5"
                      value={whatIfReductionPct}
                      onChange={(e) => setWhatIfReductionPct(Number(e.target.value))}
                      disabled={operation !== null}
                    />
                  </div>

                  <div className="quick-presets">
                    <span>Quick Pre-Configured Scenarios:</span>
                    <div className="preset-buttons">
                      <button
                        type="button"
                        className="preset-pill"
                        onClick={() => {
                          setWhatIfAction('valve_closure')
                          setWhatIfLink('111')
                          setWhatIfReductionPct(20)
                        }}
                      >
                        Pipe 111 Isolation
                      </button>
                      <button
                        type="button"
                        className="preset-pill"
                        onClick={() => {
                          setWhatIfAction('pressure_reduction')
                          setWhatIfLink('120')
                          setWhatIfReductionPct(35)
                        }}
                      >
                        Zone B 35% Throttling
                      </button>
                      <button
                        type="button"
                        className="preset-pill"
                        onClick={() => {
                          setWhatIfAction('pump_speed')
                          setWhatIfLink('10')
                          setWhatIfReductionPct(20)
                        }}
                      >
                        Pump 10 Speed Derate
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="button button--primary button--full button--lg"
                    disabled={operation !== null}
                  >
                    <Icon name="zap" size={17} />
                    {operation === 'whatif' ? 'Running Hydraulic Simulation...' : 'Simulate What-If Scenario'}
                  </button>
                </form>
              </article>

              {/* Simulation Result Presentation */}
              <article className="panel whatif-results-card">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">HYDRAULIC IMPACT ASSESSMENT</div>
                    <h2>Simulation Results</h2>
                  </div>
                  {whatIfResult && (
                    <span className="status-pill status-pill--normal">{whatIfResult.status}</span>
                  )}
                </div>

                {whatIfResult ? (
                  <div className="whatif-body">
                    <div className="scenario-title-box">
                      <span className="ticket-label">SCENARIO IDENTIFIER: {whatIfResult.scenario_id}</span>
                      <h3>{whatIfResult.scenario_name}</h3>
                    </div>

                    <div className="impact-metrics-grid">
                      <div className="impact-metric-card">
                        <span className="impact-label">Projected Water Savings</span>
                        <strong className="impact-value impact-value--savings">
                          {formatNumber(whatIfResult.projected_savings_lph, 0)} <small>L/h</small>
                        </strong>
                        <span className="impact-sub">
                          {whatIfResult.projected_leak_reduction_pct}% total leak reduction
                        </span>
                      </div>

                      <div className="impact-metric-card">
                        <span className="impact-label">Customer Disruption Impact</span>
                        <strong className="impact-value impact-value--impact">
                          {whatIfResult.service_disruption_impact}
                        </strong>
                        <span className="impact-sub">Secondary redundant loop maintained</span>
                      </div>
                    </div>

                    <div className="zone-pressures-box">
                      <h4>Zone Pressure Head Fluctuations</h4>
                      <div className="zone-grid">
                        {Object.entries(whatIfResult.pressure_head_change_summary).map(([key, val]) => (
                          <div className="zone-item" key={key}>
                            <span>{key.replace(/_/g, ' ').toUpperCase()}</span>
                            <strong>
                              {val > 0 ? `+${val}` : val} {key.includes('pct') ? '%' : 'm'}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="execution-steps-box">
                      <h4>Field Crew Recommended Execution Order</h4>
                      <ol className="step-list">
                        {whatIfResult.recommended_execution_order.map((step, idx) => (
                          <li key={idx} className="step-item">
                            <span className="step-num">{idx + 1}</span>
                            <span className="step-text">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                ) : (
                  <div className="diagnostic-empty">
                    <Icon name="zap" size={28} />
                    <p>Select an intervention strategy and click "Simulate What-If Scenario" to assess impact.</p>
                  </div>
                )}
              </article>
            </div>
          </section>
        )}

        {/* TAB 4: AUTONOMOUS AI AGENT */}
        {activeTab === 'agent' && (
          <section className="agent-view">
            <div className="agent-grid">
              {/* Query & Controls */}
              <article className="panel agent-prompt-card">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">AUTONOMOUS OPERATIONS COPILOT</div>
                    <h2>NirX AI Operations Agent</h2>
                  </div>
                  <span className="model-tag">REASONING AGENT · v1</span>
                </div>
                <p className="lead-copy">
                  Performs autonomous multi-step reasoning: evaluates hydraulic deficits, cross-examines ML
                  localization probabilities, inspects critical hospital zones, and issues containment action plans.
                </p>

                <form onSubmit={handleAgent} className="agent-form">
                  <div className="form-group">
                    <label htmlFor="agent-query">Operator Directive / Prompt</label>
                    <textarea
                      id="agent-query"
                      rows={3}
                      value={agentPrompt}
                      onChange={(e) => setAgentPrompt(e.target.value)}
                      placeholder="Ask the operations agent to diagnose or formulate containment..."
                      disabled={operation !== null}
                    />
                  </div>

                  <div className="quick-presets">
                    <span>Quick Directives:</span>
                    <div className="preset-buttons">
                      <button
                        type="button"
                        className="preset-pill"
                        onClick={() =>
                          setAgentPrompt('Diagnose current network anomaly and verify leak source')
                        }
                      >
                        Diagnose Anomaly
                      </button>
                      <button
                        type="button"
                        className="preset-pill"
                        onClick={() =>
                          setAgentPrompt('Formulate containment plan to minimize hospital zone pressure drop')
                        }
                      >
                        Hospital Protection Plan
                      </button>
                      <button
                        type="button"
                        className="preset-pill"
                        onClick={() =>
                          setAgentPrompt('Verify valve closure isolation feasibility and transient risk')
                        }
                      >
                        Isolation Feasibility
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="button button--primary button--full button--lg"
                    disabled={operation !== null}
                  >
                    <Icon name="bot" size={18} />
                    {operation === 'agent' ? 'Agent Deliberating...' : 'Query Autonomous Agent'}
                  </button>
                </form>
              </article>

              {/* Reasoning Trace & Output */}
              <article className="panel agent-response-card">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">CHAIN-OF-THOUGHT TRACE</div>
                    <h2>Agent Execution Log</h2>
                  </div>
                  {agentResult && (
                    <span className="status-pill status-pill--normal">
                      {agentResult.agent_id} · {agentResult.status}
                    </span>
                  )}
                </div>

                {agentResult ? (
                  <div className="agent-body">
                    {/* Executive Summary */}
                    <div className="verdict-banner">
                      <div className="verdict-banner-icon">
                        <Icon name="check" size={20} />
                      </div>
                      <div>
                        <span className="ticket-label">EXECUTIVE SUMMARY VERDICT</span>
                        <p>{agentResult.summary_verdict}</p>
                      </div>
                    </div>

                    {/* Step-by-Step Reasoning Trace */}
                    <div className="trace-timeline">
                      <h4>Multi-Step Reasoning Trace</h4>
                      {agentResult.reasoning_trace.map((step) => (
                        <div className="trace-item" key={step.step}>
                          <div className="trace-step-indicator">
                            <span>{step.step}</span>
                          </div>
                          <div className="trace-content">
                            <div className="trace-tool-header">
                              <span className="trace-tool-pill">{step.tool_invoked}</span>
                            </div>
                            <p className="trace-thought">"{step.thought}"</p>
                            <div className="trace-result">
                              <strong>Outcome:</strong> {step.result}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Suggested Actions Checklist */}
                    <div className="suggested-actions-box">
                      <h4>Prioritized Immediate Action Plan</h4>
                      <ul className="action-checklist">
                        {agentResult.suggested_actions.map((act, i) => (
                          <li key={i}>
                            <span className="action-check-icon">✓</span>
                            <span>{act}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="diagnostic-empty">
                    <Icon name="bot" size={28} />
                    <p>Enter an operator directive and click "Query Autonomous Agent" to view reasoning chain.</p>
                  </div>
                )}
              </article>
            </div>
          </section>
        )}

        {/* TAB 5: REAL-TIME PRESSURE MONITORING */}
        {activeTab === 'monitoring' && (
          <section className="tab-section monitoring-section">
            <div className="section-header-row">
              <div>
                <div className="eyebrow">IOT SENSOR TELEMETRY & DIGITAL TWIN OBSERVABILITY</div>
                <h2>Real-Time Network Pressure Monitoring</h2>
                <p className="section-sub">
                  Live pressure-head tracking across all 12 EPANET Net3 sensor stations with threshold monitoring and historical trends.
                </p>
              </div>
              <div className="section-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    void loadMonitoringData()
                    void loadSensorHistory(selectedMonSensor)
                  }}
                  disabled={monLoading}
                >
                  <Icon name="refresh" size={14} />
                  <span>{monLoading ? 'Refreshing...' : 'Refresh Telemetry'}</span>
                </button>
              </div>
            </div>

            {/* Monitoring KPI Cards */}
            <div className="monitoring-kpi-grid">
              <div className="mon-kpi-card">
                <span className="mon-kpi-label">Average System Pressure</span>
                <div className="mon-kpi-val">
                  {monOverview ? formatNumber(monOverview.average_pressure_psi, 1) : '—'}
                  <span className="unit">PSI</span>
                </div>
                <span className="mon-kpi-sub">
                  {monOverview ? `${formatNumber(monOverview.average_pressure_m, 1)} m H₂O equivalent` : 'Connecting telemetry...'}
                </span>
              </div>

              <div className="mon-kpi-card">
                <span className="mon-kpi-label">Average Network Flow</span>
                <div className="mon-kpi-val">
                  {monOverview ? formatNumber(monOverview.average_flow_lmin, 0) : '—'}
                  <span className="unit">L/min</span>
                </div>
                <span className="mon-kpi-sub">Aggregated nodal consumption estimate</span>
              </div>

              <div className="mon-kpi-card">
                <span className="mon-kpi-label">Sensor Health Distribution</span>
                <div className="mon-kpi-val mon-kpi-status-row">
                  <span className="stat-pill stat-pill--normal">
                    {monOverview?.normal_sensors ?? 0} Normal
                  </span>
                  <span className="stat-pill stat-pill--warning">
                    {monOverview?.warning_sensors ?? 0} Warning
                  </span>
                  <span className="stat-pill stat-pill--critical">
                    {monOverview?.critical_sensors ?? 0} Critical
                  </span>
                </div>
                <span className="mon-kpi-sub">
                  Total {monOverview?.total_sensors ?? 12} sensors actively streaming
                </span>
              </div>

              <div className="mon-kpi-card">
                <span className="mon-kpi-label">Active Pressure Alerts</span>
                <div className="mon-kpi-val">
                  <span className={monAlerts.length > 0 ? 'text-alert' : 'text-success'}>
                    {monAlerts.length}
                  </span>
                  <span className="unit">Threshold Anomalies</span>
                </div>
                <span className="mon-kpi-sub">
                  {monAlerts.length > 0 ? 'Exceeding safety boundary limits' : 'All sensors within normal limits'}
                </span>
              </div>
            </div>

            {/* Main Monitoring Body: Chart & Sensor Table */}
            <div className="monitoring-main-grid">
              {/* Left Column: Interactive Time Series Chart & Details */}
              <div className="monitoring-left-col">
                <article className="panel chart-panel">
                  <PressureChart
                    history={sensorHistory}
                    sensorLabel={currentMonSensor?.label ?? `Sensor ${selectedMonSensor}`}
                    baselinePsi={currentMonSensor?.baseline_pressure_psi ?? 65}
                    warnThreshold={monOverview?.thresholds.pressure_warning_psi ?? 55}
                    critThreshold={monOverview?.thresholds.pressure_critical_psi ?? 40}
                  />

                  {currentMonSensor && (
                    <div className="sensor-detail-strip">
                      <div className="detail-item">
                        <span className="label">Current Pressure</span>
                        <strong className={`val val--${currentMonSensor.status.toLowerCase()}`}>
                          {formatNumber(currentMonSensor.current_pressure_psi, 1)} PSI
                        </strong>
                      </div>
                      <div className="detail-item">
                        <span className="label">Baseline Pressure</span>
                        <strong className="val">{formatNumber(currentMonSensor.baseline_pressure_psi, 1)} PSI</strong>
                      </div>
                      <div className="detail-item">
                        <span className="label">Pressure Drop</span>
                        <strong className={`val ${currentMonSensor.pressure_drop_psi > 1.5 ? 'text-alert' : ''}`}>
                          {formatNumber(currentMonSensor.pressure_drop_psi, 2)} PSI
                        </strong>
                      </div>
                      <div className="detail-item">
                        <span className="label">Estimated Flow</span>
                        <strong className="val">{formatNumber(currentMonSensor.flow_lmin, 0)} L/min</strong>
                      </div>
                      <div className="detail-item">
                        <span className="label">Zone / District</span>
                        <strong className="val">{currentMonSensor.zone}</strong>
                      </div>
                      <div className="detail-action">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => {
                            setManualWOSensor(currentMonSensor.sensor_id)
                            setManualWODesc(`Telemetry alert: Pressure deficit of ${formatNumber(currentMonSensor.pressure_drop_psi, 2)} PSI at ${currentMonSensor.label}`)
                            setActiveTab('workorders')
                            setShowManualWOModal(true)
                          }}
                        >
                          <Icon name="wrench" size={13} />
                          <span>Dispatch WO</span>
                        </button>
                      </div>
                    </div>
                  )}
                </article>

                {/* Active Alerts List */}
                <article className="panel alerts-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">TELEMETRY ANOMALY FEED</div>
                      <h3>Live Threshold Alerts ({monAlerts.length})</h3>
                    </div>
                  </div>
                  {monAlerts.length > 0 ? (
                    <div className="alerts-list">
                      {monAlerts.map((alert) => (
                        <div key={alert.alert_id} className={`alert-item alert-item--${alert.severity.toLowerCase()}`}>
                          <div className="alert-badge">
                            <Icon name="alert" size={15} />
                            <span>{alert.severity}</span>
                          </div>
                          <div className="alert-content">
                            <div className="alert-title">
                              <strong>{alert.label} (Sensor {alert.sensor_id})</strong>
                              <span className="alert-time">{formatTime(alert.timestamp)}</span>
                            </div>
                            <p className="alert-msg">{alert.message}</p>
                          </div>
                          <button
                            type="button"
                            className="btn btn--outline btn--xs"
                            onClick={() => {
                              setSelectedMonSensor(alert.sensor_id)
                              void loadSensorHistory(alert.sensor_id)
                            }}
                          >
                            Inspect
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="alerts-empty">
                      <Icon name="check" size={24} />
                      <p>No active pressure or flow threshold violations. System operating normally.</p>
                    </div>
                  )}
                </article>
              </div>

              {/* Right Column: Sensor Roster Table */}
              <div className="monitoring-right-col">
                <article className="panel sensor-roster-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">EPANET NET3 STATIONS</div>
                      <h3>Sensor Telemetry Grid ({monSensors.length})</h3>
                    </div>
                  </div>
                  <div className="sensor-table-wrap">
                    <table className="sensor-table">
                      <thead>
                        <tr>
                          <th>Sensor / Zone</th>
                          <th>Pressure</th>
                          <th>Drop</th>
                          <th>Flow</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monSensors.map((s) => {
                          const isSelected = s.sensor_id === selectedMonSensor
                          return (
                            <tr
                              key={s.sensor_id}
                              className={`sensor-row ${isSelected ? 'sensor-row--selected' : ''}`}
                              onClick={() => {
                                setSelectedMonSensor(s.sensor_id)
                                void loadSensorHistory(s.sensor_id)
                              }}
                            >
                              <td>
                                <div className="sensor-name">
                                  <strong>{s.label}</strong>
                                  <small>ID: {s.sensor_id} · {s.zone}</small>
                                </div>
                              </td>
                              <td>
                                <span className="val-main">{formatNumber(s.current_pressure_psi, 1)} PSI</span>
                                <small className="val-sub">Base: {formatNumber(s.baseline_pressure_psi, 1)}</small>
                              </td>
                              <td>
                                <span className={s.pressure_drop_psi > 1.5 ? 'drop-alert' : 'drop-normal'}>
                                  {s.pressure_drop_psi > 0 ? `-${formatNumber(s.pressure_drop_psi, 2)}` : '0.00'} PSI
                                </span>
                              </td>
                              <td>
                                <span>{formatNumber(s.flow_lmin, 0)} L/m</span>
                              </td>
                              <td>
                                <span className={`status-pill status-pill--${s.status.toLowerCase()}`}>
                                  {s.status}
                                </span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-link"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedMonSensor(s.sensor_id)
                                    void loadSensorHistory(s.sensor_id)
                                  }}
                                >
                                  Chart
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              </div>
            </div>
          </section>
        )}

        {/* TAB 6: AI-POWERED WORK ORDERS */}
        {activeTab === 'workorders' && (
          <section className="tab-section workorders-section">
            <div className="section-header-row">
              <div>
                <div className="eyebrow">AUTONOMOUS INCIDENT DISPATCH & TICKETING</div>
                <h2>AI-Powered Field Work Orders</h2>
                <p className="section-sub">
                  Self-generating maintenance tickets synthesized from hydraulic pressure anomalies, WNTR simulation models, and ML suspect localization.
                </p>
              </div>
              <div className="section-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => void loadWorkOrders()}
                  disabled={woLoading}
                >
                  <Icon name="refresh" size={14} />
                  <span>{woLoading ? 'Refreshing...' : 'Refresh Orders'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setShowManualWOModal(true)}
                >
                  <Icon name="clipboard" size={14} />
                  <span>+ Dispatch Work Order</span>
                </button>
              </div>
            </div>

            {/* Work Order KPI summary */}
            <div className="wo-kpi-grid">
              <div className="wo-kpi-card">
                <span className="wo-kpi-label">Total Tickets</span>
                <span className="wo-kpi-val">{woSummary?.total ?? workOrders.length}</span>
                <span className="wo-kpi-sub">Recorded incidents</span>
              </div>
              <div className="wo-kpi-card">
                <span className="wo-kpi-label">Critical Severity</span>
                <span className="wo-kpi-val text-alert">{woSummary?.critical ?? 0}</span>
                <span className="wo-kpi-sub">Immediate action required</span>
              </div>
              <div className="wo-kpi-card">
                <span className="wo-kpi-label">Pending Dispatch</span>
                <span className="wo-kpi-val text-warning">{woSummary?.pending ?? 0}</span>
                <span className="wo-kpi-sub">Awaiting crew assignment</span>
              </div>
              <div className="wo-kpi-card">
                <span className="wo-kpi-label">In Progress</span>
                <span className="wo-kpi-val text-cyan">{woSummary?.in_progress ?? 0}</span>
                <span className="wo-kpi-sub">Active field crews</span>
              </div>
              <div className="wo-kpi-card">
                <span className="wo-kpi-label">Resolved</span>
                <span className="wo-kpi-val text-success">{woSummary?.completed ?? 0}</span>
                <span className="wo-kpi-sub">Remediated & closed</span>
              </div>
            </div>

            {/* Modal for manual work order dispatch */}
            {showManualWOModal && (
              <div className="modal-backdrop" onClick={() => setShowManualWOModal(false)}>
                <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Dispatch Manual Work Order</h3>
                    <button
                      type="button"
                      className="modal-close"
                      onClick={() => setShowManualWOModal(false)}
                    >
                      <Icon name="x" size={18} />
                    </button>
                  </div>
                  <form onSubmit={handleCreateManualWO} className="modal-form">
                    <div className="form-group">
                      <label>Target Sensor / Junction Node</label>
                      <select
                        value={manualWOSensor}
                        onChange={(e) => setManualWOSensor(e.target.value)}
                        className="form-select"
                      >
                        {Object.entries(SENSOR_LABELS).map(([id, label]) => (
                          <option key={id} value={id}>
                            Junction {id} — {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Severity Level</label>
                      <select
                        value={manualWOSeverity}
                        onChange={(e) => setManualWOSeverity(e.target.value as any)}
                        className="form-select"
                      >
                        <option value="CRITICAL">CRITICAL (Emergency rupture)</option>
                        <option value="HIGH">HIGH (Significant pressure deficit)</option>
                        <option value="MEDIUM">MEDIUM (Minor leak/valve anomaly)</option>
                        <option value="LOW">LOW (Scheduled inspection)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Problem Description / Directive</label>
                      <textarea
                        value={manualWODesc}
                        onChange={(e) => setManualWODesc(e.target.value)}
                        rows={3}
                        className="form-textarea"
                        placeholder="Detail anomaly observations and dispatch directives..."
                        required
                      />
                    </div>

                    <div className="modal-actions">
                      <button
                        type="button"
                        className="btn btn--outline"
                        onClick={() => setShowManualWOModal(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn btn--primary">
                        <Icon name="clipboard" size={14} />
                        <span>Dispatch Ticket</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Main Work Orders Grid */}
            <div className="wo-main-grid">
              {/* Left Column: Work Order List & Filter */}
              <div className="wo-list-panel panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">DISPATCH QUEUE</div>
                    <h3>Work Orders</h3>
                  </div>
                  <div className="wo-filters">
                    {['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED'].map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={`filter-btn ${woFilterStatus === st ? 'filter-btn--active' : ''}`}
                        onClick={() => setWoFilterStatus(st)}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="wo-feed">
                  {workOrders
                    .filter((wo) => woFilterStatus === 'ALL' || wo.status === woFilterStatus)
                    .map((wo) => {
                      const isSelected = selectedWO?.work_order_id === wo.work_order_id
                      return (
                        <div
                          key={wo.work_order_id}
                          className={`wo-item ${isSelected ? 'wo-item--selected' : ''}`}
                          onClick={() => setSelectedWO(wo)}
                        >
                          <div className="wo-item-top">
                            <span className="wo-id">{wo.work_order_id}</span>
                            <div className="wo-badges">
                              <span className={`severity-tag severity-tag--${wo.severity.toLowerCase()}`}>
                                {wo.severity}
                              </span>
                              <span className={`status-pill status-pill--${wo.status.toLowerCase().replace('_', '-')}`}>
                                {wo.status.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                          <div className="wo-loc">
                            <strong>{wo.location}</strong>
                            {wo.zone && <span> · {wo.zone}</span>}
                          </div>
                          <p className="wo-desc">{wo.problem_description}</p>
                          <div className="wo-item-foot">
                            <span className="wo-time">{formatTime(wo.created_at)}</span>
                            {wo.auto_generated && <span className="ai-badge">AI AUTO-DISPATCH</span>}
                          </div>
                        </div>
                      )
                    })}
                  {workOrders.length === 0 && (
                    <div className="wo-empty">
                      <Icon name="check" size={28} />
                      <p>No work orders generated yet. All network junctions operating within normal baseline tolerances.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Work Order Detailed Dossier */}
              <div className="wo-detail-panel panel">
                {selectedWO ? (
                  <div className="wo-dossier">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow">INCIDENT DOSSIER</div>
                        <h2>{selectedWO.work_order_id} — {selectedWO.location}</h2>
                      </div>
                      <div className="dossier-actions">
                        {selectedWO.status === 'PENDING' && (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => handleUpdateWOStatus(selectedWO.work_order_id, 'IN_PROGRESS')}
                            disabled={operation === 'wo_update'}
                          >
                            Assign Crew (In Progress)
                          </button>
                        )}
                        {selectedWO.status !== 'COMPLETED' && (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => handleUpdateWOStatus(selectedWO.work_order_id, 'COMPLETED')}
                            disabled={operation === 'wo_update'}
                          >
                            <Icon name="check" size={14} />
                            <span>Mark Completed</span>
                          </button>
                        )}
                        {selectedWO.status === 'COMPLETED' && (
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            onClick={() => handleUpdateWOStatus(selectedWO.work_order_id, 'IN_PROGRESS')}
                            disabled={operation === 'wo_update'}
                          >
                            Reopen Incident
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="dossier-body">
                      {/* Telemetry Snapshot */}
                      <div className="dossier-box telemetry-box">
                        <h4>Telemetry at Incident Detection</h4>
                        <div className="dossier-stats-grid">
                          <div>
                            <span className="sub">Current Pressure</span>
                            <strong>{formatNumber(selectedWO.current_pressure_psi, 1)} PSI</strong>
                            <small>({formatNumber(selectedWO.current_pressure_m, 1)} m H₂O)</small>
                          </div>
                          <div>
                            <span className="sub">Pressure Deficit</span>
                            <strong className="text-alert">{formatNumber(selectedWO.pressure_drop_m, 2)} m</strong>
                          </div>
                          <div>
                            <span className="sub">Estimated Flow Loss</span>
                            <strong>{formatNumber(selectedWO.flow_lmin, 0)} L/min</strong>
                          </div>
                          <div>
                            <span className="sub">Severity Class</span>
                            <span className={`severity-tag severity-tag--${selectedWO.severity.toLowerCase()}`}>
                              {selectedWO.severity}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* AI Root Cause & Diagnostics */}
                      <div className="dossier-box ai-diagnostics-box">
                        <h4>
                          <Icon name="bot" size={16} /> AI Diagnostic Analysis
                        </h4>
                        <div className="ai-field">
                          <span className="ai-label">PROBLEM STATEMENT</span>
                          <p>{selectedWO.problem_description}</p>
                        </div>
                        <div className="ai-field">
                          <span className="ai-label">SUSPECTED ROOT CAUSE</span>
                          <p>{selectedWO.suspected_cause}</p>
                        </div>
                        <div className="ai-field">
                          <span className="ai-label">RECOMMENDED CREW PROCEDURE</span>
                          <p className="ai-action-text">{selectedWO.recommended_action}</p>
                        </div>
                      </div>

                      {/* Isolation Valve Advice */}
                      <div className="dossier-box valve-advise-box">
                        <h4>
                          <Icon name="valve" size={16} /> Isolation Valve Protocol
                        </h4>
                        <p>
                          To isolate the affected junction without widespread service cutoff, refer to the Digital Twin Valve Simulation tool:
                        </p>
                        <div className="valve-rec-pill">
                          <strong>Recommended Isolation:</strong> Valve on Link {selectedWO.sensor_id}
                        </div>
                        <button
                          type="button"
                          className="btn btn--outline btn--sm mt-2"
                          onClick={() => {
                            setActiveTab('valvesim')
                          }}
                        >
                          <Icon name="valve" size={14} />
                          <span>Test Isolation in Valve Simulation</span>
                        </button>
                      </div>

                      {/* Audit History Timeline */}
                      {selectedWO.history && selectedWO.history.length > 0 && (
                        <div className="dossier-box history-box">
                          <h4>Incident Audit History</h4>
                          <div className="wo-history-timeline">
                            {selectedWO.history.map((h, i) => (
                              <div key={i} className="history-step">
                                <span className="history-dot" />
                                <div className="history-info">
                                  <span>Status transitioned from <strong>{h.from_status}</strong> to <strong>{h.to_status}</strong></span>
                                  <small>{formatTime(h.timestamp)}</small>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="wo-detail-empty">
                    <Icon name="clipboard" size={32} />
                    <p>Select a work order from the queue to view AI diagnosis, telemetry telemetry, and crew directives.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* TAB 7: WHAT-IF VALVE SIMULATION */}
        {activeTab === 'valvesim' && (
          <section className="tab-section valvesim-section">
            <div className="section-header-row">
              <div>
                <div className="eyebrow">HYDRAULIC GRAPH PROPAGATION & ISOLATION TWIN</div>
                <h2>What-If Valve Simulation</h2>
                <p className="section-sub">
                  Test valve closure scenarios, evaluate pressure drops across downstream zones, and verify isolated pipeline sections before executing physical field maneuvers.
                </p>
              </div>
              <div className="section-actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={handleResetSim}
                  disabled={simLoading || operation === 'sim_reset'}
                >
                  <Icon name="refresh" size={14} />
                  <span>Reset All Valves to Open</span>
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleRunSim}
                  disabled={simLoading || operation === 'sim_run'}
                >
                  <Icon name="play" size={14} />
                  <span>{operation === 'sim_run' ? 'Running Simulation...' : 'Run Simulation'}</span>
                </button>
              </div>
            </div>

            {/* Simulation Disclaimer Banner */}
            <div className="sim-disclaimer-banner">
              <span className="banner-icon">
                <Icon name="alert" size={18} />
              </span>
              <div>
                <strong>[DIGITAL TWIN SIMULATION ONLY]</strong>
                <p>
                  All valve closures and pressure impacts calculated here are computed in a sandbox WNTR EPANET hydraulic graph. No physical SCADA or telemetry commands are transmitted to network equipment.
                </p>
              </div>
            </div>

            {/* Valve Simulation Main Grid */}
            <div className="valvesim-main-grid">
              {/* Left Column: Valve Roster & Controls */}
              <div className="valves-panel panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">ACTUATION MATRIX</div>
                    <h3>Simulation Valves ({simNetwork?.valves.length ?? 0})</h3>
                  </div>
                  <span className="valves-status-hint">
                    {simNetwork?.valves.filter((v) => v.status === 'CLOSED').length ?? 0} Closed / {simNetwork?.valves.length ?? 10} Total
                  </span>
                </div>

                <div className="valves-list">
                  {simNetwork?.valves.map((valve) => {
                    const isClosed = valve.status === 'CLOSED'
                    const isSelected = selectedValve === valve.valve_id
                    return (
                      <div
                        key={valve.valve_id}
                        className={`valve-card ${isClosed ? 'valve-card--closed' : 'valve-card--open'} ${isSelected ? 'valve-card--selected' : ''}`}
                        onClick={() => setSelectedValve(valve.valve_id)}
                      >
                        <div className="valve-info">
                          <div className="valve-id-row">
                            <span className="valve-id">{valve.valve_id}</span>
                            <span className={`valve-badge ${isClosed ? 'valve-badge--closed' : 'valve-badge--open'}`}>
                              {valve.status}
                            </span>
                          </div>
                          <div className="valve-pipe">
                            <span>Pipe: {valve.pipe_id}</span>
                            <span className="pipe-nodes">({valve.start_node} ↔ {valve.end_node})</span>
                          </div>
                        </div>

                        <div className="valve-ctrl">
                          <button
                            type="button"
                            className={`btn btn--sm ${isClosed ? 'btn--success' : 'btn--warning'}`}
                            onClick={() => handleToggleValve(valve.valve_id, valve.status)}
                            disabled={operation === 'valve'}
                          >
                            {isClosed ? 'Simulate Open' : 'Simulate Close'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Right Column: Simulation Results & Impact Analysis */}
              <div className="sim-results-panel panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">HYDRAULIC PROPAGATION ANALYSIS</div>
                    <h3>Simulation Impact Results</h3>
                  </div>
                  {simResult && (
                    <span className="status-pill status-pill--normal">
                      Simulation Evaluated
                    </span>
                  )}
                </div>

                {simResult ? (
                  <div className="sim-results-body">
                    {/* Disconnected Zones Warning */}
                    {simResult.disconnected_junctions.length > 0 && (
                      <div className="disconnected-alert">
                        <Icon name="alert" size={20} />
                        <div>
                          <strong>Service Disruption Warning: {simResult.disconnected_junctions.length} Junctions Isolated</strong>
                          <p>
                            Closure of valve(s) {simResult.closed_valves.join(', ')} has completely disconnected Junction(s):{' '}
                            <strong>{simResult.disconnected_junctions.join(', ')}</strong> from reservoir supply.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Comparison KPI Cards */}
                    <div className="sim-kpi-grid">
                      <div className="sim-kpi-card">
                        <span className="label">Average Pressure</span>
                        <div className="vals">
                          <span className="before">{formatNumber(simResult.network_summary.avg_pressure_before_psi, 1)} PSI</span>
                          <span className="arrow">→</span>
                          <strong className="after">{formatNumber(simResult.network_summary.avg_pressure_after_psi, 1)} PSI</strong>
                        </div>
                        <small className="delta">
                          Δ {formatNumber(simResult.network_summary.avg_pressure_after_psi - simResult.network_summary.avg_pressure_before_psi, 1)} PSI
                        </small>
                      </div>

                      <div className="sim-kpi-card">
                        <span className="label">Average Flow Rate</span>
                        <div className="vals">
                          <span className="before">{formatNumber(simResult.network_summary.avg_flow_before_lmin, 0)} L/m</span>
                          <span className="arrow">→</span>
                          <strong className="after">{formatNumber(simResult.network_summary.avg_flow_after_lmin, 0)} L/m</strong>
                        </div>
                        <small className="delta text-alert">
                          -{formatNumber(simResult.network_summary.flow_reduction_pct, 1)}% Reduction
                        </small>
                      </div>

                      <div className="sim-kpi-card">
                        <span className="label">Junctions Affected</span>
                        <div className="val-single">
                          <strong>{simResult.affected_junction_count}</strong>
                        </div>
                        <small className="sub">Hydraulic gradient modified</small>
                      </div>

                      <div className="sim-kpi-card">
                        <span className="label">Isolated Nodes</span>
                        <div className="val-single">
                          <strong className={simResult.network_summary.disconnected_zone_count > 0 ? 'text-alert' : 'text-success'}>
                            {simResult.network_summary.disconnected_zone_count}
                          </strong>
                        </div>
                        <small className="sub">Zero water pressure</small>
                      </div>
                    </div>

                    {/* Sensor Impacts Table */}
                    <div className="impacts-table-container">
                      <h4>Monitoring Stations Impact Breakdown</h4>
                      <table className="impact-table">
                        <thead>
                          <tr>
                            <th>Sensor ID</th>
                            <th>Station Name</th>
                            <th>Pre-Sim PSI</th>
                            <th>Post-Sim PSI</th>
                            <th>Delta PSI</th>
                            <th>Sim Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simResult.sensor_impacts.map((si) => (
                            <tr key={si.sensor_id} className={si.disconnected ? 'row--disconnected' : ''}>
                              <td><strong>{si.sensor_id}</strong></td>
                              <td>{si.label}</td>
                              <td>{formatNumber(si.old_pressure_psi, 1)}</td>
                              <td><strong>{formatNumber(si.new_pressure_psi, 1)}</strong></td>
                              <td>
                                <span className={si.pressure_change_psi < 0 ? 'text-alert' : 'text-success'}>
                                  {si.pressure_change_psi > 0 ? `+${formatNumber(si.pressure_change_psi, 1)}` : `${formatNumber(si.pressure_change_psi, 1)}`}
                                </span>
                              </td>
                              <td>
                                <span className={`status-pill status-pill--${si.post_sim_status.toLowerCase()}`}>
                                  {si.post_sim_status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="sim-empty-state">
                    <Icon name="valve" size={32} />
                    <h4>No Simulation Executed Yet</h4>
                    <p>
                      Toggle one or more valves in the Actuation Matrix on the left, then click <strong>"Run Simulation"</strong> to evaluate the hydraulic pressure propagation and check for disconnected zones.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
        <footer className="footer">
          <span>© NIRX WATER INTELLIGENCE</span>
          <span>
            NET3 DIGITAL TWIN <i /> {network?.summary.total_nodes ?? '—'} NODES <i />{' '}
            {network?.summary.total_sensors ?? '—'} SENSORS <i />{' '}
            {network?.summary.total_pipes ?? '—'} PIPES
          </span>
          <span>POWERED BY WNTR + EPANET + SCIKIT-LEARN</span>
        </footer>
      </div>
    </main>
  )
}

export default App
