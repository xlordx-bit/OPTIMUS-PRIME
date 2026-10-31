export type NavTabId =
  | 'overview'
  | 'response_planner'
  | 'water_quality'
  | 'sewer_flood'
  | 'monitoring'
  | 'whatif'
  | 'workorders'
  | 'valvesim'
  | 'diagnostics'
  | 'agent'

export interface RadialSectorConfig {
  id: NavTabId
  label: string
  title: string
  subtitle: string
  description: string
  iconName:
    | 'cube'
    | 'clipboard'
    | 'drop'
    | 'activity'
    | 'gauge'
    | 'zap'
    | 'wrench'
    | 'valve'
    | 'scan'
    | 'bot'
  /** Angle in degrees where 0 is Top (-90 in standard math coord), evenly spaced */
  centerAngleDeg: number
  shortcutKey: string
  badgeKey?: string
}

/**
 * 10 Navigation Sectors arranged radially clockwise starting at top (-90° / 270°):
 * 1. 3D Operations (Top: -90°)
 * 2. Response Planner (Upper Right: -54°)
 * 3. Water Quality (Right: -18°)
 * 4. Sewer & Flood (Lower Right: +18°)
 * 5. Pressure Monitoring (Bottom Right: +54°)
 * 6. What-If (Bottom: +90°)
 * 7. AI Work Orders (Bottom Left: +126°)
 * 8. Valve Simulation (Left: +162°)
 * 9. ML Diagnostics (Upper Left: +198°)
 * 10. AI Agent (Top Left: +234°)
 */
export const NAVIGATION_SECTORS: RadialSectorConfig[] = [
  {
    id: 'overview',
    label: '3D Operations',
    title: '3D Digital Twin Operations',
    subtitle: 'SPATIAL TELEMETRY & NETWORK TOPOLOGY',
    description:
      'Real-time 3D network twin, pressure gradients, elevation profiles, sensor placement, and interactive valve controls.',
    iconName: 'cube',
    centerAngleDeg: 270, // Top
    shortcutKey: '1',
  },
  {
    id: 'response_planner',
    label: 'Response Planner',
    title: 'Automated Response Planner',
    subtitle: 'VALVE-CUT PRIORITISATION & ISOLATION',
    description:
      'Calculates minimum boundary isolation valves, customers cut off, and emergency dispatch sequence during active events.',
    iconName: 'clipboard',
    centerAngleDeg: 306, // Upper Right
    shortcutKey: '2',
  },
  {
    id: 'water_quality',
    label: 'Water Quality',
    title: 'Water Quality & Contaminant Tracking',
    subtitle: 'CHEMICAL DISPERSION & CHLORINE RESIDUAL',
    description:
      'Continuous contaminant plume propagation simulation, water safety compliance index, and automatic boil-water advisory zones.',
    iconName: 'drop',
    centerAngleDeg: 342, // Right
    shortcutKey: '3',
  },
  {
    id: 'sewer_flood',
    label: 'Sewer & Flood',
    title: 'Sewer Overflow & Urban Flood Warning',
    subtitle: 'MANHOLE SURCHARGE & STORMWATER RUNOFF',
    description:
      'Surge prediction across urban manholes, stormwater runoff simulation, and early flood mitigation protocols.',
    iconName: 'activity',
    centerAngleDeg: 18, // Lower Right
    shortcutKey: '4',
  },
  {
    id: 'monitoring',
    label: 'Pressure Monitoring',
    title: 'Real-Time Pressure Monitoring',
    subtitle: 'TRANSIENT TELEMETRY & ZONE METRICS',
    description:
      'Millisecond-level hydraulic head and pressure monitoring, transient surge analysis, and live multi-sensor pressure drop telemetry.',
    iconName: 'gauge',
    centerAngleDeg: 54, // Bottom Right
    shortcutKey: '5',
  },
  {
    id: 'whatif',
    label: 'What-If Engine',
    title: 'What-If Valve & Leak Simulator',
    subtitle: 'HYDRAULIC SANDBOX & SCENARIO IMPACT',
    description:
      'Sandbox hydraulic scenario modeling to forecast network pressure head changes, customer impact, and leak reduction before field execution.',
    iconName: 'zap',
    centerAngleDeg: 90, // Bottom
    shortcutKey: '6',
  },
  {
    id: 'workorders',
    label: 'AI Work Orders',
    title: 'AI Work Order Management',
    subtitle: 'AUTONOMOUS FIELD CREW DISPATCH',
    description:
      'Autonomous generation and lifecycle tracking of prioritized work orders based on anomaly confidence and pipe vulnerability scores.',
    iconName: 'wrench',
    centerAngleDeg: 126, // Bottom Left
    shortcutKey: '7',
  },
  {
    id: 'valvesim',
    label: 'Valve Simulation',
    title: 'Interactive Valve Network Simulation',
    subtitle: 'PRESSURE REDUCING & GATE VALVE CONTROLS',
    description:
      'Live EPANET-driven hydraulic simulation with dynamic valve throttle adjustments, flow conservation, and headloss calculation.',
    iconName: 'valve',
    centerAngleDeg: 162, // Left
    shortcutKey: '8',
  },
  {
    id: 'diagnostics',
    label: 'ML Diagnostics',
    title: 'Machine Learning Diagnostics',
    subtitle: 'ACOUSTIC & RESIDUAL LEAK CLASSIFIER',
    description:
      'Gradient boosted & neural network leak detection model with suspect ranking, confidence intervals, and leak rate estimations.',
    iconName: 'scan',
    centerAngleDeg: 198, // Upper Left
    shortcutKey: '9',
  },
  {
    id: 'agent',
    label: 'AI Operations Agent',
    title: 'Autonomous Operations Agent',
    subtitle: 'MULTI-STEP REASONING & INCIDENT TRIAGE',
    description:
      'Autonomous digital twin copilot that investigates network anomalies, invokes diagnostics tools, and formulates containment strategies.',
    iconName: 'bot',
    centerAngleDeg: 234, // Top Left
    shortcutKey: '0',
  },
]
