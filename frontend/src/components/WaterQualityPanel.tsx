import React, { useState } from 'react'

export interface WQSensor {
  sensor_id: string
  node_id: string
  free_chlorine_mg_l: number
  chlorine_baseline_mg_l: number
  chlorine_delta_mg_l: number
  turbidity_ntu: number
  turbidity_baseline_ntu: number
  turbidity_delta_ntu: number
  ph: number
  conductivity_us_cm: number
  orp_mv: number
  temperature_c: number
  pressure_m: number
  status: string
  anomalies: string[]
  is_source_suspect: boolean
}

export interface ContaminationData {
  timestamp_iso: string
  status: string
  severity_level: string
  ml_classification: string
  confidence_score: number
  safety_rules_summary: {
    has_chlorine_drop: boolean
    has_turbidity_rise: boolean
    has_ph_abnormal: boolean
    has_pressure_drop: boolean
  }
  sensor_telemetry: WQSensor[]
  abnormal_sensor_count: number
  abnormal_sensors: string[]
  likely_source_nodes: {
    node_id: string
    confidence_pct: number
    rank: number
    ward: string
  }[]
  direction_of_spread: string
  affected_zone_nodes: string[]
  recommended_isolation_valves: string[]
  public_advisory: {
    type: string
    title: string
    message: string
    is_active: boolean
    ward: string
    recommended_actions: string[]
  }
  spread_timeline: {
    time_offset_minutes: number
    stage: string
    spread_radius_m: number
    affected_nodes: string[]
    concentration_pct: number
    severity: string
  }[]
}

interface WaterQualityPanelProps {
  data: ContaminationData | null
  loading?: boolean
  onInjectContamination: (payload: {
    node_id: string
    severity: string
    cl_drop: number
    turb_rise: number
    ph_shift: number
  }) => Promise<void> | void
  onResetContamination: () => Promise<void> | void
  onSwitchToResponsePlanner?: (nodeId: string) => void
}

