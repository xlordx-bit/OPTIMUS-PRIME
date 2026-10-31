import React from 'react'

export interface PublicAdvisoryProps {
  type: string
  title: string
  message: string
  ward?: string
  actions?: string[]
  onDismiss?: () => void
  onActionClick?: () => void
}

export const PublicAdvisoryBanner: React.FC<PublicAdvisoryProps> = ({
  type,
  title,
  message,
  ward,
  actions = [],
  onDismiss,
  onActionClick,
}) => {
  const isCritical = type === 'DO_NOT_USE_EMERGENCY' || type.includes('CRITICAL') || type.includes('SEVERE')
  const isHighRisk = type === 'BOIL_WATER_ADVISORY' || type.includes('HIGH_RISK') || type.includes('FLOOD_WARNING')

  const badgeColor = isCritical ? '#ef4444' : isHighRisk ? '#f59e0b' : '#38bdf8'
  const bannerBg = isCritical
    ? 'linear-gradient(90deg, rgba(239, 68, 68, 0.22) 0%, rgba(185, 28, 28, 0.12) 100%)'
    : 'linear-gradient(90deg, rgba(245, 158, 11, 0.20) 0%, rgba(217, 119, 6, 0.10) 100%)'
  const borderColor = isCritical ? 'rgba(239, 68, 68, 0.6)' : 'rgba(245, 158, 11, 0.5)'

  return (
    <div
      className="public-advisory-banner"
      style={{
        background: bannerBg,
        borderColor: borderColor,
      }}
    >
      <div className="advisory-left">
        <div className="advisory-icon-wrapper" style={{ borderColor: badgeColor, color: badgeColor }}>
          <span className="advisory-beacon" style={{ background: badgeColor }} />
          ALERT
        </div>
        <div className="advisory-content">
          <div className="advisory-title-row">
            <span className="advisory-badge" style={{ background: badgeColor }}>
              {title}
            </span>
            {ward && <span className="advisory-ward-tag">LOCATION: {ward.toUpperCase()}</span>}
            <span className="advisory-time-tag">LIVE BROADCAST</span>
          </div>
          <p className="advisory-message">{message}</p>
          {actions.length > 0 && (
            <div className="advisory-actions-preview">
              <strong>MUNICIPAL DIRECTIVE:</strong> {actions[0]}
            </div>
          )}
        </div>
      </div>
      <div className="advisory-right">
        {onActionClick && (
          <button type="button" className="advisory-action-btn" onClick={onActionClick}>
            Execute Protocol ↗
          </button>
        )}
        {onDismiss && (
          <button type="button" className="advisory-dismiss-btn" onClick={onDismiss} title="Dismiss banner">
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export default PublicAdvisoryBanner
