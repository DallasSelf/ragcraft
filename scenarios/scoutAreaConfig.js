const { FACILITY_POINTS, FACILITY_BOUNDS, FACILITY_CENTER, FACILITY_RADIUS } = require('./facilityLayout')

const DEFAULT_SCOUT_CONFIG = Object.freeze({
  scenarioId: 'scout_area_v1',
  center: { ...FACILITY_CENTER },
  radius: FACILITY_RADIUS,
  scanRadius: 7,
  maxSteps: 28,
  gridStep: 3,
  spawnPosition: { ...FACILITY_POINTS.leverRoomCenter },
  cornerA: { ...FACILITY_BOUNDS.cornerA },
  cornerB: { ...FACILITY_BOUNDS.cornerB },
  priorityWaypoints: [
    FACILITY_POINTS.mazeEntranceDoor,
    FACILITY_POINTS.captiveDoorBase,
    FACILITY_POINTS.supplyRoomDoor,
    FACILITY_POINTS.captiveChest
  ].map(point => ({ ...point })),
  navigationTimeoutMs: 14000
})

function toPoint(value, fallback = { x: 0, y: 64, z: 0 }) {
  if (!value || typeof value !== 'object') return { ...fallback }
  return {
    x: Number.isFinite(value.x) ? value.x : fallback.x,
    y: Number.isFinite(value.y) ? value.y : fallback.y,
    z: Number.isFinite(value.z) ? value.z : fallback.z
  }
}

function resolveNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function computeBounds(params) {
  if (params.cornerA && params.cornerB) {
    const a = toPoint(params.cornerA)
    const b = toPoint(params.cornerB)
    return {
      min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
      max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) }
    }
  }

  const center = toPoint(params.center, DEFAULT_SCOUT_CONFIG.center)
  const radius = resolveNumber(params.radius, DEFAULT_SCOUT_CONFIG.radius)
  return {
    min: {
      x: Math.floor(center.x - radius),
      y: Math.floor(center.y - 1),
      z: Math.floor(center.z - radius)
    },
    max: {
      x: Math.ceil(center.x + radius),
      y: Math.ceil(center.y + 1),
      z: Math.ceil(center.z + radius)
    }
  }
}

function normalizeWaypointArray(values, fallbackY) {
  if (!Array.isArray(values)) return []
  const defaultFallback = Number.isFinite(fallbackY) ? fallbackY : DEFAULT_SCOUT_CONFIG.center.y
  return values
    .map(value => toPoint(value, { x: 0, y: defaultFallback, z: 0 }))
    .map(point => ({
      x: Math.round(point.x),
      y: Number.isFinite(point.y) ? point.y : defaultFallback,
      z: Math.round(point.z)
    }))
}

function resolveScoutAreaConfig(overrides = {}) {
  const boundsInput = overrides.bounds || {}
  const merged = {
    ...DEFAULT_SCOUT_CONFIG,
    ...overrides,
    center: overrides.center || boundsInput.center || DEFAULT_SCOUT_CONFIG.center,
    radius: overrides.radius ?? overrides.boundRadius ?? DEFAULT_SCOUT_CONFIG.radius,
    scanRadius: overrides.scanRadius ?? overrides.scan_radius ?? DEFAULT_SCOUT_CONFIG.scanRadius,
    maxSteps: overrides.maxSteps ?? overrides.max_steps ?? DEFAULT_SCOUT_CONFIG.maxSteps,
    gridStep: overrides.gridStep ?? overrides.grid_step ?? DEFAULT_SCOUT_CONFIG.gridStep,
    spawnPosition: overrides.spawnPosition || DEFAULT_SCOUT_CONFIG.spawnPosition,
    cornerA: overrides.cornerA || boundsInput.cornerA,
    cornerB: overrides.cornerB || boundsInput.cornerB,
    priorityWaypoints: overrides.priorityWaypoints || DEFAULT_SCOUT_CONFIG.priorityWaypoints,
    navigationTimeoutMs: overrides.navigationTimeoutMs ?? DEFAULT_SCOUT_CONFIG.navigationTimeoutMs
  }

  const center = toPoint(merged.center, DEFAULT_SCOUT_CONFIG.center)
  const spawnPosition = toPoint(merged.spawnPosition, center)
  const radius = resolveNumber(merged.radius, DEFAULT_SCOUT_CONFIG.radius)
  const scanRadius = Math.max(2, resolveNumber(merged.scanRadius, DEFAULT_SCOUT_CONFIG.scanRadius))
  const maxSteps = Math.max(1, Math.floor(resolveNumber(merged.maxSteps, DEFAULT_SCOUT_CONFIG.maxSteps)))
  const gridStep = Math.max(2, Math.floor(resolveNumber(merged.gridStep, DEFAULT_SCOUT_CONFIG.gridStep)))
  const navigationTimeoutMs = Math.max(4000, resolveNumber(merged.navigationTimeoutMs, DEFAULT_SCOUT_CONFIG.navigationTimeoutMs))
  const resolvedCornerA = merged.cornerA || DEFAULT_SCOUT_CONFIG.cornerA
  const resolvedCornerB = merged.cornerB || DEFAULT_SCOUT_CONFIG.cornerB

  const bounds = computeBounds({
    center,
    radius,
    cornerA: resolvedCornerA,
    cornerB: resolvedCornerB
  })
  const priorityWaypoints = normalizeWaypointArray(merged.priorityWaypoints, center.y)


  return {
    scenarioId: DEFAULT_SCOUT_CONFIG.scenarioId,
    center,
    radius,
    scanRadius,
    maxSteps,
    gridStep,
    spawnPosition,
    bounds,
    navigationTimeoutMs,
    priorityWaypoints
  }
}

module.exports = {
  DEFAULT_SCOUT_CONFIG,
  resolveScoutAreaConfig
}
