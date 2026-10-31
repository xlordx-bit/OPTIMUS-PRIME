import React, { useState } from 'react'

export interface ManholeState {
  id: string
  name: string
  ward: string
  coordinates: { x: number; y: number }
  lat_lng: number[]
  elevation_m: number
  depth_m: number
  overflow_threshold_m: number
  current_level_m: number
  fill_percentage: number
  rise_rate_m_hr: number
  overflow_risk_1h_pct: number
  overflow_risk_2h_pct: number
  overflow_risk_6h_pct: number
  status: string
  is_drain_blocked: boolean
  nearby_water_main: string
  nearby_valve: string
  nearby_facility: string
}

export interface ThreatenedWaterMain {
  pipe_id: string
  nearby_valve: string
  source_manhole: string
  ward: string
  contamination_probability_pct: number
  nearby_facility: string
}

export interface SewerStateData {
  timestamp_iso: string
  rainfall_current_mm_h: number
  rainfall_15m_mm_h: number
  rainfall_30m_mm_h: number
  rainfall_60m_mm_h: number
  forecast_1h_mm_h: number
  forecast_2h_mm_h: number
  forecast_6h_mm_h: number
  active_blockages: string[]
  offline_pumps: string[]
  manholes: ManholeState[]
  facilities: {
    id: string
    name: string
    type: string
    status: string
    lat_lng: number[]
  }[]
  flood_zones: {
    id: string
    name: string
    risk_level: string
    current_status: string
    vulnerable_population: number
    affected_facilities: string[]
    nearby_drinking_mains: string[]
  }[]
  high_risk_manhole_count: number
  threatened_water_mains: ThreatenedWaterMain[]
  summary_verdict: string
  recommended_field_actions: string[]
}

interface SewerFloodPanelProps {
  data: SewerStateData | null
  loading?: boolean
  onSimulateRain: (payload: {
    intensity_level: string
    block_drain_d7: boolean
    pump_sp2_offline: boolean
  }) => Promise<void> | void
  onResetSewer: () => Promise<void> | void
  onSwitchToResponsePlanner?: (nodeId: string) => void
}

