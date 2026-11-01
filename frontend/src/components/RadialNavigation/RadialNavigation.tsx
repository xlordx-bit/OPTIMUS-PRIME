import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  NAVIGATION_SECTORS,
  type NavTabId,
  type RadialSectorConfig,
} from './navigationConfig'
import './RadialNavigation.css'

// Reusable SVG Icon helper matching existing project icons
export function RadialIcon({
  name,
  size = 18,
}: {
  name: RadialSectorConfig['iconName']
  size?: number
}) {
  const paths: Record<string, React.ReactNode> = {
    drop: <path d="M12 3.2S5.5 10 5.5 15.1a6.5 6.5 0 0 0 13 0C18.5 10 12 3.2 12 3.2Z" />,
    activity: <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />,
    scan: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M7 12h10M12 7v10" />
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
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    ),
    valve: (
      <>
        <path d="M4 12h16M8 8v8M16 8v8" />
        <circle cx="12" cy="12" r="3" />
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
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      {paths[name] ?? null}
    </svg>
  )
}

export interface RadialNavigationProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  activeTab: NavTabId
  onSelectTab: (tab: NavTabId) => void
  badges?: Partial<Record<NavTabId, string | number>>
}

// Center of 680x680 SVG canvas
const CX = 340
const CY = 340
const R_INNER = 148
const R_OUTER = 295
const DEADZONE_PX = 65

/**
 * Creates an annular wedge SVG path (donut slice)
 */
function createSectorPath(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const radStart = toRad(startAngleDeg)
  const radEnd = toRad(endAngleDeg)

  const x1 = cx + rOut * Math.cos(radStart)
  const y1 = cy + rOut * Math.sin(radStart)
  const x2 = cx + rOut * Math.cos(radEnd)
  const y2 = cy + rOut * Math.sin(radEnd)

  const x3 = cx + rIn * Math.cos(radEnd)
  const y3 = cy + rIn * Math.sin(radEnd)
  const x4 = cx + rIn * Math.cos(radStart)
  const y4 = cy + rIn * Math.sin(radStart)

  const angleSpan = endAngleDeg - startAngleDeg
  const largeArcFlag = angleSpan > 180 ? 1 : 0

  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${largeArcFlag} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${largeArcFlag} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ')
}

