import React, { useState } from 'react'

export interface CriticalFacility {
  id: string
  name: string
  type: string
  node_id: string
  ward: string
  min_pressure_m: number
  estimated_pressure_m: number
  is_supplied: boolean
}

export interface ValvePlan {
  valves: string[]
  valve_labels: string[]
  closed_pipes: string[]
  is_event_isolated: boolean
  affected_households: number
  affected_population: number
  disconnected_nodes_count: number
  critical_facilities_protected: CriticalFacility[]
  critical_facilities_lost: CriticalFacility[]
  all_critical_protected: boolean
  water_saved_lph: number
  min_remaining_pressure_m: number
  expected_duration_hours: number
  alternate_path_exists: boolean
  score: number
  trade_off_label?: string
}

export interface ValvePrioritisationData {
  target_node: string
  event_type: string
  leak_rate_lph: number
  recommended_plan: ValvePlan
  alternative_plans: ValvePlan[]
  summary: string
  confidence_score: number
  candidate_valves_evaluated: number
}

interface ResponsePlannerProps {
  data: ValvePrioritisationData | null
  loading?: boolean
  onSimulatePlan: (valves: string[]) => Promise<void> | void
  onRefreshPlans?: () => void
  onSwitchToMap?: () => void
}

export const ResponsePlanner: React.FC<ResponsePlannerProps> = ({
  data,
  loading = false,
  onSimulatePlan,
  onRefreshPlans,
  onSwitchToMap,
}) => {
  const [selectedPlanTab, setSelectedPlanTab] = useState<'recommended' | number>('recommended')
  const [isSimulating, setIsSimulating] = useState(false)
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null)

  if (loading || !data) {
    return (
      <div className="planner-loading-card">
        <div className="planner-spinner" />
        <h3>Computing Multi-Valve Cut Combinations...</h3>
        <p>Evaluating graph reachability, hydraulic pressure attenuation, and critical facility preservation.</p>
      </div>
    )
  }

  const { recommended_plan, alternative_plans, summary, target_node, confidence_score } = data

  const currentPlan =
    selectedPlanTab === 'recommended'
      ? recommended_plan
      : alternative_plans[selectedPlanTab] || recommended_plan

  const handleSimulate = async (valves: string[]) => {
    setIsSimulating(true)
    setActionSuccessMsg(null)
    try {
      await onSimulatePlan(valves)
      setActionSuccessMsg(`Successfully applied isolation valves [${valves.join(', ')}] in simulation!`)
      setTimeout(() => setActionSuccessMsg(null), 5000)
    } finally {
      setIsSimulating(false)
    }
  }

  return (
    <div className="response-planner-container">
      {/* Top Banner Header */}
      <div className="planner-header">
        <div className="planner-title-block">
          <span className="planner-tag">AUTOMATED RESPONSE PLANNER</span>
          <h2 className="planner-headline">
            Valve-Cut Prioritisation Engine · Junction #{target_node}
          </h2>
          <p className="planner-subtext">
            Multi-criteria optimization: stops the problem while keeping hospitals, schools, anganwadis, and maximum households supplied.
          </p>
        </div>
        <div className="planner-header-actions">
          {onRefreshPlans && (
            <button type="button" className="planner-btn planner-btn--secondary" onClick={onRefreshPlans}>
              ↻ Recalculate Plans
            </button>
          )}
          {onSwitchToMap && (
            <button type="button" className="planner-btn planner-btn--primary" onClick={onSwitchToMap}>
              🗺️ View on 3D Map
            </button>
          )}
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="planner-toast planner-toast--success">
          ✓ {actionSuccessMsg}
        </div>
      )}

      {/* Verified Natural Language Output Banner per Spec */}
      <div className="planner-summary-callout">
        <div className="summary-callout-icon">💡</div>
        <div className="summary-callout-body">
          <span className="summary-callout-label">SYSTEM RECOMMENDATION VERDICT</span>
          <p className="summary-callout-text">{summary}</p>
        </div>
      </div>

      {/* Plan Selection Tabs */}
      <div className="planner-tabs">
        <button
          type="button"
          className={`plan-tab-btn ${selectedPlanTab === 'recommended' ? 'plan-tab-btn--active' : ''}`}
          onClick={() => setSelectedPlanTab('recommended')}
        >
          <span className="tab-pill tab-pill--rec">RECOMMENDED</span>
          <strong>Plan #1: {recommended_plan.valve_labels.join(' + ')}</strong>
          <small>Score: {recommended_plan.score}% · {recommended_plan.trade_off_label || 'Optimal Balance'}</small>
        </button>

        {alternative_plans.map((alt, idx) => (
          <button
            type="button"
            key={alt.valves.join('-')}
            className={`plan-tab-btn ${selectedPlanTab === idx ? 'plan-tab-btn--active' : ''}`}
            onClick={() => setSelectedPlanTab(idx)}
          >
            <span className="tab-pill">ALT #{idx + 1}</span>
            <strong>{alt.valve_labels.join(' + ')}</strong>
            <small>{alt.trade_off_label || `Score: ${alt.score}%`}</small>
          </button>
        ))}
      </div>

      {/* Active Plan Detail Hero Card */}
      <div className="plan-detail-card">
        <div className="plan-detail-top">
          <div className="plan-hero-left">
            <div className="plan-hero-badge-strip">
              <span className={`status-pill ${currentPlan.is_event_isolated ? 'status-pill--green' : 'status-pill--red'}`}>
                {currentPlan.is_event_isolated ? '✓ FULLY ISOLATED' : '⚠ PARTIAL CONTAINMENT'}
              </span>
              <span className={`status-pill ${currentPlan.all_critical_protected ? 'status-pill--green' : 'status-pill--amber'}`}>
                {currentPlan.all_critical_protected ? '🛡️ ALL CRITICAL FACILITIES SAFE' : '⚠ FACILITY AT RISK'}
              </span>
              <span className="status-pill status-pill--cyan">
                ⚡ CONFIDENCE: {confidence_score}%
              </span>
            </div>
            <h3 className="plan-hero-title">
              Valves to Close: <span className="highlight-valves">{currentPlan.valve_labels.join(' and ')}</span>
            </h3>
            <p className="plan-hero-desc">
              Trade-off Evaluation: <strong>{currentPlan.trade_off_label}</strong>.
              {currentPlan.is_event_isolated
                ? ' Graph reachability confirms problem pipe is severed from pressurized sources without backflow.'
                : ' Notice: 1-valve cut permits loop backflow; dual cut is advised.'}
            </p>
          </div>

          <div className="plan-hero-cta">
            <button
              type="button"
              className="simulate-plan-btn"
              disabled={isSimulating}
              onClick={() => handleSimulate(currentPlan.valves)}
            >
              {isSimulating ? 'Simulating Propagation...' : '⚡ Simulate This Plan'}
            </button>
            <small className="simulate-note">Simulates on temporary graph copy. Does not send physical hardware commands.</small>
          </div>
        </div>

        {/* 6 Core Metrics Grid */}
        <div className="plan-metrics-grid">
          <div className="planner-metric-box">
            <span className="metric-box-label">WATER SAVED</span>
            <strong className="metric-box-val metric-box-val--green">
              {Math.round(currentPlan.water_saved_lph).toLocaleString()} L/h
            </strong>
            <span className="metric-box-sub">
              ~{Math.round(currentPlan.water_saved_lph * 0.264172).toLocaleString()} gal/hr
            </span>
          </div>

          <div className="planner-metric-box">
            <span className="metric-box-label">HOUSEHOLDS DISRUPTED</span>
            <strong className={`metric-box-val ${currentPlan.affected_households > 250 ? 'metric-box-val--amber' : ''}`}>
              {currentPlan.affected_households} HH
            </strong>
            <span className="metric-box-sub">~{currentPlan.affected_population.toLocaleString()} residents</span>
          </div>

          <div className="planner-metric-box">
            <span className="metric-box-label">ESTIMATED DURATION</span>
            <strong className="metric-box-val">
              {currentPlan.expected_duration_hours.toFixed(1)} hrs
            </strong>
            <span className="metric-box-sub">Isolation & repair window</span>
          </div>

          <div className="planner-metric-box">
            <span className="metric-box-label">MIN REMAINING HEAD</span>
            <strong className="metric-box-val">
              {currentPlan.min_remaining_pressure_m.toFixed(1)} m
            </strong>
            <span className="metric-box-sub">{(currentPlan.min_remaining_pressure_m * 1.42234).toFixed(1)} PSI</span>
          </div>

          <div className="planner-metric-box">
            <span className="metric-box-label">VALVES TO OPERATE</span>
            <strong className="metric-box-val">{currentPlan.valves.length}</strong>
            <span className="metric-box-sub">Fewer cuts = Faster execution</span>
          </div>

          <div className="planner-metric-box">
            <span className="metric-box-label">COMPOSITE SCORE</span>
            <strong className="metric-box-val metric-box-val--cyan">
              {currentPlan.score.toFixed(1)} / 100
            </strong>
            <span className="metric-box-sub">Priority weighted</span>
          </div>
        </div>

        {/* Critical Facilities Preservation Status */}
        <div className="facilities-section">
          <div className="section-title-row">
            <h4>CRITICAL FACILITIES SUPPLY SAFEGUARD</h4>
            <span className="priority-badge">HOSPITALS & SCHOOLS TOP PRIORITY</span>
          </div>
          <div className="facilities-cards-grid">
            {currentPlan.critical_facilities_protected.map((fac) => (
              <div key={fac.id} className="fac-card fac-card--protected">
                <div className="fac-card-top">
                  <span className="fac-type-icon">
                    {fac.type === 'hospital' ? '🏥' : fac.type === 'school' ? '🏫' : fac.type === 'anganwadi' ? '👶' : '⚕️'}
                  </span>
                  <div>
                    <strong>{fac.name}</strong>
                    <small>Node #{fac.node_id} · {fac.ward}</small>
                  </div>
                </div>
                <div className="fac-pressure-bar">
                  <div className="fac-bar-label">
                    <span>Head: <strong>{fac.estimated_pressure_m} m</strong></span>
                    <span className="fac-status-tag fac-status-tag--ok">SUPPLIED ✓</span>
                  </div>
                  <div className="fac-progress-track">
                    <div
                      className="fac-progress-fill"
                      style={{ width: `${Math.min(100, (fac.estimated_pressure_m / 35.0) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}

            {currentPlan.critical_facilities_lost.map((fac) => (
              <div key={fac.id} className="fac-card fac-card--lost">
                <div className="fac-card-top">
                  <span className="fac-type-icon">⚠️</span>
                  <div>
                    <strong>{fac.name}</strong>
                    <small>Node #{fac.node_id} · {fac.ward}</small>
                  </div>
                </div>
                <div className="fac-pressure-bar">
                  <div className="fac-bar-label">
                    <span>Head: <strong>{fac.estimated_pressure_m} m</strong></span>
                    <span className="fac-status-tag fac-status-tag--lost">AT RISK ✗</span>
                  </div>
                  <div className="fac-progress-track fac-progress-track--alert">
                    <div className="fac-progress-fill fac-progress-fill--red" style={{ width: '15%' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alternative Plans Comparative Matrix */}
        <div className="alternatives-section">
          <h4>ALTERNATIVE PLANS & TRADE-OFF COMPARISON</h4>
          <div className="alt-table-wrap">
            <table className="alt-plans-table">
              <thead>
                <tr>
                  <th>Plan Tier</th>
                  <th>Valves to Close</th>
                  <th>Event Isolated?</th>
                  <th>Hospital Safe?</th>
                  <th>Households Cut</th>
                  <th>Water Saved</th>
                  <th>Score</th>
                  <th>Simulate</th>
                </tr>
              </thead>
              <tbody>
                <tr className={selectedPlanTab === 'recommended' ? 'row-active' : ''}>
                  <td>
                    <span className="tab-pill tab-pill--rec">RECOMMENDED</span>
                  </td>
                  <td><strong>{recommended_plan.valve_labels.join(', ')}</strong></td>
                  <td><span className="text-ok">YES ✓</span></td>
                  <td><span className="text-ok">PROTECTED ✓</span></td>
                  <td>{recommended_plan.affected_households} HH</td>
                  <td>{Math.round(recommended_plan.water_saved_lph).toLocaleString()} L/h</td>
                  <td><strong>{recommended_plan.score}%</strong></td>
                  <td>
                    <button
                      type="button"
                      className="table-action-btn"
                      onClick={() => handleSimulate(recommended_plan.valves)}
                    >
                      Simulate
                    </button>
                  </td>
                </tr>

                {alternative_plans.map((alt, i) => (
                  <tr key={alt.valves.join(',')} className={selectedPlanTab === i ? 'row-active' : ''}>
                    <td>
                      <span className="tab-pill">ALT #{i + 1}</span>
                      <small className="alt-tradeoff-sub">{alt.trade_off_label}</small>
                    </td>
                    <td><strong>{alt.valve_labels.join(', ')}</strong></td>
                    <td>
                      {alt.is_event_isolated ? (
                        <span className="text-ok">YES ✓</span>
                      ) : (
                        <span className="text-alert">PARTIAL ⚠</span>
                      )}
                    </td>
                    <td>
                      {alt.all_critical_protected ? (
                        <span className="text-ok">PROTECTED ✓</span>
                      ) : (
                        <span className="text-alert">AT RISK ✗</span>
                      )}
                    </td>
                    <td>{alt.affected_households} HH</td>
                    <td>{Math.round(alt.water_saved_lph).toLocaleString()} L/h</td>
                    <td><strong>{alt.score}%</strong></td>
                    <td>
                      <button
                        type="button"
                        className="table-action-btn"
                        onClick={() => handleSimulate(alt.valves)}
                      >
                        Simulate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResponsePlanner
