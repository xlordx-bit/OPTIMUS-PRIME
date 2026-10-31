import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, Feature } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import './Network3DMap.css'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

export type NetworkNode = {
  id: string
  type: string
  coordinates: { x: number; y: number }
  lat_lng: number[]
  elevation?: number
  base_demand?: number
  is_sensor: boolean
}

export type NetworkPipe = {
  id: string
  start_node: string
  end_node: string
  length?: number
  diameter?: number
  roughness?: number
  coordinates: number[][]
  lat_lng_path?: number[][]
}

export type NetworkResponse = {
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

export type Sensor = {
  node_id: string
  current_pressure_m: number
  baseline_pressure_m: number
  pressure_drop_m: number
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | string
}

export type ActiveLeak = {
  node_id: string
  leak_area_m2: number
  actual_leak_flow_lph: number
  injected_at_hour?: number
}

export type NetworkState = {
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

export type Suspect = {
  node_id: string
  probability: number
  rank: number
  lat_lng?: number[]
}

export type Detection = {
  leak_detected: boolean
  detector_model: string
  anomaly_score: number
  confidence: number
  estimated_leak_rate_lph: number
  estimated_leak_area_m2: number
  top_suspects: Suspect[]
}

export type ContaminationMapData = {
  status: string
  severity_level: string
  likely_source_nodes?: { node_id: string; confidence_pct: number; rank: number }[]
  sensor_telemetry?: {
    sensor_id: string
    free_chlorine_mg_l: number
    turbidity_ntu: number
    ph: number
    status: string
    is_source_suspect?: boolean
  }[]
  public_advisory?: {
    type: string
    title: string
    message: string
    is_active: boolean
    ward: string
  }
}

export type SewerManholeMapItem = {
  id: string
  name: string
  ward: string
  lat_lng: number[]
  current_level_m: number
  overflow_risk_2h_pct: number
  status: string
  nearby_water_main: string
  nearby_facility?: string
}

export type SewerMapData = {
  manholes?: SewerManholeMapItem[]
  conduits?: {
    id: string
    lat_lng_path?: number[][]
    diameter_mm: number
  }[]
  facilities?: {
    id: string
    name: string
    type: string
    lat_lng: number[]
    status: string
  }[]
  flood_zones?: {
    id: string
    name: string
    risk_level: string
    lat_lng: number[]
    radius_m: number
  }[]
}

interface Network3DMapProps {
  network: NetworkResponse | null
  state: NetworkState | null
  detection: Detection | null
  selectedNode: string
  onSelectNode: (nodeId: string) => void
  onInjectAtNode?: (nodeId: string) => void
  onSwitchToWhatIf?: (linkId: string) => void
  isFullScreen?: boolean
  onToggleFullScreen?: () => void
  waterQualityData?: ContaminationMapData | null
  sewerData?: SewerMapData | null
}

const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_API_KEY as string | undefined)?.trim() || ''

function getMapStyle(): string {
  if (MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`
  }
  return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
}

export const Network3DMap: React.FC<Network3DMapProps> = ({
  network,
  state,
  detection,
  selectedNode,
  onSelectNode,
  onInjectAtNode,
  onSwitchToWhatIf,
  isFullScreen = false,
  onToggleFullScreen,
  waterQualityData,
  sewerData,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const pulseMarkerRef = useRef<maplibregl.Marker | null>(null)
  const contamPulseMarkerRef = useRef<maplibregl.Marker | null>(null)
  const suspectMarkersRef = useRef<maplibregl.Marker[]>([])
  const orbitAnimationRef = useRef<number | null>(null)

  // Map state
  const [mapLoaded, setMapLoaded] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [is3DMode, setIs3DMode] = useState(true)
  const [isOrbiting, setIsOrbiting] = useState(false)

  // Layer filters
  const [layerFilters, setLayerFilters] = useState({
    pipelines: true,
    sensors: true,
    junctions: true,
    tanks: true,
    leaks: true,
    buildings: true,
    waterQuality: true,
    sewerLayer: true,
  })

  // Timeline state (0.0 to 6.0 hours)
  const [timelineHour, setTimelineHour] = useState(6.0)
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false)
  const timelineIntervalRef = useRef<number | null>(null)

  // Active inspected element popup state
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null)

  // Standard ES6 Map lookups
  const sensorMap = useMemo(
    () => new globalThis.Map<string, Sensor>(state?.sensors.map((s) => [s.node_id, s]) ?? []),
    [state]
  )
  const suspectMap = useMemo(
    () => new globalThis.Map<string, Suspect>(detection?.top_suspects.map((s) => [s.node_id, s]) ?? []),
    [detection]
  )
  const nodeLookup = useMemo(
    () => new globalThis.Map<string, NetworkNode>(network?.nodes.map((n) => [n.id, n]) ?? []),
    [network]
  )

  // Calculate default center and bounding box from network nodes
  const bounds = useMemo(() => {
    if (!network || network.nodes.length === 0) return null
    const lngs = network.nodes.map((n) => n.lat_lng[1])
    const lats = network.nodes.map((n) => n.lat_lng[0])
    return {
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      centerLng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      centerLat: (Math.min(...lats) + Math.max(...lats)) / 2,
    }
  }, [network])

  // Generate GeoJSON FeatureCollections
  const pipelinesGeoJSON = useMemo<FeatureCollection>(() => {
    if (!network) return { type: 'FeatureCollection', features: [] }

    const leakNodeId = state?.active_leak?.node_id

    const features: Feature[] = network.pipes
      .filter((pipe) => pipe.lat_lng_path && pipe.lat_lng_path.length >= 2)
      .map((pipe) => {
        const coords = pipe.lat_lng_path!.map(([lat, lng]) => [lng, lat])
        const isConnectedToLeak = leakNodeId
          ? pipe.start_node === leakNodeId || pipe.end_node === leakNodeId
          : false

        const startSensor = sensorMap.get(pipe.start_node)
        const endSensor = sensorMap.get(pipe.end_node)
        const isWarning =
          (startSensor && startSensor.pressure_drop_m > 0.8) ||
          (endSensor && endSensor.pressure_drop_m > 0.8)

        // Color coding: Red = Leak, Yellow = Warning, Green = Healthy
        let status = 'healthy'
        let color = '#22c55e' // emerald green
        let glowColor = '#10b981'

        if (isConnectedToLeak) {
          status = 'leak'
          color = '#ef4444' // vivid red
          glowColor = '#f87171'
        } else if (isWarning) {
          status = 'warning'
          color = '#f59e0b' // amber
          glowColor = '#fbbf24'
        }

        return {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
          properties: {
            id: pipe.id,
            start_node: pipe.start_node,
            end_node: pipe.end_node,
            length: pipe.length ?? 250,
            diameter: pipe.diameter ?? 0.3,
            status,
            color,
            glowColor,
            isAffectedByLeak: isConnectedToLeak,
          },
        }
      })

    return { type: 'FeatureCollection', features }
  }, [network, state, sensorMap])

  const nodesGeoJSON = useMemo<FeatureCollection>(() => {
    if (!network) return { type: 'FeatureCollection', features: [] }

    const leakNodeId = state?.active_leak?.node_id
    const contamSourceId = waterQualityData?.likely_source_nodes?.[0]?.node_id

    const features: Feature[] = network.nodes
      .filter((node) => node.lat_lng && node.lat_lng.length === 2)
      .map((node) => {
        const sensor = sensorMap.get(node.id)
        const suspect = suspectMap.get(node.id)
        const isLeak = leakNodeId === node.id
        const isContamSource = Boolean(contamSourceId && contamSourceId === node.id && waterQualityData?.status !== 'NORMAL')

        const wq = waterQualityData?.sensor_telemetry?.find((s) => s.sensor_id === node.id)
        let nodeStatus = isLeak
          ? 'LEAK'
          : isContamSource
          ? 'CRITICAL'
          : sensor
          ? sensor.status
          : node.type === 'tank' || node.type === 'reservoir'
          ? 'STORAGE'
          : 'NORMAL'

        // If water quality layer is prioritized and has abnormal status
        if (layerFilters.waterQuality && wq && wq.status !== 'NORMAL') {
          nodeStatus = wq.status === 'CRITICAL' || wq.status === 'HIGH_RISK' ? 'CRITICAL' : 'WARNING'
        }

        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [node.lat_lng[1], node.lat_lng[0]],
          },
          properties: {
            id: node.id,
            type: node.type,
            elevation: node.elevation ?? 0,
            base_demand: node.base_demand ?? 0,
            is_sensor: node.is_sensor,
            is_leak: isLeak,
            is_contam_source: isContamSource,
            is_suspect: Boolean(suspect),
            suspect_rank: suspect?.rank ?? 0,
            suspect_prob: suspect?.probability ?? 0,
            pressure_m: sensor?.current_pressure_m ?? null,
            baseline_m: sensor?.baseline_pressure_m ?? null,
            drop_m: sensor?.pressure_drop_m ?? 0,
            free_chlorine: wq?.free_chlorine_mg_l ?? null,
            turbidity: wq?.turbidity_ntu ?? null,
            status: nodeStatus,
          },
        }
      })

    return { type: 'FeatureCollection', features }
  }, [network, state, sensorMap, suspectMap, waterQualityData, layerFilters.waterQuality])

  // Sewer Conduits GeoJSON
  const sewerConduitsGeoJSON = useMemo<FeatureCollection>(() => {
    if (!sewerData?.conduits) return { type: 'FeatureCollection', features: [] }
    const features: Feature[] = sewerData.conduits
      .filter((c) => c.lat_lng_path && c.lat_lng_path.length >= 2)
      .map((c) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: c.lat_lng_path!.map(([lat, lng]) => [lng, lat]),
        },
        properties: {
          id: c.id,
          diameter_mm: c.diameter_mm,
        },
      }))
    return { type: 'FeatureCollection', features }
  }, [sewerData])

  // Sewer Manholes GeoJSON
  const sewerManholesGeoJSON = useMemo<FeatureCollection>(() => {
    if (!sewerData?.manholes) return { type: 'FeatureCollection', features: [] }
    const features: Feature[] = sewerData.manholes.map((mh) => {
      let riskColor = '#10b981' // Green Normal
      if (mh.status === 'CRITICAL' || mh.overflow_risk_2h_pct >= 75) {
        riskColor = '#ef4444' // Red Critical
      } else if (mh.status === 'WARNING' || mh.overflow_risk_2h_pct >= 50) {
        riskColor = '#f59e0b' // Amber Warning
      } else if (mh.status === 'WATCH' || mh.overflow_risk_2h_pct >= 25) {
        riskColor = '#38bdf8' // Cyan Watch
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [mh.lat_lng[1], mh.lat_lng[0]],
        },
        properties: {
          id: mh.id,
          name: mh.name,
          ward: mh.ward,
          current_level_m: mh.current_level_m,
          overflow_risk_2h_pct: mh.overflow_risk_2h_pct,
          status: mh.status,
          risk_color: riskColor,
          nearby_water_main: mh.nearby_water_main,
          nearby_facility: mh.nearby_facility || 'Residential',
        },
      }
    })
    return { type: 'FeatureCollection', features }
  }, [sewerData])

  // Initialize MapLibre GL Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const initialCenter: [number, number] = bounds
      ? [bounds.centerLng, bounds.centerLat]
      : [-122.4194, 37.7749]

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: getMapStyle(),
      center: initialCenter,
      zoom: 13.8,
      pitch: 58,
      bearing: -22,
      maxPitch: 85,
    })

    mapRef.current = map

    map.on('load', () => {
      setMapLoaded(true)
      setMapError(null)

      map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')

      try {
        const layers = map.getStyle().layers || []
        const labelLayer = layers.find(
          (l) => l.type === 'symbol' && l.layout && 'text-field' in l.layout
        )
        const labelLayerId = labelLayer ? labelLayer.id : undefined

        const sources = map.getStyle().sources || {}
        let buildingSource = 'carto'
        if ('maptiler_planet' in sources) buildingSource = 'maptiler_planet'
        else if ('openmaptiles' in sources) buildingSource = 'openmaptiles'
        else if ('composite' in sources) buildingSource = 'composite'
        else if ('carto' in sources) buildingSource = 'carto'

        if (!map.getLayer('3d-buildings') && map.getSource(buildingSource)) {
          map.addLayer(
            {
              id: '3d-buildings',
              source: buildingSource,
              'source-layer': 'building',
              type: 'fill-extrusion',
              minzoom: 13,
              paint: {
                'fill-extrusion-color': '#0d1a21',
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 18],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
                'fill-extrusion-opacity': 0.75,
              },
            },
            labelLayerId
          )
        }

        // Add Realistic 3D Terrain Elevation if MapTiler key is active
        if (MAPTILER_KEY && !map.getSource('maptiler-terrain')) {
          try {
            map.addSource('maptiler-terrain', {
              type: 'raster-dem',
              url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
              tileSize: 256,
            })
            map.setTerrain({ source: 'maptiler-terrain', exaggeration: 1.25 })
          } catch {
            // Safe fallback if raster-dem is not supported by client GPU
          }
        }
      } catch {
        // Safe fallback
      }

      // Add Pipeline Source
      map.addSource('pipelines-source', {
        type: 'geojson',
        data: pipelinesGeoJSON,
      })

      // Pipeline Shadow / Casing
      map.addLayer({
        id: 'pipelines-casing',
        type: 'line',
        source: 'pipelines-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': ['case', ['get', 'isAffectedByLeak'], 11, 7],
          'line-color': '#03080b',
          'line-opacity': 0.8,
        },
      })

      // Pipeline Outer Glow
      map.addLayer({
        id: 'pipelines-glow',
        type: 'line',
        source: 'pipelines-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': ['case', ['get', 'isAffectedByLeak'], 9, 5],
          'line-color': ['get', 'glowColor'],
          'line-blur': 3.5,
          'line-opacity': 0.85,
        },
      })

      // Pipeline Inner Neon Core
      map.addLayer({
        id: 'pipelines-core',
        type: 'line',
        source: 'pipelines-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': ['case', ['get', 'isAffectedByLeak'], 3.6, 2.2],
          'line-color': ['get', 'color'],
          'line-opacity': 0.98,
        },
      })

      // Add Nodes Source
      map.addSource('nodes-source', {
        type: 'geojson',
        data: nodesGeoJSON,
      })

      // Regular Junctions dots (excluding sensors)
      map.addLayer({
        id: 'junctions-layer',
        type: 'circle',
        source: 'nodes-source',
        filter: ['all', ['==', ['get', 'type'], 'junction'], ['!=', ['get', 'is_sensor'], true]],
        paint: {
          'circle-radius': 3.2,
          'circle-color': [
            'case',
            ['get', 'is_leak'],
            '#ef4444',
            '#64748b',
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#071116',
          'circle-opacity': 0.95,
        },
      })

      // Sensor Glow
      map.addLayer({
        id: 'sensors-glow-layer',
        type: 'circle',
        source: 'nodes-source',
        filter: ['all', ['==', ['get', 'type'], 'junction'], ['==', ['get', 'is_sensor'], true]],
        paint: {
          'circle-radius': 14,
          'circle-color': [
            'match',
            ['get', 'status'],
            'CRITICAL',
            '#ef4444',
            'WARNING',
            '#f59e0b',
            '#38bdf8',
          ],
          'circle-opacity': 0.45,
          'circle-blur': 0.85,
        },
      })

      // Telemetry Sensors Core Layer
      map.addLayer({
        id: 'sensors-layer',
        type: 'circle',
        source: 'nodes-source',
        filter: ['all', ['==', ['get', 'type'], 'junction'], ['==', ['get', 'is_sensor'], true]],
        paint: {
          'circle-radius': 6.5,
          'circle-color': [
            'case',
            ['get', 'is_leak'],
            '#ef4444',
            ['match', ['get', 'status'], 'CRITICAL', '#ef4444', 'WARNING', '#f59e0b', '#38bdf8'],
          ],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#071116',
          'circle-opacity': 0.95,
        },
      })

      // Tanks and Reservoirs
      map.addLayer({
        id: 'tanks-layer',
        type: 'circle',
        source: 'nodes-source',
        filter: ['in', ['get', 'type'], ['literal', ['tank', 'reservoir']]],
        paint: {
          'circle-radius': 9,
          'circle-color': '#06b6d4',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#164e63',
          'circle-opacity': 0.95,
        },
      })

      // Sewer Conduits Source & Layer
      map.addSource('sewer-conduits-source', {
        type: 'geojson',
        data: sewerConduitsGeoJSON,
      })
      map.addLayer({
        id: 'sewer-conduits-layer',
        type: 'line',
        source: 'sewer-conduits-source',
        paint: {
          'line-width': 3.8,
          'line-color': '#a855f7',
          'line-dasharray': [2, 1],
          'line-opacity': 0.85,
        },
      })

      // Sewer Manholes Source & Layers
      map.addSource('sewer-manholes-source', {
        type: 'geojson',
        data: sewerManholesGeoJSON,
      })
      map.addLayer({
        id: 'sewer-manholes-glow',
        type: 'circle',
        source: 'sewer-manholes-source',
        paint: {
          'circle-radius': 13,
          'circle-color': ['get', 'risk_color'],
          'circle-opacity': 0.35,
          'circle-blur': 0.8,
        },
      })
      map.addLayer({
        id: 'sewer-manholes-layer',
        type: 'circle',
        source: 'sewer-manholes-source',
        paint: {
          'circle-radius': 6.5,
          'circle-color': ['get', 'risk_color'],
          'circle-stroke-width': 2.2,
          'circle-stroke-color': '#1e1b4b',
          'circle-opacity': 0.95,
        },
      })

      // Interactivity
      map.on('mouseenter', 'sewer-manholes-layer', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'sewer-manholes-layer', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('mouseenter', 'junctions-layer', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'junctions-layer', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('mouseenter', 'sensors-layer', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'sensors-layer', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('mouseenter', 'tanks-layer', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'tanks-layer', () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('click', 'junctions-layer', (e: maplibregl.MapLayerMouseEvent) => {
        if (!e.features || !e.features[0] || !e.features[0].properties) return
        const id = String(e.features[0].properties.id)
        setInspectedNodeId(id)
        onSelectNode(id)
      })

      map.on('click', 'sensors-layer', (e: maplibregl.MapLayerMouseEvent) => {
        if (!e.features || !e.features[0] || !e.features[0].properties) return
        const id = String(e.features[0].properties.id)
        setInspectedNodeId(id)
        onSelectNode(id)
      })

      map.on('click', 'tanks-layer', (e: maplibregl.MapLayerMouseEvent) => {
        if (!e.features || !e.features[0] || !e.features[0].properties) return
        const id = String(e.features[0].properties.id)
        setInspectedNodeId(id)
        onSelectNode(id)
      })
    })

    map.on('error', (e: { error?: { message?: string } }) => {
      if (e.error && e.error.message && !e.error.message.includes('404')) {
        setMapError('3D map loaded with fallback dark style.')
      }
    })

    return () => {
      if (orbitAnimationRef.current) cancelAnimationFrame(orbitAnimationRef.current)
      if (timelineIntervalRef.current) clearInterval(timelineIntervalRef.current)
      if (pulseMarkerRef.current) pulseMarkerRef.current.remove()
      suspectMarkersRef.current.forEach((m) => m.remove())
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Sync GeoJSON sources
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return

    const pipelineSource = mapRef.current.getSource('pipelines-source') as maplibregl.GeoJSONSource | undefined
    if (pipelineSource) {
      pipelineSource.setData(pipelinesGeoJSON)
    }

    const nodeSource = mapRef.current.getSource('nodes-source') as maplibregl.GeoJSONSource | undefined
    if (nodeSource) {
      nodeSource.setData(nodesGeoJSON)
    }

    const sewerCSource = mapRef.current.getSource('sewer-conduits-source') as maplibregl.GeoJSONSource | undefined
    if (sewerCSource) {
      sewerCSource.setData(sewerConduitsGeoJSON)
    }

    const sewerMHSource = mapRef.current.getSource('sewer-manholes-source') as maplibregl.GeoJSONSource | undefined
    if (sewerMHSource) {
      sewerMHSource.setData(sewerManholesGeoJSON)
    }
  }, [pipelinesGeoJSON, nodesGeoJSON, sewerConduitsGeoJSON, sewerManholesGeoJSON, mapLoaded])

  // Active Leak Pulsing Ring Marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return

    if (pulseMarkerRef.current) {
      pulseMarkerRef.current.remove()
      pulseMarkerRef.current = null
    }

    const leakNodeId = state?.active_leak?.node_id
    if (!leakNodeId) return

    const node = nodeLookup.get(leakNodeId)
    if (!node || !node.lat_lng) return

    const el = document.createElement('div')
    el.className = 'leak-pulse-container'
    el.innerHTML = `
      <div class="leak-pulse-wave leak-pulse-wave--3"></div>
      <div class="leak-pulse-wave leak-pulse-wave--2"></div>
      <div class="leak-pulse-wave leak-pulse-wave--1"></div>
      <div class="leak-pulse-core"></div>
      <div class="leak-pulse-label">BURST #${node.id}</div>
    `

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([node.lat_lng[1], node.lat_lng[0]])
      .addTo(mapRef.current)

    pulseMarkerRef.current = marker
  }, [state?.active_leak, nodeLookup, mapLoaded])

  // Contamination Source Pulsing Marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return

    if (contamPulseMarkerRef.current) {
      contamPulseMarkerRef.current.remove()
      contamPulseMarkerRef.current = null
    }

    const sourceNodeId = waterQualityData?.likely_source_nodes?.[0]?.node_id
    if (!sourceNodeId || waterQualityData?.status === 'NORMAL') return

    const node = nodeLookup.get(sourceNodeId)
    if (!node || !node.lat_lng) return

    const el = document.createElement('div')
    el.className = 'contam-pulse-container'
    el.innerHTML = `
      <div class="contam-pulse-wave contam-pulse-wave--2"></div>
      <div class="contam-pulse-wave contam-pulse-wave--1"></div>
      <div class="contam-pulse-core"></div>
      <div class="contam-pulse-label">BIO-RISK #${node.id}</div>
    `

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([node.lat_lng[1], node.lat_lng[0]])
      .addTo(mapRef.current)

    contamPulseMarkerRef.current = marker
  }, [waterQualityData, nodeLookup, mapLoaded])

  // Top-3 Suspect Badges
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return

    suspectMarkersRef.current.forEach((m) => m.remove())
    suspectMarkersRef.current = []

    if (!detection || !detection.leak_detected || detection.top_suspects.length === 0) return

    detection.top_suspects.forEach((suspect) => {
      const node = nodeLookup.get(suspect.node_id)
      if (!node || !node.lat_lng) return

      const el = document.createElement('div')
      el.className = `suspect-pin-marker suspect-pin--rank${suspect.rank}`
      el.innerHTML = `
        <div class="suspect-pin-badge">#${suspect.rank}</div>
        <div class="suspect-pin-tag">J-${suspect.node_id} (${(suspect.probability * 100).toFixed(0)}%)</div>
      `
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onSelectNode(suspect.node_id)
        setInspectedNodeId(suspect.node_id)
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([node.lat_lng[1], node.lat_lng[0]])
        .addTo(mapRef.current!)

      suspectMarkersRef.current.push(marker)
    })
  }, [detection, nodeLookup, onSelectNode, mapLoaded])

  // Layer filters
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return
    const map = mapRef.current

    if (map.getLayer('pipelines-core')) {
      const v = layerFilters.pipelines ? 'visible' : 'none'
      map.setLayoutProperty('pipelines-core', 'visibility', v)
      map.setLayoutProperty('pipelines-glow', 'visibility', v)
      map.setLayoutProperty('pipelines-casing', 'visibility', v)
    }
    if (map.getLayer('junctions-layer')) {
      map.setLayoutProperty('junctions-layer', 'visibility', layerFilters.junctions ? 'visible' : 'none')
    }
    if (map.getLayer('sensors-layer')) {
      map.setLayoutProperty('sensors-layer', 'visibility', layerFilters.sensors ? 'visible' : 'none')
    }
    if (map.getLayer('sensors-glow-layer')) {
      map.setLayoutProperty('sensors-glow-layer', 'visibility', layerFilters.sensors ? 'visible' : 'none')
    }
    if (map.getLayer('tanks-layer')) {
      map.setLayoutProperty('tanks-layer', 'visibility', layerFilters.tanks ? 'visible' : 'none')
    }
    if (map.getLayer('3d-buildings')) {
      map.setLayoutProperty('3d-buildings', 'visibility', layerFilters.buildings ? 'visible' : 'none')
    }
    if (map.getLayer('sewer-conduits-layer')) {
      map.setLayoutProperty('sewer-conduits-layer', 'visibility', layerFilters.sewerLayer ? 'visible' : 'none')
    }
    if (map.getLayer('sewer-manholes-layer')) {
      map.setLayoutProperty('sewer-manholes-layer', 'visibility', layerFilters.sewerLayer ? 'visible' : 'none')
      map.setLayoutProperty('sewer-manholes-glow', 'visibility', layerFilters.sewerLayer ? 'visible' : 'none')
    }
    if (pulseMarkerRef.current) {
      pulseMarkerRef.current.getElement().style.display = layerFilters.leaks ? 'block' : 'none'
    }
    if (contamPulseMarkerRef.current) {
      contamPulseMarkerRef.current.getElement().style.display = layerFilters.waterQuality ? 'block' : 'none'
    }
    suspectMarkersRef.current.forEach((m) => {
      m.getElement().style.display = layerFilters.leaks ? 'block' : 'none'
    })
  }, [layerFilters, mapLoaded])

  // Camera Actions
  const handleZoomIn = () => mapRef.current?.zoomIn({ duration: 400 })
  const handleZoomOut = () => mapRef.current?.zoomOut({ duration: 400 })

  const handleToggleTilt = () => {
    if (!mapRef.current) return
    const next3D = !is3DMode
    setIs3DMode(next3D)
    mapRef.current.easeTo({
      pitch: next3D ? 60 : 0,
      duration: 800,
    })
  }

  const handleRotate = (deg: number) => {
    if (!mapRef.current) return
    const currentBearing = mapRef.current.getBearing()
    mapRef.current.easeTo({
      bearing: currentBearing + deg,
      duration: 600,
    })
  }

  const handleResetCamera = useCallback(() => {
    if (!mapRef.current || !bounds) return
    mapRef.current.flyTo({
      center: [bounds.centerLng, bounds.centerLat],
      zoom: 14.1,
      pitch: 58,
      bearing: -22,
      duration: 1200,
      essential: true,
    })
  }, [bounds])

  const toggleOrbit = () => {
    if (isOrbiting) {
      if (orbitAnimationRef.current) cancelAnimationFrame(orbitAnimationRef.current)
      setIsOrbiting(false)
    } else {
      setIsOrbiting(true)
      const rotateCamera = () => {
        if (!mapRef.current) return
        mapRef.current.setBearing(mapRef.current.getBearing() + 0.12)
        orbitAnimationRef.current = requestAnimationFrame(rotateCamera)
      }
      rotateCamera()
    }
  }

  // Timeline playback simulation
  useEffect(() => {
    if (isPlayingTimeline) {
      timelineIntervalRef.current = window.setInterval(() => {
        setTimelineHour((prev) => {
          if (prev >= 6.0) return 0.5
          return Math.round((prev + 0.5) * 10) / 10
        })
      }, 900)
    } else if (timelineIntervalRef.current) {
      clearInterval(timelineIntervalRef.current)
    }
    return () => {
      if (timelineIntervalRef.current) clearInterval(timelineIntervalRef.current)
    }
  }, [isPlayingTimeline])

  // Fly to selected node
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !selectedNode) return
    const node = nodeLookup.get(selectedNode)
    if (node && node.lat_lng) {
      mapRef.current.flyTo({
        center: [node.lat_lng[1], node.lat_lng[0]],
        zoom: 15.5,
        duration: 900,
      })
    }
  }, [selectedNode, nodeLookup, mapLoaded])

  const inspectedNode = useMemo(() => {
    const id = inspectedNodeId || selectedNode
    if (!id) return null
    const n = nodeLookup.get(id)
    const s = sensorMap.get(id)
    const suspect = suspectMap.get(id)
    return { node: n, sensor: s, suspect }
  }, [inspectedNodeId, selectedNode, nodeLookup, sensorMap, suspectMap])

  return (
    <div className={`map3d-wrapper ${isFullScreen ? 'map3d-wrapper--fullscreen' : ''}`}>
      <div ref={mapContainerRef} className="map3d-canvas" />

      {!mapLoaded && (
        <div className="map3d-loading-overlay">
          <div className="map3d-spinner" />
          <span>INITIALIZING 3D HYDRAULIC TWIN & TERRAIN...</span>
        </div>
      )}

      {/* Floating HUD: Top Header Info */}
      <div className="map3d-hud map3d-hud--top-left">
        <div className="hud-badge-strip">
          <span className="hud-pill hud-pill--cyan">
            <span className="hud-live-dot" /> 3D WATER NETWORK
          </span>
          <span className="hud-pill">EPANET NET3</span>
          {MAPTILER_KEY ? (
            <span className="hud-pill hud-pill--maptiler">MAPTILER DARK 3D</span>
          ) : (
            <span className="hud-pill hud-pill--carto">DARK MATTER VECTOR</span>
          )}
          {mapError && <span className="hud-pill hud-pill--alert">{mapError}</span>}
          {state?.is_leak_injected && (
            <span className="hud-pill hud-pill--alert">
              ⚠️ LEAK AT JUNCTION {state.active_leak?.node_id}
            </span>
          )}
        </div>
      </div>

      {/* Floating HUD: Top Right Actions */}
      <div className="map3d-hud map3d-hud--top-right">
        {onToggleFullScreen && (
          <button
            type="button"
            className="hud-icon-btn"
            onClick={onToggleFullScreen}
            title={isFullScreen ? 'Exit Full Screen' : 'Enter Full Screen 3D View'}
          >
            {isFullScreen ? '↙ Minimize' : '↗ Full Screen'}
          </button>
        )}
      </div>

      {/* Floating HUD: Camera 3D Navigation Controls */}
      <div className="map3d-hud map3d-hud--nav-controls">
        <button type="button" className="nav-ctrl-btn" onClick={handleZoomIn} title="Zoom In">
          +
        </button>
        <button type="button" className="nav-ctrl-btn" onClick={handleZoomOut} title="Zoom Out">
          −
        </button>
        <button
          type="button"
          className={`nav-ctrl-btn ${is3DMode ? 'nav-ctrl-btn--active' : ''}`}
          onClick={handleToggleTilt}
          title="Toggle 3D Perspective Tilt (60° / 0°)"
        >
          {is3DMode ? '3D' : '2D'}
        </button>
        <button type="button" className="nav-ctrl-btn" onClick={() => handleRotate(-45)} title="Rotate Left">
          ↺
        </button>
        <button type="button" className="nav-ctrl-btn" onClick={() => handleRotate(45)} title="Rotate Right">
          ↻
        </button>
        <button
          type="button"
          className={`nav-ctrl-btn ${isOrbiting ? 'nav-ctrl-btn--active' : ''}`}
          onClick={toggleOrbit}
          title="Toggle Cinematic Orbit Camera"
        >
          🌐
        </button>
        <button type="button" className="nav-ctrl-btn" onClick={handleResetCamera} title="Reset Camera Center">
          🎯
        </button>
      </div>

      {/* Floating HUD: Layer Filters Panel */}
      <div className="map3d-hud map3d-hud--layers">
        <div className="hud-glass-panel">
          <div className="hud-panel-title">
            <span>NETWORK LAYERS</span>
          </div>
          <div className="layer-toggle-list">
            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.pipelines}
                onChange={(e) => setLayerFilters((p) => ({ ...p, pipelines: e.target.checked }))}
              />
              <span className="layer-legend-bar" style={{ background: '#22c55e' }} />
              <span>Pipelines</span>
            </label>

            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.sensors}
                onChange={(e) => setLayerFilters((p) => ({ ...p, sensors: e.target.checked }))}
              />
              <span className="layer-legend-dot" style={{ background: '#38bdf8' }} />
              <span>Telemetry Sensors</span>
            </label>

            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.junctions}
                onChange={(e) => setLayerFilters((p) => ({ ...p, junctions: e.target.checked }))}
              />
              <span className="layer-legend-dot" style={{ background: '#64748b' }} />
              <span>Junctions</span>
            </label>

            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.tanks}
                onChange={(e) => setLayerFilters((p) => ({ ...p, tanks: e.target.checked }))}
              />
              <span className="layer-legend-dot" style={{ background: '#06b6d4' }} />
              <span>Tanks & Reservoirs</span>
            </label>

            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.leaks}
                onChange={(e) => setLayerFilters((p) => ({ ...p, leaks: e.target.checked }))}
              />
              <span className="layer-legend-dot" style={{ background: '#ef4444' }} />
              <span>Leaks & Suspects</span>
            </label>

            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.buildings}
                onChange={(e) => setLayerFilters((p) => ({ ...p, buildings: e.target.checked }))}
              />
              <span className="layer-legend-dot" style={{ background: '#334155' }} />
              <span>3D City Buildings</span>
            </label>

            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.waterQuality}
                onChange={(e) => setLayerFilters((p) => ({ ...p, waterQuality: e.target.checked }))}
              />
              <span className="layer-legend-dot" style={{ background: '#f59e0b' }} />
              <span>🧪 Water Quality Layer</span>
            </label>

            <label className="layer-checkbox">
              <input
                type="checkbox"
                checked={layerFilters.sewerLayer}
                onChange={(e) => setLayerFilters((p) => ({ ...p, sewerLayer: e.target.checked }))}
              />
              <span className="layer-legend-bar" style={{ background: '#a855f7' }} />
              <span>🌧️ Sewer & Drainage Layer</span>
            </label>
          </div>
        </div>
      </div>

      {/* Floating HUD: Suspect Quick Navigation */}
      {detection?.leak_detected && detection.top_suspects.length > 0 && (
        <div className="map3d-hud map3d-hud--suspects">
          <div className="hud-glass-panel">
            <div className="hud-panel-title">
              <span style={{ color: '#f59e0b' }}>⚠️ TOP-3 SUSPECT LOCATIONS</span>
            </div>
            <div className="suspect-quick-list">
              {detection.top_suspects.map((s) => (
                <button
                  type="button"
                  key={s.node_id}
                  className={`suspect-quick-btn ${selectedNode === s.node_id ? 'is-active' : ''}`}
                  onClick={() => {
                    onSelectNode(s.node_id)
                    setInspectedNodeId(s.node_id)
                  }}
                >
                  <span className="suspect-rank-num">#{s.rank}</span>
                  <span>Junction {s.node_id}</span>
                  <strong>{(s.probability * 100).toFixed(0)}%</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating HUD: Timeline Scrubber */}
      <div className="map3d-hud map3d-hud--bottom-center">
        <div className="hud-timeline-panel">
          <div className="timeline-header">
            <div className="timeline-title">
              <span className="timeline-pulse-dot" />
              <span>SIMULATION TIMELINE</span>
            </div>
            <div className="timeline-time-display">
              Hour <strong>{timelineHour.toFixed(1)}</strong> of 6.0 hr window
            </div>
          </div>

          <div className="timeline-controls-row">
            <button
              type="button"
              className="timeline-play-btn"
              onClick={() => setIsPlayingTimeline((p) => !p)}
              title={isPlayingTimeline ? 'Pause playback' : 'Play simulation timeline'}
            >
              {isPlayingTimeline ? '❚❚' : '▶'}
            </button>

            <div className="timeline-slider-wrap">
              <input
                type="range"
                min="0.0"
                max="6.0"
                step="0.5"
                value={timelineHour}
                onChange={(e) => setTimelineHour(Number(e.target.value))}
                className="timeline-slider"
              />
              <div className="timeline-ticks">
                <span>0h Baseline</span>
                <span>1h</span>
                <span>2h Injection</span>
                <span>3h Wave</span>
                <span>4h Deficit</span>
                <span>5h</span>
                <span>6h End</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating HUD: Inspected Node Glassmorphism Card */}
      {inspectedNode?.node && (
        <div className="map3d-hud map3d-hud--bottom-right">
          <div className="hud-glass-card">
            <div className="card-top">
              <div>
                <span className="card-eyebrow">
                  {inspectedNode.node.type.toUpperCase()} ·{' '}
                  {inspectedNode.sensor ? 'MONITOR' : 'DISTRIBUTION POINT'}
                </span>
                <h3 className="card-title">Junction {inspectedNode.node.id}</h3>
              </div>
              <button
                type="button"
                className="card-close"
                onClick={() => setInspectedNodeId(null)}
                title="Dismiss inspector"
              >
                ×
              </button>
            </div>

            <div className="card-stats-grid">
              <div className="card-stat">
                <span className="card-stat-label">ELEVATION</span>
                <strong className="card-stat-val">{inspectedNode.node.elevation ?? 0} m</strong>
              </div>
              <div className="card-stat">
                <span className="card-stat-label">BASE DEMAND</span>
                <strong className="card-stat-val">
                  {(((inspectedNode.node.base_demand ?? 0) * 3600) || 0).toFixed(1)} m³/h
                </strong>
              </div>

              {inspectedNode.sensor && (
                <>
                  <div className="card-stat">
                    <span className="card-stat-label">CURRENT HEAD</span>
                    <strong className="card-stat-val">
                      {inspectedNode.sensor.current_pressure_m.toFixed(2)} m
                    </strong>
                  </div>
                  <div className="card-stat">
                    <span className="card-stat-label">PRESSURE DEFICIT</span>
                    <strong
                      className={`card-stat-val ${
                        inspectedNode.sensor.pressure_drop_m > 0.8 ? 'is-alert' : ''
                      }`}
                    >
                      +{inspectedNode.sensor.pressure_drop_m.toFixed(2)} m
                    </strong>
                  </div>
                </>
              )}

              {inspectedNode.suspect && (
                <div className="card-stat card-stat--full" style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                  <span className="card-stat-label" style={{ color: '#f59e0b' }}>
                    ML LOCALIZATION SUSPECT #{inspectedNode.suspect.rank}
                  </span>
                  <strong className="card-stat-val" style={{ color: '#fbbf24' }}>
                    {(inspectedNode.suspect.probability * 100).toFixed(1)}% Confidence
                  </strong>
                </div>
              )}
            </div>

            <div className="card-actions">
              {onInjectAtNode && (
                <button
                  type="button"
                  className="card-action-btn card-action-btn--primary"
                  onClick={() => onInjectAtNode(inspectedNode.node!.id)}
                >
                  Inject Leak Here
                </button>
              )}
              {onSwitchToWhatIf && (
                <button
                  type="button"
                  className="card-action-btn card-action-btn--secondary"
                  onClick={() => onSwitchToWhatIf('111')}
                >
                  Isolate Pipe
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Network3DMap