export const RadialNavigation: React.FC<RadialNavigationProps> = ({
  isOpen,
  onOpenChange,
  activeTab,
  onSelectTab,
  badges = {},
}) => {
  const [hoveredId, setHoveredId] = useState<NavTabId | null>(null)
  const isHoldingTabRef = useRef(false)
  const wheelRef = useRef<HTMLDivElement>(null)

  // Track latest hoveredId in ref to access inside event listeners without stale closures
  const hoveredIdRef = useRef<NavTabId | null>(null)
  hoveredIdRef.current = hoveredId

  const activeTabRef = useRef<NavTabId>(activeTab)
  activeTabRef.current = activeTab

  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen

  // Prevent scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      setHoveredId(activeTab)
    } else {
      document.body.style.overflow = ''
      setHoveredId(null)
    }
  }, [isOpen, activeTab])

  // Angular direction detection from mouse position
  const handlePointerMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isOpenRef.current || !wheelRef.current) return

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

      const rect = wheelRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      const dx = clientX - centerX
      const dy = clientY - centerY
      const distance = Math.hypot(dx, dy)

      // If inside center deadzone, keep previous selection or do nothing
      if (distance < DEADZONE_PX) {
        return
      }

      // Convert (dx, dy) to 0..360 deg where 0 is Right (East), 90 is Down (South), 270 is Top (North)
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
      if (angleDeg < 0) angleDeg += 360

      // Find closest sector by smallest circular difference
      let closestSector = NAVIGATION_SECTORS[0]
      let minDiff = 360

      for (const sector of NAVIGATION_SECTORS) {
        const diff = Math.abs(((angleDeg - sector.centerAngleDeg + 180 + 360) % 360) - 180)
        if (diff < minDiff) {
          minDiff = diff
          closestSector = sector
        }
      }

      if (closestSector && closestSector.id !== hoveredIdRef.current) {
        setHoveredId(closestSector.id)
      }
    },
    []
  )

  // Global Keyboard event handler (Tab hold, ESC, Arrow Keys, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input, textarea or contenteditable
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (isInput) return

      // TAB KEYDOWN: Hold to open wheel
      if (e.key === 'Tab') {
        if (!e.repeat) {
          e.preventDefault()
          isHoldingTabRef.current = true
          if (!isOpenRef.current) {
            onOpenChange(true)
            setHoveredId(activeTabRef.current)
          }
        } else {
          // Repeated keydown while holding TAB: prevent browser focus cycling
          e.preventDefault()
        }
        return
      }

      // ESC: Close wheel without changing page
      if (e.key === 'Escape' && isOpenRef.current) {
        e.preventDefault()
        isHoldingTabRef.current = false
        onOpenChange(false)
        setHoveredId(null)
        return
      }

      // ARROW KEYS NAVIGATION WHEN WHEEL IS OPEN
      if (isOpenRef.current) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          const currentIndex = NAVIGATION_SECTORS.findIndex(
            (s) => s.id === (hoveredIdRef.current || activeTabRef.current)
          )
          const nextIndex = (currentIndex + 1) % NAVIGATION_SECTORS.length
          setHoveredId(NAVIGATION_SECTORS[nextIndex].id)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          const currentIndex = NAVIGATION_SECTORS.findIndex(
            (s) => s.id === (hoveredIdRef.current || activeTabRef.current)
          )
          const prevIndex =
            (currentIndex - 1 + NAVIGATION_SECTORS.length) % NAVIGATION_SECTORS.length
          setHoveredId(NAVIGATION_SECTORS[prevIndex].id)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const targetTab = hoveredIdRef.current || activeTabRef.current
          onSelectTab(targetTab)
          onOpenChange(false)
          isHoldingTabRef.current = false
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (isOpenRef.current && isHoldingTabRef.current) {
          e.preventDefault()
          isHoldingTabRef.current = false
          // GTA V hold-to-open mechanic: releasing Tab navigates to highlighted sector
          const selected = hoveredIdRef.current
          if (selected) {
            onSelectTab(selected)
          }
          onOpenChange(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('touchmove', handlePointerMove, { passive: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('touchmove', handlePointerMove)
    }
  }, [handlePointerMove, onOpenChange, onSelectTab])

  // Click on a specific sector: immediate navigation
  const handleSectorClick = (sectorId: NavTabId) => {
    onSelectTab(sectorId)
    onOpenChange(false)
    isHoldingTabRef.current = false
  }

  // Active or hovered sector configuration for center display
  const activeSector =
    NAVIGATION_SECTORS.find((s) => s.id === (hoveredId ?? activeTab)) ??
    NAVIGATION_SECTORS[0]

  const activeBadge = activeSector ? badges[activeSector.id] : undefined

  return (
    <div
      className={`radial-hud-overlay ${isOpen ? 'radial-hud-overlay--open' : ''}`}
      onClick={(e) => {
        // Clicking backdrop closes without navigating
        if (e.target === e.currentTarget) {
          onOpenChange(false)
          isHoldingTabRef.current = false
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="GTA V Radial Navigation Wheel"
    >
      {/* Close button for touch / desktop fallback */}
      <button
        type="button"
        className="radial-hud-close-btn"
        onClick={() => {
          onOpenChange(false)
          isHoldingTabRef.current = false
        }}
        title="Close Navigation Wheel (ESC)"
      >
        <span>CLOSE</span>
        <kbd>ESC</kbd>
      </button>

      {/* Main Radial Wheel */}
      <div className="radial-hud-wheel-container" ref={wheelRef}>
        {/* Soft Ambient Liquid Glow (No harsh lines) */}
        <div className="radial-hud-ambient-glow" />

        {/* Interactive Radial Sectors SVG */}
        <svg className="radial-hud-sectors-svg" viewBox="0 0 680 680">
          {NAVIGATION_SECTORS.map((sector) => {
            const isHighlighted = hoveredId === sector.id
            const isCurrent = activeTab === sector.id
            const badge = badges[sector.id]

            // 36° span per sector, with 1.4° laser gap
            const halfSpan = 18 - 0.7
            const startAngle = sector.centerAngleDeg - halfSpan
            const endAngle = sector.centerAngleDeg + halfSpan

            // Outer radius expands on highlight
            const rOut = isHighlighted ? R_OUTER + 12 : R_OUTER
            const rIn = R_INNER

            // Annular sector path
            const pathD = createSectorPath(CX, CY, rIn, rOut, startAngle, endAngle)

            // Centroid for positioning Icon and Label
            const midRad = (sector.centerAngleDeg * Math.PI) / 180
            const midR = (rIn + rOut) / 2 + (isHighlighted ? 4 : 0)
            const iconX = CX + midR * Math.cos(midRad)
            const iconY = CY + midR * Math.sin(midRad)

            // Calculate translation vector for GTA V ejection pop-out effect
            const popDistance = isHighlighted ? 8 : 0
            const transX = popDistance * Math.cos(midRad)
            const transY = popDistance * Math.sin(midRad)

            return (
              <g
                key={sector.id}
                className={`radial-hud-sector-group ${isHighlighted ? 'radial-hud-sector-group--highlighted' : ''
                  } ${isCurrent ? 'radial-hud-sector-group--current' : ''}`}
                style={{
                  transform: `translate(${transX.toFixed(1)}px, ${transY.toFixed(1)}px)`,
                }}
                onMouseEnter={() => setHoveredId(sector.id)}
                onClick={() => handleSectorClick(sector.id)}
              >
                {/* Sector Wedge Path */}
                <path d={pathD} className="radial-hud-sector-wedge" />

                {/* HTML content inside SVG foreignObject */}
                <foreignObject
                  x={iconX - 60}
                  y={iconY - 32}
                  width="120"
                  height="64"
                  style={{ overflow: 'visible', pointerEvents: 'none' }}
                >
                  <div className="radial-hud-sector-content">
                    <div style={{ position: 'relative' }}>
                      <div className="radial-hud-sector-icon">
                        <RadialIcon name={sector.iconName} size={18} />
                      </div>
                      {badge !== undefined && (
                        <span
                          className={`radial-hud-sector-badge ${typeof badge === 'string' && badge !== 'LEAK' && badge !== '!'
                              ? 'radial-hud-sector-badge--warning'
                              : ''
                            }`}
                        >
                          {badge}
                        </span>
                      )}
                    </div>
                    <span className="radial-hud-sector-label">{sector.label}</span>
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </svg>

        {/* Center Industrial SCADA Information Hub */}
        <div
          className="radial-hud-center-hub"
          role="button"
          tabIndex={0}
          onClick={() => {
            if (activeSector) {
              handleSectorClick(activeSector.id)
            }
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && activeSector) {
              e.preventDefault()
              handleSectorClick(activeSector.id)
            }
          }}
          title={activeSector ? `Click to launch ${activeSector.title}` : undefined}
          style={{ cursor: activeSector ? 'pointer' : 'default', pointerEvents: 'auto' }}
        >
          {/* Typographic Brand Mark & Subtitle */}
          <div className="radial-hud-center-brand">
            <span className="radial-hud-center-brand-logo">NirX</span>
            <span className="radial-hud-center-brand-sub">WATER INFRASTRUCTURE OPERATIONS</span>
          </div>

          {/* Dynamic Active / Hovered Module Detail */}
          {activeSector && (
            <div className="radial-hud-active-info" key={activeSector.id}>
              <div
                className={`radial-hud-active-pill ${
                  activeBadge ? 'radial-hud-active-pill--alert' : ''
                }`}
              >
                <span className="radial-hud-active-pill-dot" />
                <span>
                  {activeBadge ? `ALERT: ${activeBadge}` : activeSector.subtitle}
                </span>
              </div>

              <h3 className="radial-hud-active-title">{activeSector.title}</h3>
              <p className="radial-hud-active-desc">{activeSector.description}</p>
            </div>
          )}

          {/* Bottom Tactical Navigation Instructions */}
          <div className="radial-hud-instructions">
            <span>HOLD TAB TO SELECT</span>
            <span className="radial-hud-instructions-dot">•</span>
            <span>MOVE TO NAVIGATE</span>
            <span className="radial-hud-instructions-dot">•</span>
            <span>RELEASE OR CLICK TO OPEN</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Compact Industrial Command Navigation Trigger Button
 * Displays: COMMAND MENU [TAB] / ACTIVE MODULE
 */
export const RadialTriggerButton: React.FC<{
  activeTab: NavTabId
  onClick: () => void
  totalAlerts?: number
}> = ({ activeTab, onClick, totalAlerts = 0 }) => {
  const currentConfig =
    NAVIGATION_SECTORS.find((s) => s.id === activeTab) ?? NAVIGATION_SECTORS[0]

  return (
    <button
      type="button"
      className="radial-trigger-btn"
      onClick={onClick}
      title="Open Command Menu (Hold TAB or Click)"
      aria-label="Open Command Menu"
    >
      <span className="radial-trigger-icon">
        <RadialIcon name={currentConfig.iconName} size={14} />
      </span>
      <span className="radial-trigger-title">COMMAND MENU</span>
      <kbd className="radial-trigger-kbd">TAB</kbd>
      <span className="radial-trigger-sep"></span>
      <span className="radial-trigger-current">{currentConfig.label}</span>
      {totalAlerts > 0 && (
        <span className="radial-trigger-alert-badge">{totalAlerts}</span>
      )}
    </button>
  )
}

export default RadialNavigation
