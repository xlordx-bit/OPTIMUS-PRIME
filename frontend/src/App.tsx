import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
import Network3DMap from './components/Network3DMap'

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

type Operation = 'inject' | 'reset' | 'detect' | 'whatif' | 'agent' | null
type ActiveTab = 'overview' | 'diagnostics' | 'whatif' | 'agent'
type MapViewMode = '3d' | '2d'

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
    | 'cube'
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
    cube: (
      <>
        <path d="m21 16-9 5-9-5V8l9-5 9 5v8Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 12v9" />
      </>
    ),
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

function NetworkMap2D({
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
      aria-label="EPANET Net3 2D schematic"
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
            {isActiveLeak && (
              <>
                <circle cx={point.x} cy={point.y} r="22" className="leak-ring leak-ring--outer" />
                <circle cx={point.x} cy={point.y} r="14" className="leak-ring" />
              </>
            )}

            {suspect && !isActiveLeak && (
              <circle
                cx={point.x}
                cy={point.y}
                r={suspect.rank === 1 ? 16 : 11}
                className={`suspect-ring suspect-ring--rank${suspect.rank}`}
                filter="url(#suspect-glow)"
              />
            )}

            {isSelected && !isActiveLeak && (
              <circle cx={point.x} cy={point.y} r="10" className="selection-ring" />
            )}

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

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')
  const [mapMode, setMapMode] = useState<MapViewMode>('3d')
  const [isFullScreen3D, setIsFullScreen3D] = useState(false)

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
      {/* Full-Screen 3D Map Modal when toggled */}
      {isFullScreen3D && (
        <Network3DMap
          network={network}
          state={state}
          detection={detection}
          selectedNode={selectedNode}
          onSelectNode={(id) => setSelectedNode(id)}
          onInjectAtNode={(id) => {
            setSelectedNode(id)
            void handleInject()
          }}
          onSwitchToWhatIf={(link) => {
            setWhatIfLink(link)
            setActiveTab('whatif')
            setIsFullScreen3D(false)
          }}
          isFullScreen={true}
          onToggleFullScreen={() => setIsFullScreen3D(false)}
        />
      )}

      {/* Top Header */}
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="JalNetra 3D Water Intelligence">
          <span className="brand-mark">
            <Icon name="drop" size={22} />
          </span>
          <span className="brand-copy">
            <strong>JALNETRA</strong>
            <small>3D WATER DIGITAL TWIN</small>
          </span>
        </a>

        {/* Navigation Tabs */}
        <nav className="nav-tabs">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'overview' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <Icon name="cube" size={15} />
            <span>3D Operations</span>
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
            <span>What-If Simulations</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'agent' ? 'tab-btn--active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <Icon name="bot" size={15} />
            <span>AI Operations Agent</span>
          </button>
        </nav>

        {/* Topbar Right */}
        <div className="topbar-right">
          <button
            type="button"
            className="fullscreen-topbar-btn"
            onClick={() => setIsFullScreen3D(true)}
            title="Launch Fullscreen 3D Map View"
          >
            <Icon name="cube" size={14} /> 3D Map ↗
          </button>
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
              <span className="eyebrow-line" /> MAPLIBRE GL JS 3D CITY TERRAIN · EPANET NET3 & ML TELEMETRY
            </div>
            <h1>
              3D Water Distribution <span>Digital Twin.</span>
            </h1>
            <p className="page-description">
              Real-time 3D hydraulic city model with Pressure-Driven Demand (WNTR), glowing pipeline status,
              automated ML leak localization, what-if containment, and intelligent crew dispatch.
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

        {/* TAB 1: OVERVIEW & 3D MAP */}
        {activeTab === 'overview' && (
          <>
            <section className="main-grid">
              {/* Map Panel */}
              <article className="panel map-panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">
                      {mapMode === '3d' ? 'MAPLIBRE GL JS 3D NETWORK' : '2D HYDRAULIC SCHEMATIC'}
                    </div>
                    <h2>{network?.network_name ?? 'EPANET Net3 3D Twin'}</h2>
                  </div>

                  <div className="panel-actions">
                    {/* View Switcher: 3D vs 2D */}
                    <div className="map-view-toggle">
                      <button
                        type="button"
                        className={`view-toggle-btn ${mapMode === '3d' ? 'is-active' : ''}`}
                        onClick={() => setMapMode('3d')}
                        title="Switch to 3D MapLibre City View"
                      >
                        🌐 3D City
                      </button>
                      <button
                        type="button"
                        className={`view-toggle-btn ${mapMode === '2d' ? 'is-active' : ''}`}
                        onClick={() => setMapMode('2d')}
                        title="Switch to 2D Hydraulic Schematic"
                      >
                        📐 2D Schema
                      </button>
                    </div>

                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setIsFullScreen3D(true)}
                      title="Expand to Fullscreen 3D View"
                    >
                      ↗
                    </button>

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

                {mapMode === '3d' ? (
                  <Network3DMap
                    network={network}
                    state={state}
                    detection={detection}
                    selectedNode={selectedNode}
                    onSelectNode={(id) => setSelectedNode(id)}
                    onInjectAtNode={(id) => {
                      setSelectedNode(id)
                      void handleInject()
                    }}
                    onSwitchToWhatIf={(link) => {
                      setWhatIfLink(link)
                      setActiveTab('whatif')
                    }}
                    onToggleFullScreen={() => setIsFullScreen3D(true)}
                  />
                ) : (
                  <div className="map-wrap">
                    {network ? (
                      <NetworkMap2D
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
                      <span className="map-live-dot" /> 2D WNTR SCHEMATIC <span className="overlay-divider" /> CLICK
                      NODE TO TARGET
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
                )}

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
                    <Icon name="cube" size={14} /> 3D City Terrain + Pipe Glow: Green = Healthy, Yellow = Warning,
                    Red = Leak
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

            {detection?.leak_detected && (
              <div className="suspects-and-workorder-grid">
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
                            setMapMode('3d')
                          }}
                        >
                          View 3D
                        </button>
                      </div>
                    ))}
                  </div>
                </article>

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
                    <div className="verdict-banner">
                      <div className="verdict-banner-icon">
                        <Icon name="check" size={20} />
                      </div>
                      <div>
                        <span className="ticket-label">EXECUTIVE SUMMARY VERDICT</span>
                        <p>{agentResult.summary_verdict}</p>
                      </div>
                    </div>

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

        {/* Footer */}
        <footer className="footer">
          <span>© JALNETRA · 3D WATER INTELLIGENCE DIGITAL TWIN</span>
          <span>
            NET3 DIGITAL TWIN <i /> {network?.summary.total_nodes ?? '—'} NODES <i />{' '}
            {network?.summary.total_sensors ?? '—'} SENSORS <i />{' '}
            {network?.summary.total_pipes ?? '—'} PIPES
          </span>
          <span>POWERED BY MAPLIBRE GL JS + WNTR + EPANET + SCIKIT-LEARN</span>
        </footer>
      </div>
    </main>
  )
}

export default App