export const WaterQualityPanel: React.FC<WaterQualityPanelProps> = ({
  data,
  loading = false,
  onInjectContamination,
  onResetContamination,
  onSwitchToResponsePlanner,
}) => {
  const [injectNode, setInjectNode] = useState('127')
  const [injectSeverity, setInjectSeverity] = useState('HIGH_RISK')
  const [injectClDrop, setInjectClDrop] = useState(0.45)
  const [injectTurbRise, setInjectTurbRise] = useState(6.2)
  const [injectPhShift, setInjectPhShift] = useState(-1.2)
  const [timelineStep, setTimelineStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [filterSensor, setFilterSensor] = useState<string>('all')

  if (loading || !data) {
    return (
      <div className="planner-loading-card">
        <div className="planner-spinner" />
        <h3>Evaluating Dual-Layer Water Quality Signals...</h3>
        <p>Analyzing chlorine residual, turbidity, pH, ORP, and Bayesian upstream plume localization.</p>
      </div>
    )
  }

  const {
    severity_level,
    ml_classification,
    confidence_score,
    safety_rules_summary,
    sensor_telemetry,
    likely_source_nodes,
    direction_of_spread,
    recommended_isolation_valves,
    public_advisory,
    spread_timeline,
  } = data

  const handleInjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await onInjectContamination({
        node_id: injectNode,
        severity: injectSeverity,
        cl_drop: injectClDrop,
        turb_rise: injectTurbRise,
        ph_shift: injectPhShift,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const filteredSensors =
    filterSensor === 'abnormal'
      ? sensor_telemetry.filter((s) => s.status !== 'NORMAL')
      : sensor_telemetry

  return (
    <div className="water-quality-panel">
      {/* Panel Top Header */}
      <div className="planner-header">
        <div className="planner-title-block">
          <span className="planner-tag">WATER QUALITY & MICROBIAL SURVEILLANCE</span>
          <h2 className="planner-headline">
            Contamination Detection & Upstream Localization
          </h2>
          <p className="planner-subtext">
            Dual-layer detection: deterministic safety rules + machine-learning anomaly classifier (WHO & BIS Standards).
          </p>
        </div>

        <div className="planner-header-actions">
          <button
            type="button"
            className="planner-btn planner-btn--secondary"
            onClick={() => onResetContamination()}
          >
            ↻ Restore Safe Baseline
          </button>
        </div>
      </div>

      {/* Advisory Callout Banner */}
      <div className={`wq-advisory-box ${public_advisory.is_active ? 'wq-advisory-box--alert' : 'wq-advisory-box--ok'}`}>
        <div className="wq-advisory-icon">
          {public_advisory.is_active ? '🚨' : '💧'}
        </div>
        <div className="wq-advisory-body">
          <div className="wq-advisory-tag-row">
            <span className="wq-advisory-pill">{public_advisory.title}</span>
            <span className="wq-advisory-status-pill">SEVERITY: {severity_level}</span>
            <span className="wq-advisory-status-pill">TARGET: {public_advisory.ward}</span>
          </div>
          <p className="wq-advisory-text">{public_advisory.message}</p>
        </div>
      </div>

      {/* Dual Detection Layers Status Cards */}
      <div className="wq-layers-grid">
        {/* Layer 1: Deterministic Safety Rules */}
        <div className="wq-card">
          <div className="wq-card-header">
            <div>
              <span className="wq-card-eyebrow">FIRST LAYER DETECTION</span>
              <h4 className="wq-card-title">Deterministic Safety Rules</h4>
            </div>
            <span className="layer-mode-tag">REAL-TIME TELEMETRY RULES</span>
          </div>

          <div className="safety-rules-checklist">
            <div className={`rule-item ${safety_rules_summary.has_chlorine_drop ? 'rule-item--alert' : 'rule-item--ok'}`}>
              <span className="rule-bullet">{safety_rules_summary.has_chlorine_drop ? '✗' : '✓'}</span>
              <div>
                <strong>Free Chlorine Threshold (&lt; 0.20 mg/L or drop &gt; 0.35 mg/L)</strong>
                <small>{safety_rules_summary.has_chlorine_drop ? 'Microbial pathogen risk: sharp chlorine depletion detected!' : 'Disinfection barrier active & normal.'}</small>
              </div>
            </div>

            <div className={`rule-item ${safety_rules_summary.has_turbidity_rise ? 'rule-item--alert' : 'rule-item--ok'}`}>
              <span className="rule-bullet">{safety_rules_summary.has_turbidity_rise ? '✗' : '✓'}</span>
              <div>
                <strong>Turbidity Intrusion Spike (&gt; 5.0 NTU or rise &gt; 2.5 NTU)</strong>
                <small>{safety_rules_summary.has_turbidity_rise ? 'Possible pipe shear, biofilm detachment, or soil ingress.' : 'Suspended solids within safe limits (&lt; 2.0 NTU).'}</small>
              </div>
            </div>

            <div className={`rule-item ${safety_rules_summary.has_ph_abnormal ? 'rule-item--alert' : 'rule-item--ok'}`}>
              <span className="rule-bullet">{safety_rules_summary.has_ph_abnormal ? '✗' : '✓'}</span>
              <div>
                <strong>pH Chemical Balance (Acceptable: 6.50 – 8.50)</strong>
                <small>{safety_rules_summary.has_ph_abnormal ? 'Chemical ingress or acidic back-siphonage.' : 'Optimal alkaline buffer maintained (pH 7.3 - 7.5).'}</small>
              </div>
            </div>

            <div className={`rule-item ${safety_rules_summary.has_pressure_drop ? 'rule-item--alert' : 'rule-item--ok'}`}>
              <span className="rule-bullet">{safety_rules_summary.has_pressure_drop ? '✗' : '✓'}</span>
              <div>
                <strong>Hydraulic Ingress Risk (&lt; 10.0 m head)</strong>
                <small>{safety_rules_summary.has_pressure_drop ? 'Low pressure creates backflow / external groundwater intrusion!' : 'Positive distribution pressure maintained.'}</small>
              </div>
            </div>
          </div>
        </div>

        {/* Layer 2: Machine Learning Classifier */}
        <div className="wq-card">
          <div className="wq-card-header">
            <div>
              <span className="wq-card-eyebrow">SECOND LAYER DETECTION</span>
              <h4 className="wq-card-title">ML Multi-Parameter Anomaly Engine</h4>
            </div>
            <span className="layer-mode-tag">RANDOM FOREST · SCIKIT-LEARN</span>
          </div>

          <div className="ml-status-hero">
            <div className="ml-classification-pill">
              CLASSIFICATION: <strong>{ml_classification.replace(/_/g, ' ')}</strong>
            </div>
            <div className="ml-confidence-score">
              CONFIDENCE: <strong>{confidence_score}%</strong>
            </div>
            <p className="ml-distinction-note">
              Model differentiates between <strong>Normal Variation</strong>, <strong>Sensor Fault</strong> (single parameter outlier), <strong>Hydraulic Disturbance</strong> (valve shut / pump trip without chemical shift), and <strong>True Contamination</strong>.
            </p>
          </div>

          <div className="ml-feature-indicators">
            <div className="feature-indicator">
              <span>Affected Sensors</span>
              <strong>{data.abnormal_sensor_count} of 12</strong>
            </div>
            <div className="feature-indicator">
              <span>Plume Flow Direction</span>
              <strong>{direction_of_spread}</strong>
            </div>
            <div className="feature-indicator">
              <span>Isolation Recommendation</span>
              <strong>{recommended_isolation_valves.join(' + ')}</strong>
            </div>
          </div>

          {onSwitchToResponsePlanner && likely_source_nodes.length > 0 && (
            <button
              type="button"
              className="planner-btn planner-btn--primary"
              style={{ width: '100%', marginTop: '1rem' }}
              onClick={() => onSwitchToResponsePlanner(likely_source_nodes[0].node_id)}
            >
              🛡️ Open Response Planner for Source Node #{likely_source_nodes[0].node_id} ↗
            </button>
          )}
        </div>
      </div>

      {/* Upstream Localization & Spread Timeline */}
      <div className="wq-section-card">
        <div className="section-title-row">
          <h4>UPSTREAM SOURCE LOCALIZATION (TOP-3 CANDIDATE NODES)</h4>
          <span className="priority-badge">BAYESIAN GRAPH TRACING</span>
        </div>

        <div className="source-nodes-grid">
          {likely_source_nodes.map((src) => (
            <div key={src.node_id} className={`source-node-card ${src.rank === 1 ? 'source-node-card--primary' : ''}`}>
              <div className="source-rank-badge">#{src.rank} CANDIDATE SOURCE</div>
              <h3>Junction {src.node_id}</h3>
              <p className="source-ward">{src.ward} · Suspect Origin Point</p>
              <div className="source-prob-bar">
                <div className="source-prob-label">
                  <span>Localization Probability</span>
                  <strong>{src.confidence_pct}%</strong>
                </div>
                <div className="source-track">
                  <div className="source-fill" style={{ width: `${src.confidence_pct}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Downstream Plume Spread Timeline */}
        {spread_timeline.length > 0 && (
          <div className="plume-timeline-block">
            <div className="plume-header">
              <h5>DOWNSTREAM CONTAMINATION SPREAD TIMELINE</h5>
              <span>Estimated plume dispersion over time</span>
            </div>

            <div className="timeline-stepper">
              {spread_timeline.map((step, idx) => (
                <button
                  type="button"
                  key={step.time_offset_minutes}
                  className={`stepper-node ${timelineStep === idx ? 'stepper-node--active' : ''}`}
                  onClick={() => setTimelineStep(idx)}
                >
                  <span className="stepper-time">t = {step.time_offset_minutes}m</span>
                  <strong className="stepper-stage">{step.stage}</strong>
                  <small>Radius ~{step.spread_radius_m}m ({step.concentration_pct}% conc)</small>
                </button>
              ))}
            </div>

            <div className="active-timeline-detail">
              <span className="timeline-detail-tag">STAGE ACTIVE: {spread_timeline[timelineStep]?.stage}</span>
              <p>
                Estimated dispersion radius: <strong>{spread_timeline[timelineStep]?.spread_radius_m} meters</strong>.
                Affected node cluster: <strong>[{spread_timeline[timelineStep]?.affected_nodes.join(', ')}]</strong>.
                Residual chemical concentration: <strong>{spread_timeline[timelineStep]?.concentration_pct}%</strong> of initial slug.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Sensor Telemetry Table */}
      <div className="wq-section-card">
        <div className="section-title-row">
          <h4>LIVE SENSOR WATER QUALITY MATRIX (12 FIXED NETWORK SENSORS)</h4>
          <div className="table-filter-chips">
            <button
              type="button"
              className={`chip-btn ${filterSensor === 'all' ? 'chip-btn--active' : ''}`}
              onClick={() => setFilterSensor('all')}
            >
              All Sensors ({sensor_telemetry.length})
            </button>
            <button
              type="button"
              className={`chip-btn ${filterSensor === 'abnormal' ? 'chip-btn--active' : ''}`}
              onClick={() => setFilterSensor('abnormal')}
            >
              Abnormal Signals ({data.abnormal_sensor_count})
            </button>
          </div>
        </div>

        <div className="wq-table-wrap">
          <table className="wq-table">
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Free Chlorine</th>
                <th>Turbidity</th>
                <th>pH</th>
                <th>Conductivity</th>
                <th>ORP</th>
                <th>Pressure</th>
                <th>Health Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredSensors.map((s) => (
                <tr key={s.sensor_id} className={s.is_source_suspect ? 'row-suspect' : ''}>
                  <td>
                    <strong>Sensor #{s.sensor_id}</strong>
                    {s.is_source_suspect && <span className="source-tag">ORIGIN SUSPECT</span>}
                  </td>
                  <td>
                    <span className={s.free_chlorine_mg_l < 0.20 ? 'val-alert' : 'val-ok'}>
                      {s.free_chlorine_mg_l.toFixed(2)} mg/L
                    </span>
                    <small className="delta-sub">
                      {s.chlorine_delta_mg_l >= 0 ? `+${s.chlorine_delta_mg_l}` : s.chlorine_delta_mg_l}
                    </small>
                  </td>
                  <td>
                    <span className={s.turbidity_ntu > 5.0 ? 'val-alert' : 'val-ok'}>
                      {s.turbidity_ntu.toFixed(1)} NTU
                    </span>
                  </td>
                  <td>
                    <span className={s.ph < 6.5 || s.ph > 8.5 ? 'val-alert' : 'val-ok'}>
                      {s.ph.toFixed(2)}
                    </span>
                  </td>
                  <td>{s.conductivity_us_cm.toFixed(0)} µS/cm</td>
                  <td>{s.orp_mv.toFixed(0)} mV</td>
                  <td>{s.pressure_m.toFixed(1)} m</td>
                  <td>
                    <span className={`status-pill status-pill--${s.status.toLowerCase()}`}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Contamination Injection Controls */}
      <div className="wq-section-card">
        <h4>SIMULATE WATER QUALITY ANOMALY / CONTAMINATION SCENARIO</h4>
        <form onSubmit={handleInjectSubmit} className="injection-form">
          <div className="form-row">
            <label>
              Target Node:
              <select value={injectNode} onChange={(e) => setInjectNode(e.target.value)}>
                <option value="127">Junction 127 (Ward 12)</option>
                <option value="117">Junction 117 (Anganwadi)</option>
                <option value="105">Junction 105 (Health Centre)</option>
                <option value="181">Junction 181 (Civil Hospital)</option>
              </select>
            </label>

            <label>
              Alert Severity:
              <select value={injectSeverity} onChange={(e) => setInjectSeverity(e.target.value)}>
                <option value="WATCH">Watch (Mild single anomaly)</option>
                <option value="WARNING">Warning (Chlorine drop / turbidity spike)</option>
                <option value="HIGH_RISK">High Risk (Boil-Water Advisory)</option>
                <option value="CRITICAL">Critical (Emergency Sewage Ingress / Do-Not-Use)</option>
              </select>
            </label>

            <label>
              Chlorine Drop (mg/L):
              <input
                type="number"
                step="0.05"
                min="0.1"
                max="0.8"
                value={injectClDrop}
                onChange={(e) => setInjectClDrop(parseFloat(e.target.value) || 0.45)}
              />
            </label>

            <label>
              Turbidity Rise (NTU):
              <input
                type="number"
                step="0.5"
                min="1.0"
                max="25.0"
                value={injectTurbRise}
                onChange={(e) => setInjectTurbRise(parseFloat(e.target.value) || 6.2)}
              />
            </label>

            <label>
              pH Deviation:
              <input
                type="number"
                step="0.1"
                value={injectPhShift}
                onChange={(e) => setInjectPhShift(parseFloat(e.target.value) || -1.2)}
              />
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="planner-btn planner-btn--primary" disabled={isSubmitting}>
              {isSubmitting ? 'Injecting Plume...' : '🧪 Inject Contamination Scenario'}
            </button>
            <button
              type="button"
              className="planner-btn planner-btn--secondary"
              onClick={() => onResetContamination()}
            >
              Reset to Clean Baseline
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default WaterQualityPanel