export const SewerFloodPanel: React.FC<SewerFloodPanelProps> = ({
  data,
  loading = false,
  onSimulateRain,
  onResetSewer,
  onSwitchToResponsePlanner,
}) => {
  const [selectedStormTier, setSelectedStormTier] = useState<string>('HEAVY')
  const [blockDrainD7, setBlockDrainD7] = useState<boolean>(true)
  const [pumpOffline, setPumpOffline] = useState<boolean>(false)
  const [filterRisk, setFilterRisk] = useState<string>('all')
  const [isSimulating, setIsSimulating] = useState(false)

  if (loading || !data) {
    return (
      <div className="planner-loading-card">
        <div className="planner-spinner" />
        <h3>Simulating Urban Drainage & Flood Overflow Dynamics...</h3>
        <p>Evaluating rational runoff, manhole rise rates, and cross-contamination hazards to drinking water mains.</p>
      </div>
    )
  }

  const {
    rainfall_current_mm_h,
    forecast_1h_mm_h,
    forecast_2h_mm_h,
    forecast_6h_mm_h,
    manholes,
    high_risk_manhole_count,
    threatened_water_mains,
    summary_verdict,
    recommended_field_actions,
    facilities,
    flood_zones: _flood_zones,
  } = data

  const handleSimulateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSimulating(true)
    try {
      await onSimulateRain({
        intensity_level: selectedStormTier,
        block_drain_d7: blockDrainD7,
        pump_sp2_offline: pumpOffline,
      })
    } finally {
      setIsSimulating(false)
    }
  }

  const filteredManholes =
    filterRisk === 'high'
      ? manholes.filter((m) => m.overflow_risk_2h_pct >= 50 || m.status === 'CRITICAL' || m.status === 'WARNING')
      : manholes

  return (
    <div className="sewer-flood-panel">
      {/* Top Banner Header */}
      <div className="planner-header">
        <div className="planner-title-block">
          <span className="planner-tag">URBAN SANITATION & STORMWATER SURVEILLANCE</span>
          <h2 className="planner-headline">
          Sewer Overflow & Flood-Risk Forecast
          </h2>
          <p className="planner-subtext">
            Forecasts drainage capacity bottlenecks, 1h/2h/6h manhole surcharges, and drinking-water cross-contamination risks.
          </p>
        </div>

        <div className="planner-header-actions">
          <button
            type="button"
            className="planner-btn planner-btn--secondary"
            onClick={() => onResetSewer()}
          >
            ↻ Clear Storm & Reset
          </button>
        </div>
      </div>

      {/* Primary Verdict Callout Banner */}
      <div className={`wq-advisory-box ${high_risk_manhole_count > 0 ? 'wq-advisory-box--alert' : 'wq-advisory-box--ok'}`}>
        <div className="wq-advisory-icon">
          {high_risk_manhole_count > 0 ? 'ALERT' : 'NORMAL'}
        </div>
        <div className="wq-advisory-body">
          <div className="wq-advisory-tag-row">
            <span className="wq-advisory-pill">
              {high_risk_manhole_count > 0 ? 'SEWER OVERFLOW & INGRESS ALERT' : 'DRAINAGE CHANNELS NOMINAL'}
            </span>
            <span className="wq-advisory-status-pill">
              RAINFALL: {rainfall_current_mm_h} mm/h
            </span>
            <span className="wq-advisory-status-pill">
              HIGH RISK MANHOLES: {high_risk_manhole_count}
            </span>
          </div>
          <p className="wq-advisory-text">{summary_verdict}</p>
        </div>
      </div>

      {/* Rainfall & Weather Station + Storm Simulation Grid */}
      <div className="sewer-top-grid">
        {/* Rainfall Telemetry Gauge */}
        <div className="sewer-card">
          <div className="wq-card-header">
            <div>
              <span className="wq-card-eyebrow">METEOROLOGICAL TELEMETRY</span>
              <h4 className="wq-card-title">Real-Time Storm & Runoff Inflow</h4>
            </div>
            <span className="layer-mode-tag">HYDROLOGIC SENSORS</span>
          </div>

          <div className="rain-gauges-row">
            <div className="rain-gauge-box">
              <span>Current Intensity</span>
              <strong>{rainfall_current_mm_h} mm/h</strong>
              <small>Peak storm band</small>
            </div>
            <div className="rain-gauge-box">
              <span>1-Hour Forecast</span>
              <strong>{forecast_1h_mm_h} mm/h</strong>
              <small>Incoming front</small>
            </div>
            <div className="rain-gauge-box">
              <span>2-Hour Forecast</span>
              <strong>{forecast_2h_mm_h} mm/h</strong>
              <small>Peak accumulation</small>
            </div>
            <div className="rain-gauge-box">
              <span>6-Hour Forecast</span>
              <strong>{forecast_6h_mm_h} mm/h</strong>
              <small>Storm recession</small>
            </div>
          </div>

          <div className="drain-infrastructure-status">
            <h5>DRAINAGE INFRASTRUCTURE STATUS</h5>
            <div className="fac-badges-list">
              {facilities.map((fac) => (
                <div key={fac.id} className={`infra-pill ${fac.status.includes('FAIL') ? 'infra-pill--fail' : 'infra-pill--ok'}`}>
                  <span>{fac.type.replace(/_/g, ' ').toUpperCase()}</span>
                  <div>
                    <strong>{fac.name}</strong>
                    <small>{fac.status}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Storm Scenario Simulator Controls */}
        <div className="sewer-card">
          <div className="wq-card-header">
            <div>
              <span className="wq-card-eyebrow">SCENARIO INJECTION</span>
              <h4 className="wq-card-title">Simulate Rainfall & Infrastructure Stress</h4>
            </div>
            <span className="layer-mode-tag">HYDRAULIC STRESS TEST</span>
          </div>

          <form onSubmit={handleSimulateSubmit} className="storm-form">
            <label className="storm-label">
              Storm Intensity:
              <select
                value={selectedStormTier}
                onChange={(e) => setSelectedStormTier(e.target.value)}
              >
                <option value="CLEAR">Clear Weather (Dry Baseline · 0 mm/h)</option>
                <option value="LIGHT">Light Rain (Showers · ~3.5 mm/h)</option>
                <option value="MODERATE">Moderate Storm (Downpour · ~14.0 mm/h)</option>
                <option value="HEAVY">Heavy Rainstorm (Monsoon Burst · ~38.0 mm/h)</option>
                <option value="EXTREME">Extreme Cloudburst (Flash Flood · ~65.0 mm/h)</option>
              </select>
            </label>

            <div className="checkbox-options">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={blockDrainD7}
                  onChange={(e) => setBlockDrainD7(e.target.checked)}
                />
                <span>Simulate Drain D-07 Debris Blockage (near Manhole M-18)</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={pumpOffline}
                  onChange={(e) => setPumpOffline(e.target.checked)}
                />
                <span>Simulate Lowland Lift Pump Station SP-02 Power Outage</span>
              </label>
            </div>

            <button
              type="submit"
              className="planner-btn planner-btn--primary"
              style={{ width: '100%', marginTop: '0.8rem' }}
              disabled={isSimulating}
            >
              {isSimulating ? 'Simulating Runoff Dynamics...' : 'Run Rainfall Simulation'}
            </button>
          </form>
        </div>
      </div>

      {/* Cross-Contamination Threat to Drinking Water Mains */}
      <div className="wq-section-card">
        <div className="section-title-row">
          <h4>DRINKING WATER MAINS EXPOSED TO SEWAGE INGRESS RISK</h4>
          <span className="priority-badge priority-badge--alert">CROSS-CONTAMINATION HAZARD</span>
        </div>
        <p className="section-subtext">
          When sewer manholes surcharge near low-pressure drinking water pipes, back-siphonage ingress through microscopic joints threatens potable water safety.
        </p>

        <div className="threat-table-wrap">
          <table className="threat-table">
            <thead>
              <tr>
                <th>Threatened Water Main</th>
                <th>Isolation Valve</th>
                <th>Adjacent Manhole</th>
                <th>Ward Location</th>
                <th>Nearby Critical Facility</th>
                <th>Contamination Risk</th>
                <th>Mitigation Action</th>
              </tr>
            </thead>
            <tbody>
              {threatened_water_mains.map((t) => (
                <tr key={`${t.pipe_id}-${t.source_manhole}`} className={t.contamination_probability_pct > 70 ? 'row-alert' : ''}>
                  <td><strong>Drinking Main W-{t.pipe_id}</strong></td>
                  <td><span className="code-badge">{t.nearby_valve}</span></td>
                  <td><strong>{t.source_manhole}</strong></td>
                  <td>{t.ward}</td>
                  <td>{t.nearby_facility}</td>
                  <td>
                    <div className="risk-pct-cell">
                      <strong className={t.contamination_probability_pct > 70 ? 'val-alert' : 'val-warn'}>
                        {t.contamination_probability_pct}%
                      </strong>
                      <div className="pct-mini-track">
                        <div
                          className={`pct-mini-fill ${t.contamination_probability_pct > 70 ? 'pct-mini-fill--red' : 'pct-mini-fill--amber'}`}
                          style={{ width: `${t.contamination_probability_pct}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>
                    {onSwitchToResponsePlanner ? (
                      <button
                        type="button"
                        className="table-action-btn"
                        onClick={() => onSwitchToResponsePlanner(t.source_manhole.replace('M-', ''))}
                      >
                        Plan Cut ↗
                      </button>
                    ) : (
                      <span>Isolate {t.nearby_valve}</span>
                    )}
                  </td>
                </tr>
              ))}
              {threatened_water_mains.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center-muted">
                    No drinking water mains currently threatened by sewage ingress.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manhole Overflow Probability Matrix */}
      <div className="wq-section-card">
        <div className="section-title-row">
          <h4>MANHOLE SURCHARGE & 1H / 2H / 6H OVERFLOW PREDICTION</h4>
          <div className="table-filter-chips">
            <button
              type="button"
              className={`chip-btn ${filterRisk === 'all' ? 'chip-btn--active' : ''}`}
              onClick={() => setFilterRisk('all')}
            >
              All Manholes ({manholes.length})
            </button>
            <button
              type="button"
              className={`chip-btn ${filterRisk === 'high' ? 'chip-btn--active' : ''}`}
              onClick={() => setFilterRisk('high')}
            >
              High Risk / Critical ({high_risk_manhole_count})
            </button>
          </div>
        </div>

        <div className="manhole-cards-grid">
          {filteredManholes.map((mh) => (
            <div
              key={mh.id}
              className={`manhole-card ${mh.status === 'CRITICAL' ? 'manhole-card--critical' : mh.status === 'WARNING' ? 'manhole-card--warning' : ''}`}
            >
              <div className="mh-card-header">
                <div>
                  <span className="mh-id-tag">{mh.id}</span>
                  <h4 className="mh-title">{mh.name}</h4>
                  <small>{mh.ward} · Elev {mh.elevation_m}m</small>
                </div>
                <span className={`status-pill status-pill--${mh.status.toLowerCase()}`}>
                  {mh.status}
                </span>
              </div>

              <div className="mh-level-bar">
                <div className="mh-level-labels">
                  <span>Level: <strong>{mh.current_level_m}m</strong> / {mh.depth_m}m</span>
                  <span>{mh.fill_percentage}% Full</span>
                </div>
                <div className="mh-track">
                  <div
                    className={`mh-fill ${mh.fill_percentage >= 85 ? 'mh-fill--red' : mh.fill_percentage >= 60 ? 'mh-fill--amber' : 'mh-fill--green'}`}
                    style={{ width: `${Math.min(100, mh.fill_percentage)}%` }}
                  />
                </div>
              </div>

              <div className="mh-risks-row">
                <div className="mh-risk-col">
                  <span>1h Risk</span>
                  <strong>{mh.overflow_risk_1h_pct}%</strong>
                </div>
                <div className="mh-risk-col">
                  <span>2h Risk</span>
                  <strong className={mh.overflow_risk_2h_pct >= 75 ? 'val-alert' : ''}>
                    {mh.overflow_risk_2h_pct}%
                  </strong>
                </div>
                <div className="mh-risk-col">
                  <span>6h Risk</span>
                  <strong>{mh.overflow_risk_6h_pct}%</strong>
                </div>
              </div>

              <div className="mh-footer">
                <span>Nearby Water: W-{mh.nearby_water_main}</span>
                {mh.is_drain_blocked && <span className="drain-blocked-tag">DRAIN BLOCKED</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Field Actions Checklist */}
      <div className="wq-section-card">
        <h4>RECOMMENDED PUBLIC HEALTH & FIELD OPERATIONS ACTIONS</h4>
        <div className="actions-checklist">
          {recommended_field_actions.map((act, i) => (
            <div key={i} className="action-row-item">
              <span className="action-step-num">STEP {i + 1}</span>
              <p className="action-desc">{act}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SewerFloodPanel
