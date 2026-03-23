const { v4: uuidv4 } = require('uuid')
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { resolveScoutAreaConfig } = require('../scenarios/scoutAreaConfig')
const { debugLog } = require('../logging/debugFlags')
const { HAZARD_BLOCK_TAGS, DEFAULT_HAZARD_RADIUS, SAFE_PATH_BUFFER_RADIUS } = require('./constants/hazards')
const { resolveMemoryMode } = require('./memoryModes')
const { ragRetrieveHybrid } = require('../rag/retrieval')
const { retrieveDistilledMemories } = require('../rag/distilledMemory')

const LANDMARK_KEYS = ['beacon', 'bell', 'lodestone', 'campfire', 'fountain', 'portal']
const INTERACTABLE_KEYS = ['lever', 'button', 'pressure_plate', 'tripwire']
const TOOL_BLOCKS = ['crafting_table', 'smithing_table', 'anvil', 'grindstone', 'loom', 'cartography_table', 'stonecutter', 'brewing_stand', 'enchanting_table']
const SUPPLY_BLOCK_KEYS = ['chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box']
const FRAME_ENTITY_TYPES = ['item_frame', 'glow_item_frame']
const DOOR_KEYS = ['door', 'fence_gate', 'trapdoor']
const SAFE_PATH_MIN_DISTANCE = 2
const DETOUR_PRIMARY_RADII = [2, 4, 6]
const DETOUR_ESCAPE_RADII = [1, 2, 3]
const SLIDE_DISTANCES = [1, 2, 3]
const SLIDE_MAX_ITERATIONS = 4
const SLIDE_TIMEOUT_MIN_MS = 1800
const STAGNATION_FAILURE_LIMIT = 6
const SCOUT_MIN_COVERAGE_SUCCESS = 0.35
const SCOUT_MIN_WAYPOINT_SUCCESS = 0.3
const MAX_RESOLVED_WAYPOINT_DRIFT = 2
const DEADZONE_BLOCK_RADIUS = 2
const MAX_ROUTE_SEEDS_CONTROL = 5
const MAX_ROUTE_SEED_DISTANCE = 20
const DEFAULT_PRODUCTIVE_REGION_RADIUS = 5
const MAX_DEADZONE_TOTAL_PENALTY = 1.1
const DETOUR_OFFSETS = Object.freeze([
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
  { x: 1, z: 1 },
  { x: -1, z: 1 },
  { x: 1, z: -1 },
  { x: -1, z: -1 }
])

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function quantize(pos) {
  return {
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    z: Math.round(pos.z)
  }
}

function cellKey(pos) {
  return `${Math.round(pos.x)}:${Math.round(pos.z)}`
}

function distance2D(a, b) {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function distance3D(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function countVisitedNeighbors(target, visited, gridStep) {
  let count = 0
  const radius = gridStep * 1.5
  visited.forEach(key => {
    const [x, z] = key.split(':').map(Number)
    const dx = x - target.x
    const dz = z - target.z
    if ((dx * dx + dz * dz) <= radius * radius) {
      count += 1
    }
  })
  return count
}

function buildWaypointGrid(bounds, step, center) {
  const waypoints = []
  const minX = Math.floor(bounds.min.x) + 1
  const maxX = Math.ceil(bounds.max.x) - 1
  const minZ = Math.floor(bounds.min.z) + 1
  const maxZ = Math.ceil(bounds.max.z) - 1
  for (let x = minX; x <= maxX; x += step) {
    for (let z = minZ; z <= maxZ; z += step) {
      waypoints.push({ x, y: center.y, z })
    }
  }
  waypoints.push({ x: center.x, y: center.y, z: center.z })
  return waypoints
}

function isNearDeadzone(point, deadzones = []) {
  for (const zone of deadzones) {
    if (distance2D(point, zone) <= DEADZONE_BLOCK_RADIUS) {
      return true
    }
  }
  return false
}

function memoryBiasForWaypoint(point, memoryBias = null, guidanceRegion = null) {
  if (!memoryBias) return 0
  let score = 0
  let deadzonePenalty = 0

  for (const hazard of memoryBias.hazards || []) {
    const dist = distance2D(point, hazard)
    if (dist <= 4) score -= 1.6
    else if (dist <= 7) score -= 0.7
  }

  for (const route of memoryBias.routes || []) {
    const dist = distance2D(point, route)
    if (dist <= 3) score += 1.2
    else if (dist <= 6) score += 0.45
  }

  for (const frontier of memoryBias.productiveFrontiers || []) {
    const dist = distance2D(point, frontier)
    if (dist <= 3) score += 1.8
    else if (dist <= 7) score += 0.7
  }

  for (const region of memoryBias.productiveRegions || []) {
    if (!region || !region.center) continue
    const radius = Number.isFinite(region.radius) ? region.radius : DEFAULT_PRODUCTIVE_REGION_RADIUS
    const dist = distance2D(point, region.center)
    if (dist <= radius) score += 1.6
    else if (dist <= radius + 3) score += 0.5
  }

  if (guidanceRegion && guidanceRegion.center) {
    const radius = Number.isFinite(guidanceRegion.radius) ? guidanceRegion.radius : DEFAULT_PRODUCTIVE_REGION_RADIUS
    const dist = distance2D(point, guidanceRegion.center)
    if (dist <= radius) score += 2.2
    else if (dist <= radius + 2) score += 0.8
  }

  for (const deadzone of memoryBias.deadzones || []) {
    const dist = distance2D(point, deadzone)
    if (dist <= DEADZONE_BLOCK_RADIUS) deadzonePenalty -= 0.9
    else if (dist <= 5) deadzonePenalty -= 0.35
  }

  score += Math.max(-MAX_DEADZONE_TOTAL_PENALTY, deadzonePenalty)

  return score
}

function chooseNextWaypoint(current, waypoints, visited, gridStep, jitter = 0, memoryBias = null, telemetry = null, guidanceRegion = null, excluded = null) {
  const candidates = waypoints.filter(point => {
    const key = cellKey(point)
    if (visited.has(key)) return false
    if (excluded && excluded.has(key)) return false
    return true
  })
  if (candidates.length === 0) return null

  let best = null
  for (const point of candidates) {
    if (memoryBias && isNearDeadzone(point, memoryBias.deadzones || []) && telemetry) {
      telemetry.deadzoneAvoidSkips = (telemetry.deadzoneAvoidSkips || 0) + 1
    }
    const novelty = 1 / (1 + countVisitedNeighbors(point, visited, gridStep))
    const dist = distance2D(current, point)
    const randomness = jitter > 0 ? (Math.random() - 0.5) * jitter : 0
    const memoryBiasScore = memoryBiasForWaypoint(point, memoryBias, guidanceRegion)
    const score = novelty * 2 - dist * 0.01 + randomness + memoryBiasScore
    if (!best || score > best.score) {
      best = { point, score }
    }
  }
  return best.point
}

function clampPointToBounds(point, bounds) {
  if (!bounds) return point
  return {
    x: Math.max(bounds.min.x, Math.min(bounds.max.x, point.x)),
    y: Math.max(bounds.min.y, Math.min(bounds.max.y, point.y)),
    z: Math.max(bounds.min.z, Math.min(bounds.max.z, point.z))
  }
}

function generateDetourCandidates(current, target, bounds) {
  const candidates = []
  const seen = new Set()

  function pushCandidate(basePoint) {
    if (!basePoint) return
    const snapped = {
      x: Math.round(basePoint.x),
      y: Math.round(basePoint.y),
      z: Math.round(basePoint.z)
    }
    const clamped = clampPointToBounds(snapped, bounds)
    const key = cellKey(clamped)
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(clamped)
  }

  if (current) {
    DETOUR_ESCAPE_RADII.forEach(radius => {
      DETOUR_OFFSETS.forEach(offset => {
        pushCandidate({
          x: current.x + offset.x * radius,
          y: current.y,
          z: current.z + offset.z * radius
        })
      })
    })
  }

  if (target) {
    DETOUR_PRIMARY_RADII.forEach(radius => {
      DETOUR_OFFSETS.forEach(offset => {
        pushCandidate({
          x: target.x + offset.x * radius,
          y: target.y,
          z: target.z + offset.z * radius
        })
      })
    })
  }

  if (current && target) {
    pushCandidate({
      x: (current.x + target.x) / 2,
      y: (current.y + target.y) / 2,
      z: (current.z + target.z) / 2
    })
  }

  return candidates
}

function deriveHeading(current, target) {
  if (!current || !target) {
    return { x: 1, z: 0 }
  }
  const dx = Math.sign(Math.round(target.x) - Math.round(current.x))
  const dz = Math.sign(Math.round(target.z) - Math.round(current.z))
  if (dx === 0 && dz === 0) {
    return { x: 1, z: 0 }
  }
  return { x: dx, z: dz }
}

function normalizeHeadingVector(vector) {
  const x = Math.sign(vector.x)
  const z = Math.sign(vector.z)
  if (x === 0 && z === 0) return null
  return { x, z }
}

function buildSlideOffsets(direction) {
  const forward = normalizeHeadingVector(direction)
  const left = normalizeHeadingVector({ x: -direction.z, z: direction.x })
  const right = normalizeHeadingVector({ x: direction.z, z: -direction.x })
  const back = normalizeHeadingVector({ x: -direction.x, z: -direction.z })
  const forwardLeft = forward && left ? normalizeHeadingVector({ x: forward.x + left.x, z: forward.z + left.z }) : null
  const forwardRight = forward && right ? normalizeHeadingVector({ x: forward.x + right.x, z: forward.z + right.z }) : null
  const bases = [
    { label: 'forward', vec: forward },
    { label: 'left', vec: left },
    { label: 'right', vec: right },
    { label: 'forward_left', vec: forwardLeft },
    { label: 'forward_right', vec: forwardRight },
    { label: 'back', vec: back }
  ].filter(entry => entry.vec)

  const offsets = []
  bases.forEach(entry => {
    SLIDE_DISTANCES.forEach(distance => {
      offsets.push({
        label: entry.label,
        x: entry.vec.x * distance,
        z: entry.vec.z * distance,
        distance
      })
    })
  })
  return offsets
}

async function teleportToStart(bot, logger, position) {
  if (!position) return
  const cmd = `/tp ${bot.username} ${position.x} ${position.y} ${position.z}`
  bot.chat(cmd)
  logger.log('scout_teleport_start', { cmd })
  await wait(200)
}

async function ensureSpawnReset(bot, logger, position, runId, phase = 'start') {
  if (!position) return true
  await teleportToStart(bot, logger, position)

  const firstDistance = distance3D(bot.entity.position, position)
  if (firstDistance <= 2.5) {
    return true
  }

  logger.log('scout_spawn_verification_retry', {
    runId,
    phase,
    expected: position,
    actual: quantize(bot.entity.position),
    distance: Number(firstDistance.toFixed(2))
  })

  await wait(150)
  await teleportToStart(bot, logger, position)
  const secondDistance = distance3D(bot.entity.position, position)
  const ok = secondDistance <= 2.5

  if (!ok) {
    logger.log('scout_spawn_verification_failed', {
      runId,
      phase,
      expected: position,
      actual: quantize(bot.entity.position),
      distance: Number(secondDistance.toFixed(2))
    })
  }

  return ok
}

function claimLocationFromMemory(memory) {
  if (!memory) return null
  const loc = Array.isArray(memory.entities?.location) ? memory.entities.location[0] : null
  if (!loc || !Number.isFinite(loc.x) || !Number.isFinite(loc.z)) return null
  return quantize(loc)
}

function buildScoutMemoryBias(memories = []) {
  const hazards = []
  const routes = []
  const deadzones = []
  const productiveFrontiers = []
  const productiveRegions = []

  for (const memory of memories) {
    const type = String(memory?.type || '').toLowerCase()
    const tags = Array.isArray(memory?.goal_tags)
      ? memory.goal_tags.map(t => String(t).toLowerCase())
      : []
    const loc = claimLocationFromMemory(memory)
    if (!loc) continue

    if (type.includes('hazard') || tags.includes('hazard')) {
      hazards.push(loc)
      continue
    }

    if (type.includes('deadzone') || tags.includes('deadzone')) {
      deadzones.push(loc)
      continue
    }

    if (type.includes('route') || type.includes('safepath') || tags.includes('route') || tags.includes('safe_path')) {
      extractRouteMemoryPoints(memory).forEach(point => routes.push(point))
      extractFrontierPoints(memory).forEach(point => productiveFrontiers.push(point))
      extractProductiveRegions(memory).forEach(region => productiveRegions.push(region))
      routes.push(loc)
    }
  }

  return {
    hazards,
    routes,
    deadzones,
    productiveFrontiers,
    productiveRegions,
    memoryCount: memories.length
  }
}

function extractProductiveRegions(memory) {
  const regions = []
  const raw = Array.isArray(memory?.metadata?.productiveRegions) ? memory.metadata.productiveRegions : []
  for (const region of raw) {
    if (!region || !region.center) continue
    const center = quantize(region.center)
    regions.push({
      center,
      radius: Number.isFinite(region.radius) ? Math.max(2, Math.round(region.radius)) : DEFAULT_PRODUCTIVE_REGION_RADIUS
    })
  }

  if (regions.length === 0) {
    const anchors = parseWaypointEntries(memory?.metadata?.anchors)
    const frontiers = Array.isArray(memory?.metadata?.frontiers) ? memory.metadata.frontiers : []
    for (const frontier of frontiers) {
      if (!frontier?.from || !frontier?.to) continue
      const center = quantize({
        x: (frontier.from.x + frontier.to.x) / 2,
        y: (frontier.from.y + frontier.to.y) / 2,
        z: (frontier.from.z + frontier.to.z) / 2
      })
      regions.push({ center, radius: DEFAULT_PRODUCTIVE_REGION_RADIUS })
    }
    for (let i = 0; i < anchors.length; i += 2) {
      regions.push({
        center: anchors[i],
        radius: DEFAULT_PRODUCTIVE_REGION_RADIUS
      })
    }
  }

  return dedupeRegions(regions)
}

function dedupeRegions(regions = []) {
  const out = []
  const seen = new Map()
  for (const region of regions) {
    if (!region || !region.center) continue
    const key = `${region.center.x}:${region.center.z}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, {
        center: region.center,
        radius: Number.isFinite(region.radius) ? region.radius : DEFAULT_PRODUCTIVE_REGION_RADIUS
      })
      continue
    }
    existing.radius = Math.max(existing.radius, region.radius || DEFAULT_PRODUCTIVE_REGION_RADIUS)
  }
  seen.forEach(region => out.push(region))
  return out
}

function selectReachableProductiveRegion(bot, currentPos, memoryBias = null) {
  if (!bot || !currentPos || !memoryBias) return null
  const regions = Array.isArray(memoryBias.productiveRegions) ? memoryBias.productiveRegions : []
  if (regions.length === 0) return null

  const sorted = regions
    .map(region => ({ region, dist: distance2D(currentPos, region.center) }))
    .sort((a, b) => a.dist - b.dist)

  for (const entry of sorted) {
    if (entry.dist > MAX_ROUTE_SEED_DISTANCE) continue
    const feasible = resolveFeasibleWaypoint(bot, entry.region.center, currentPos.y)
    if (!feasible) continue
    return {
      center: feasible,
      radius: entry.region.radius
    }
  }

  return null
}

function extractRouteMemoryPoints(memory) {
  const points = []
  parseWaypointEntries(memory?.metadata?.anchors).forEach(p => points.push(p))
  parseWaypointEntries(memory?.metadata?.waypoints).forEach(p => points.push(p))
  if (memory?.metadata?.start) points.push(quantize(memory.metadata.start))
  if (memory?.metadata?.end) points.push(quantize(memory.metadata.end))
  parseWaypointEntries(memory?.entities?.location).forEach(p => points.push(p))
  return dedupeSequential(points)
}

function extractFrontierPoints(memory) {
  const frontiers = Array.isArray(memory?.metadata?.frontiers) ? memory.metadata.frontiers : []
  const points = []
  for (const frontier of frontiers) {
    if (frontier?.to) points.push(quantize(frontier.to))
  }
  return dedupeSequential(points)
}

function isRouteLikeMemory(memory) {
  if (!memory) return false
  const type = String(memory.type || '').toLowerCase()
  if (type.includes('route') || type.includes('safepath')) return true
  const tags = Array.isArray(memory.goal_tags) ? memory.goal_tags.map(t => String(t).toLowerCase()) : []
  return tags.includes('route') || tags.includes('safe_path')
}

function isHazardLikeMemory(memory) {
  if (!memory) return false
  const type = String(memory.type || '').toLowerCase()
  if (type.includes('hazard')) return true
  const tags = Array.isArray(memory.goal_tags) ? memory.goal_tags.map(t => String(t).toLowerCase()) : []
  return tags.includes('hazard')
}

function isDeadzoneLikeMemory(memory) {
  if (!memory) return false
  const type = String(memory.type || '').toLowerCase()
  if (type.includes('deadzone')) return true
  const tags = Array.isArray(memory.goal_tags) ? memory.goal_tags.map(t => String(t).toLowerCase()) : []
  return tags.includes('deadzone')
}

function isSuccessfulRouteMemory(memory) {
  if (!memory) return false
  const type = String(memory.type || '').toLowerCase()
  if (type.includes('scoutroutememory') || type.includes('safepath') || type === 'routeclaim'.toLowerCase()) return true
  const tags = Array.isArray(memory.goal_tags) ? memory.goal_tags.map(t => String(t).toLowerCase()) : []
  return tags.includes('route_memory') || tags.includes('safe_path') || tags.includes('route')
}

function parseWaypointEntries(entries = []) {
  if (!Array.isArray(entries)) return []
  return entries
    .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.z))
    .map(quantize)
}

function extractRouteSeeds(memories = [], bounds, limit = 14) {
  const seeds = []
  const seen = new Set()

  const pushSeed = point => {
    if (!point) return
    const clamped = clampPointToBounds(quantize(point), bounds)
    const key = `${clamped.x}:${clamped.z}`
    if (seen.has(key)) return
    seen.add(key)
    seeds.push(clamped)
  }

  for (const memory of memories) {
    if (!isSuccessfulRouteMemory(memory)) continue
    const fromMeta = parseWaypointEntries(memory?.metadata?.anchors)
    fromMeta.forEach(pushSeed)

    const frontierPoints = extractFrontierPoints(memory)
    frontierPoints.forEach(pushSeed)

    const entitiesLoc = parseWaypointEntries(memory?.entities?.location)
    entitiesLoc.forEach(pushSeed)

    const start = memory?.metadata?.start
    const end = memory?.metadata?.end
    if (start) pushSeed(start)
    if (end) pushSeed(end)

    if (seeds.length >= limit) break
  }

  return seeds.slice(0, limit)
}

function rebalanceScoutMemories(memories, scenarioId, limit = 8) {
  const source = Array.isArray(memories) ? memories : []
  const routes = source.filter(isSuccessfulRouteMemory)
  const deadzones = source.filter(isDeadzoneLikeMemory)
  const hazards = source.filter(isHazardLikeMemory)
  const others = source.filter(m => !isSuccessfulRouteMemory(m) && !isDeadzoneLikeMemory(m) && !isHazardLikeMemory(m))

  const selected = []
  selected.push(...routes.slice(0, 5))
  selected.push(...deadzones.slice(0, 3))
  selected.push(...hazards.slice(0, 2))
  selected.push(...others.slice(0, 1))

  if (selected.filter(isSuccessfulRouteMemory).length === 0) {
    const fallbackRoutes = retrieveDistilledMemories(scenarioId)
      .filter(isSuccessfulRouteMemory)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 3)
    selected.push(...fallbackRoutes)
  }

  const unique = []
  const seen = new Set()
  for (const m of selected) {
    const key = String(m.id || `${m.type || 'memory'}:${m.timestamp || 0}`)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(m)
    if (unique.length >= limit) break
  }

  return unique
}

function buildSparseRouteAnchors(routeWaypoints = []) {
  if (!Array.isArray(routeWaypoints) || routeWaypoints.length <= 2) {
    return routeWaypoints
  }

  const anchors = [routeWaypoints[0]]
  let prevDir = null

  for (let i = 1; i < routeWaypoints.length; i += 1) {
    const prev = routeWaypoints[i - 1]
    const curr = routeWaypoints[i]
    const dir = {
      x: Math.sign(curr.x - prev.x),
      z: Math.sign(curr.z - prev.z)
    }
    const headingChanged = prevDir && (dir.x !== prevDir.x || dir.z !== prevDir.z)
    const intervalAnchor = i % 4 === 0
    if (headingChanged || intervalAnchor) {
      anchors.push(curr)
    }
    prevDir = dir
  }

  anchors.push(routeWaypoints[routeWaypoints.length - 1])
  return dedupeSequential(anchors)
}

function buildFrontierTransitions(anchors = []) {
  const transitions = []
  for (let i = 1; i < anchors.length; i += 1) {
    transitions.push({
      from: anchors[i - 1],
      to: anchors[i]
    })
  }
  return transitions
}

function buildProductiveRegions(anchors = [], frontiers = []) {
  const regions = []
  for (const anchor of anchors) {
    regions.push({ center: anchor, radius: DEFAULT_PRODUCTIVE_REGION_RADIUS })
  }
  for (const frontier of frontiers) {
    if (!frontier?.from || !frontier?.to) continue
    const center = quantize({
      x: (frontier.from.x + frontier.to.x) / 2,
      y: (frontier.from.y + frontier.to.y) / 2,
      z: (frontier.from.z + frontier.to.z) / 2
    })
    regions.push({ center, radius: DEFAULT_PRODUCTIVE_REGION_RADIUS + 1 })
  }
  return dedupeRegions(regions)
}

function resolveRouteSeedCandidate(bot, seed, currentPos) {
  if (!bot || !seed || !currentPos) return null
  const feasible = resolveFeasibleWaypoint(bot, seed, currentPos.y)
  if (!feasible) return null
  if (distance2D(feasible, seed) > MAX_RESOLVED_WAYPOINT_DRIFT) return null
  if (distance2D(currentPos, feasible) > MAX_ROUTE_SEED_DISTANCE) return null
  return feasible
}

async function gotoWithTimeout(bot, goal, timeoutMs) {
  try {
    const movePromise = bot.pathfinder.goto(goal)
    const outcome = await Promise.race([
      movePromise.then(() => 'arrived'),
      wait(timeoutMs).then(() => 'timeout')
    ])
    if (outcome === 'timeout') {
      bot.pathfinder.stop()
      return { success: false, reason: 'timeout' }
    }
    return { success: true }
  } catch (err) {
    bot.pathfinder.stop()
    return { success: false, reason: err?.message || 'navigation_error' }
  }
}

async function attemptWallSlide(bot, waypoint, timeoutMs, options = {}) {
  const { currentPos, bounds, logger, runId, stepIndex } = options
  if (!currentPos || !waypoint) {
    return { success: false, reason: 'slide_unavailable' }
  }

  let workingPos = { ...currentPos }
  let attempts = 0
  let lastReason = null
  let progressMade = false

  for (let iteration = 0; iteration < SLIDE_MAX_ITERATIONS; iteration += 1) {
    const direction = deriveHeading(workingPos, waypoint)
    const offsets = buildSlideOffsets(direction)
    let movedThisLoop = false

    for (const offset of offsets) {
      attempts += 1
      const candidate = clampPointToBounds({
        x: workingPos.x + offset.x,
        y: workingPos.y,
        z: workingPos.z + offset.z
      }, bounds)

      if (logger) {
        logger.log('scout_slide_attempt', {
          runId,
          stepIndex,
          candidate,
          waypoint,
          offset
        })
      }

      const slideGoal = new goals.GoalNear(Math.floor(candidate.x), Math.floor(candidate.y), Math.floor(candidate.z), 1)
      const slideResult = await gotoWithTimeout(bot, slideGoal, Math.max(SLIDE_TIMEOUT_MIN_MS, Math.floor(timeoutMs * 0.35)))

      if (slideResult.success) {
        movedThisLoop = true
        progressMade = true
        const slideArrived = quantize(bot.entity.position)
        workingPos = slideArrived

        if (logger) {
          logger.log('scout_slide_success', {
            runId,
            stepIndex,
            candidate,
            arrived: slideArrived
          })
        }

        const retryGoal = new goals.GoalNear(Math.floor(waypoint.x), Math.floor(waypoint.y), Math.floor(waypoint.z), 1)
        const retryResult = await gotoWithTimeout(bot, retryGoal, Math.max(4000, Math.floor(timeoutMs * 0.7)))
        if (retryResult.success) {
          if (logger) {
            logger.log('scout_slide_retry_success', {
              runId,
              stepIndex,
              waypoint,
              arrived: quantize(bot.entity.position)
            })
          }
          return { success: true, via: 'slide', reachedTarget: true }
        }

        if (logger) {
          logger.log('scout_slide_retry_failed', {
            runId,
            stepIndex,
            waypoint,
            reason: retryResult.reason || 'navigation_failed'
          })
        }
        break
      }

      lastReason = slideResult.reason || 'slide_failed'
      if (logger) {
        logger.log('scout_slide_failed', {
          runId,
          stepIndex,
          candidate,
          reason: lastReason
        })
      }
    }

    if (!movedThisLoop) {
      break
    }
  }

  if (progressMade) {
    if (logger) {
      logger.log('scout_slide_partial_progress', {
        runId,
        stepIndex,
        waypoint
      })
    }
    return { success: true, via: 'slide_partial', reachedTarget: false, partial: true }
  }

  return { success: false, reason: lastReason || 'slide_failed', slideAttempts: attempts }
}

async function moveToWaypoint(bot, waypoint, timeoutMs, options = {}) {
  const { currentPos, bounds, allowDetours = true, logger, runId, stepIndex } = options
  const goal = new goals.GoalNear(Math.floor(waypoint.x), Math.floor(waypoint.y), Math.floor(waypoint.z), 1)
  const directResult = await gotoWithTimeout(bot, goal, timeoutMs)
  if (directResult.success) {
    return { success: true, via: 'direct' }
  }

  if (allowDetours && currentPos) {
    const slideResult = await attemptWallSlide(bot, waypoint, timeoutMs, {
      currentPos,
      bounds,
      logger,
      runId,
      stepIndex
    })
    if (slideResult.success) {
      return slideResult
    }
  }

  if (!allowDetours || !currentPos) {
    return { success: false, reason: directResult.reason || 'navigation_failed' }
  }

  const detourCandidates = generateDetourCandidates(currentPos, waypoint, bounds)
  let attempts = 0
  for (const candidate of detourCandidates) {
    attempts += 1
    if (logger) {
      logger.log('scout_detour_attempt', {
        runId,
        stepIndex,
        waypoint,
        candidate
      })
    }
    const detourGoal = new goals.GoalNear(Math.floor(candidate.x), Math.floor(candidate.y), Math.floor(candidate.z), 1)
    const detourResult = await gotoWithTimeout(bot, detourGoal, Math.max(4000, Math.floor(timeoutMs * 0.6)))
    if (detourResult.success) {
      if (logger) {
        logger.log('scout_detour_success', {
          runId,
          stepIndex,
          waypoint,
          candidate
        })
      }
      return { success: true, via: 'detour', detourTarget: candidate }
    }
    if (logger) {
      logger.log('scout_detour_failed', {
        runId,
        stepIndex,
        waypoint,
        candidate,
        reason: detourResult.reason || 'detour_failed'
      })
    }
  }

  return {
    success: false,
    reason: directResult.reason || 'navigation_failed',
    detourAttempts: attempts
  }
}

function blockNameAt(bot, pos) {
  const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
  return block?.name || 'unknown'
}

function isPassableBlock(block) {
  if (!block) return false
  if (isHazardousOrFluidBlock(block)) return false
  return block.boundingBox === 'empty'
}

function isStandableBlock(block) {
  if (!block) return false
  if (isHazardousOrFluidBlock(block)) return false
  return block.boundingBox === 'block'
}

function isHazardousOrFluidBlock(block) {
  if (!block || typeof block.name !== 'string') return false
  const name = block.name.toLowerCase()
  if (name.includes('water') || name.includes('lava')) return true
  return HAZARD_BLOCK_TAGS.some(tag => name.includes(tag))
}

function resolveFeasibleWaypoint(bot, waypoint, fallbackY) {
  if (!bot || !waypoint) return null
  const x = Math.round(waypoint.x)
  const z = Math.round(waypoint.z)
  const yCandidates = [waypoint.y, waypoint.y - 1, waypoint.y + 1, fallbackY]

  for (const yRaw of yCandidates) {
    const y = Math.round(yRaw)
    const feet = bot.blockAt(new Vec3(x, y, z))
    const head = bot.blockAt(new Vec3(x, y + 1, z))
    const below = bot.blockAt(new Vec3(x, y - 1, z))
    if (isPassableBlock(feet) && isPassableBlock(head) && isStandableBlock(below)) {
      return { x, y, z }
    }
  }

  return null
}

function sampleSurroundingBlocks(bot, pos) {
  if (!bot || !pos) return []
  const samples = []
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const x = Math.round(pos.x + dx)
      const y = Math.round(pos.y)
      const z = Math.round(pos.z + dz)
      const below = bot.blockAt(new Vec3(x, y - 1, z))
      const feet = bot.blockAt(new Vec3(x, y, z))
      const head = bot.blockAt(new Vec3(x, y + 1, z))
      samples.push({
        x,
        y,
        z,
        below: below?.name || 'unknown',
        feet: feet?.name || 'unknown',
        head: head?.name || 'unknown'
      })
    }
  }
  return samples
}

function prettify(name) {
  return name
    .split(/[_:]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function baseEntities(locationEntry) {
  return {
    door: [],
    code: [],
    location: locationEntry ? [locationEntry] : [],
    tool: []
  }
}

function createClaimPayload({ type, description, goalTags, location, extraEntities = {}, metadata = {}, confidence = 0.78, runId, scenarioId, actionRecipe }) {
  const locationEntry = location ? [location] : []
  const mergedEntities = baseEntities(null)
  if (locationEntry.length > 0) mergedEntities.location = locationEntry
  if (extraEntities.door) mergedEntities.door = extraEntities.door
  if (extraEntities.tool) mergedEntities.tool = extraEntities.tool

  return {
    id: uuidv4(),
    memory_type: 'claim',
    type,
    task_id: scenarioId,
    scenarioId,
    goal_tags: goalTags,
    entities: mergedEntities,
    prerequisites: [],
    confidence,
    timestamp: Date.now(),
    source_episode_ids: runId ? [runId] : [],
    action_recipe: actionRecipe || description,
    description,
    metadata
  }
}

function pushClaim(target, claim, dedupeSet, dedupeKey) {
  if (!claim || !dedupeKey) return
  if (dedupeSet.has(dedupeKey)) return
  dedupeSet.add(dedupeKey)
  target.push(claim)
  debugLog('claims', 'Scout claim detected', {
    type: claim.type,
    tags: claim.goal_tags,
    location: claim.entities.location?.[0] || null
  })
}

function detectBlocks(bot, keywords, scanRadius, limit) {
  return bot.findBlocks({
    matching: block => block && keywords.some(key => block.name.includes(key)),
    maxDistance: scanRadius,
    count: limit
  })
}

function detectDoors(bot, scanRadius) {
  return bot.findBlocks({
    matching: block => block && DOOR_KEYS.some(key => block.name.includes(key)),
    maxDistance: scanRadius,
    count: 32
  })
}

function detectHazards(bot, scanRadius) {
  return bot.findBlocks({
    matching: block => block && HAZARD_BLOCK_TAGS.some(key => block.name.includes(key)),
    maxDistance: scanRadius,
    count: 32
  })
}

function detectSupplyCaches(bot, scanRadius) {
  return bot.findBlocks({
    matching: block => block && SUPPLY_BLOCK_KEYS.some(key => block.name.includes(key)),
    maxDistance: scanRadius,
    count: 32
  })
}

function detectItemFrames(bot, scanRadius) {
  if (!Number.isFinite(scanRadius) || scanRadius <= 0) return []
  const origin = bot.entity.position
  return Object.values(bot.entities)
    .filter(entity => entity && FRAME_ENTITY_TYPES.includes(entity.name))
    .filter(entity => origin.distanceTo(entity.position) <= scanRadius)
}

function readItemFrameDisplayName(frame) {
  const metadata = Array.isArray(frame?.metadata) ? frame.metadata : []
  for (const entry of metadata) {
    if (!entry) continue
    if (typeof entry.name === 'string' && entry.name) {
      return String(entry.name).toLowerCase()
    }
    if (entry.value && typeof entry.value === 'object') {
      const candidate = entry.value.name || entry.value.displayName || entry.value.itemName
      if (candidate) return String(candidate).toLowerCase()
    }
  }
  return null
}

function serializeContainerItems(items = []) {
  return items
    .filter(item => item && (item.name || item.displayName))
    .map(item => ({
      name: String(item.name || item.displayName || '').toLowerCase(),
      displayName: item.displayName || null,
      count: Number(item.count || 0)
    }))
    .filter(entry => entry.name)
}

async function inspectContainerContents(bot, pos, scanRadius) {
  if (!bot || !pos || !Number.isFinite(scanRadius) || scanRadius <= 0) {
    return { inspected: false, reason: 'invalid_input', contents: [] }
  }

  const origin = bot.entity?.position
  if (!origin) return { inspected: false, reason: 'no_origin', contents: [] }
  const dist = origin.distanceTo(new Vec3(pos.x, pos.y, pos.z))
  if (dist > Math.min(4.5, scanRadius)) {
    return { inspected: false, reason: 'not_reachable', contents: [] }
  }

  const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
  if (!block) return { inspected: false, reason: 'missing_block', contents: [] }

  let opened = null
  try {
    if (typeof bot.openContainer === 'function') {
      opened = await bot.openContainer(block)
    } else if (typeof bot.openChest === 'function') {
      opened = await bot.openChest(block)
    }

    if (!opened || typeof opened.containerItems !== 'function') {
      return { inspected: false, reason: 'open_failed', contents: [] }
    }

    const contents = serializeContainerItems(opened.containerItems())
    if (typeof opened.close === 'function') opened.close()
    return {
      inspected: true,
      reason: 'ok',
      contents
    }
  } catch {
    try {
      if (opened && typeof opened.close === 'function') opened.close()
    } catch {
      // Ignore close failures.
    }
    return { inspected: false, reason: 'open_exception', contents: [] }
  }
}

function hazardKey3D(pos) {
  return `${pos.x}:${pos.y}:${pos.z}`
}

function registerHazardRecord(store, claim) {
  if (!claim) return
  const location = Array.isArray(claim.entities?.location) ? claim.entities.location[0] : null
  if (!location) return
  const normalized = quantize(location)
  if (!normalized) return
  const key = hazardKey3D(normalized)
  if (store.has(key)) return
  store.set(key, {
    key,
    claimId: claim.id,
    position: normalized,
    radius: claim.metadata?.radius || DEFAULT_HAZARD_RADIUS,
    hazard: claim.metadata?.hazard || claim.metadata?.hazardType || 'hazard',
    segments: []
  })
}

function trackSafePathSegments(store, from, to) {
  if (!from || !to) return
  const segment = { from: quantize(from), to: quantize(to) }
  store.forEach(record => {
    if (segmentTouchesHazard(record, segment)) {
      record.segments.push(segment)
    }
  })
}

function segmentTouchesHazard(record, segment) {
  const buffer = Math.max(record.radius + SAFE_PATH_BUFFER_RADIUS, record.radius + 1)
  const distFrom = distance2D(record.position, segment.from)
  const distTo = distance2D(record.position, segment.to)
  const midpoint = {
    x: Math.round((segment.from.x + segment.to.x) / 2),
    y: Math.round((segment.from.y + segment.to.y) / 2),
    z: Math.round((segment.from.z + segment.to.z) / 2)
  }
  const minDistance = Math.min(distFrom, distTo, distance2D(record.position, midpoint))
  if (minDistance > buffer) return false
  if (distFrom <= Math.max(record.radius - SAFE_PATH_MIN_DISTANCE, 0)) return false
  if (distTo <= Math.max(record.radius - SAFE_PATH_MIN_DISTANCE, 0)) return false
  return true
}

function emitSafePathClaims(store, claims, dedupe, scenarioId, runId) {
  store.forEach(record => {
    if (!Array.isArray(record.segments) || record.segments.length === 0) return
    const waypoints = buildWaypointChain(record.segments)
    if (waypoints.length < 2) return
    const entry = waypoints[0]
    const exit = waypoints[waypoints.length - 1]
    const description = `Safe path of ${waypoints.length} waypoints bypassing ${record.hazard} at (${record.position.x}, ${record.position.y}, ${record.position.z}).`
    const claim = createClaimPayload({
      type: 'SafePathClaim',
      description,
      goalTags: ['scouting', 'hazard', 'safe_path'],
      location: entry,
      metadata: {
        hazardClaimId: record.claimId,
        hazardCenter: record.position,
        hazardType: record.hazard,
        radius: record.radius,
        waypoints,
        pathLength: computePathLength(waypoints),
        segmentCount: record.segments.length,
        exit
      },
      confidence: 0.76,
      actionRecipe: `Follow ${waypoints.length} waypoint safe path from (${entry.x}, ${entry.y}, ${entry.z}) to (${exit.x}, ${exit.y}, ${exit.z}) to bypass the hazard at (${record.position.x}, ${record.position.y}, ${record.position.z}).`,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `safe_path:${record.key}`)
  })
}

function buildWaypointChain(segments = []) {
  const chain = []
  segments.forEach(segment => {
    if (!segment || !segment.from || !segment.to) return
    if (chain.length === 0) {
      chain.push(segment.from, segment.to)
      return
    }
    const last = chain[chain.length - 1]
    if (!positionsMatch(last, segment.from)) {
      chain.push(segment.from)
    }
    chain.push(segment.to)
  })
  return dedupeSequential(chain)
}

function dedupeSequential(points = []) {
  const result = []
  points.forEach(point => {
    if (!point) return
    const last = result[result.length - 1]
    if (last && positionsMatch(last, point)) return
    result.push(point)
  })
  return result
}

function positionsMatch(a, b) {
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.z === b.z
}

function computePathLength(waypoints = []) {
  let total = 0
  for (let i = 1; i < waypoints.length; i += 1) {
    total += distance2D(waypoints[i - 1], waypoints[i])
  }
  return Number(total.toFixed(2))
}

async function detectFeatures(bot, config, runCtx) {
  const claims = []
  const { dedupe, scenarioId, runId } = runCtx

  const landmarkPositions = detectBlocks(bot, LANDMARK_KEYS, config.scanRadius, 12)
  for (const pos of landmarkPositions) {
    const loc = quantize(pos)
    const blockName = blockNameAt(bot, pos)
    const description = `Landmark ${prettify(blockName)} spotted near (${loc.x}, ${loc.y}, ${loc.z}).`
    const claim = createClaimPayload({
      type: 'LandmarkClaim',
      description,
      goalTags: ['scouting', 'landmark'],
      location: loc,
      metadata: { block: blockName },
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `landmark:${blockName}:${loc.x}:${loc.y}:${loc.z}`)
  }

  const interactablePositions = detectBlocks(bot, INTERACTABLE_KEYS, config.scanRadius, 20)
  for (const pos of interactablePositions) {
    const loc = quantize(pos)
    const blockName = blockNameAt(bot, pos)
    const description = `Interactable ${prettify(blockName)} located at (${loc.x}, ${loc.y}, ${loc.z}).`
    const claim = createClaimPayload({
      type: 'InteractableClaim',
      description,
      goalTags: ['scouting', 'interaction'],
      location: loc,
      metadata: { interactable: blockName },
      confidence: 0.74,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `interactable:${blockName}:${loc.x}:${loc.y}:${loc.z}`)
  }

  const toolPositions = detectBlocks(bot, TOOL_BLOCKS, config.scanRadius, 20)
  for (const pos of toolPositions) {
    const loc = quantize(pos)
    const blockName = blockNameAt(bot, pos)
    const description = `${prettify(blockName)} available at (${loc.x}, ${loc.y}, ${loc.z}).`
    const claim = createClaimPayload({
      type: 'ToolLocationClaim',
      description,
      goalTags: ['scouting', 'tool'],
      location: loc,
      extraEntities: {
        tool: [{ id: blockName, location: loc }]
      },
      confidence: 0.82,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `tool:${blockName}:${loc.x}:${loc.y}:${loc.z}`)
  }

  const supplyPositions = detectSupplyCaches(bot, config.scanRadius)
  for (const pos of supplyPositions) {
    const loc = quantize(pos)
    const blockName = blockNameAt(bot, pos)
    const roomPosition = quantize(bot.entity.position)
    const description = `Supply cache ${prettify(blockName)} located at (${loc.x}, ${loc.y}, ${loc.z}).`
    const claim = createClaimPayload({
      type: 'SupplyCacheClaim',
      description,
      goalTags: ['scouting', 'supply'],
      location: loc,
      metadata: { block: blockName, roomPosition },
      confidence: 0.8,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `supply:${blockName}:${loc.x}:${loc.y}:${loc.z}`)

    const inspected = await inspectContainerContents(bot, loc, config.scanRadius)
    if (inspected.inspected) {
      const observedItems = inspected.contents
      const contentsClaim = createClaimPayload({
        type: 'ContainerContentsClaim',
        description: `Last observed contents for ${prettify(blockName)} at (${loc.x}, ${loc.y}, ${loc.z}): ${observedItems.length} item entries.`,
        goalTags: ['scouting', 'supply', 'container_contents', 'last_observed'],
        location: loc,
        metadata: {
          containerType: blockName,
          roomPosition,
          lastObservedContents: observedItems,
          observedAt: Date.now(),
          contentsAreHints: true
        },
        confidence: 0.78,
        actionRecipe: `Treat contents as last observed hints; reopen container at (${loc.x}, ${loc.y}, ${loc.z}) to verify current inventory.`,
        runId,
        scenarioId
      })
      pushClaim(claims, contentsClaim, dedupe, `container_contents:${blockName}:${loc.x}:${loc.y}:${loc.z}`)
    }
  }

  const doorPositions = detectDoors(bot, config.scanRadius)
  for (const pos of doorPositions) {
    const loc = quantize(pos)
    const blockName = blockNameAt(bot, pos)
    const doorId = `${blockName}_${loc.x}_${loc.z}`
    const description = `Doorway ${prettify(blockName)} observed at (${loc.x}, ${loc.y}, ${loc.z}).`
    const claim = createClaimPayload({
      type: 'DoorLocationClaim',
      description,
      goalTags: ['scouting', 'door'],
      location: loc,
      extraEntities: {
        door: [{ id: doorId, location: loc }]
      },
      confidence: 0.76,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `door:${doorId}`)
  }

  const hazardPositions = detectHazards(bot, config.scanRadius)
  for (const pos of hazardPositions) {
    const loc = quantize(pos)
    const blockName = blockNameAt(bot, pos)
    const description = `Hazard ${prettify(blockName)} detected at (${loc.x}, ${loc.y}, ${loc.z}).`
    const claim = createClaimPayload({
      type: 'HazardZoneClaim',
      description,
      goalTags: ['scouting', 'hazard'],
      location: loc,
      metadata: { hazard: blockName, radius: DEFAULT_HAZARD_RADIUS },
      confidence: 0.71,
      actionRecipe: `Avoid a radius of ${DEFAULT_HAZARD_RADIUS} blocks around (${loc.x}, ${loc.y}, ${loc.z}).`,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `hazard:${blockName}:${loc.x}:${loc.y}:${loc.z}`)
  }

  const itemFrames = detectItemFrames(bot, config.scanRadius)
  for (const frame of itemFrames) {
    const loc = quantize(frame.position)
    const displayedItem = readItemFrameDisplayName(frame)
    const description = displayedItem
      ? `Item frame observed at (${loc.x}, ${loc.y}, ${loc.z}) showing ${displayedItem}.`
      : `Item frame observed at (${loc.x}, ${loc.y}, ${loc.z}).`
    const claim = createClaimPayload({
      type: 'ItemFrameClaim',
      description,
      goalTags: ['scouting', 'frame', 'supply'],
      location: loc,
      metadata: {
        frameType: frame.name,
        facing: frame.metadata?.[6]?.value ?? null,
        displayedItem: displayedItem || null,
        displayedItemReadable: Boolean(displayedItem)
      },
      confidence: 0.74,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `item_frame:${loc.x}:${loc.y}:${loc.z}`)
  }

  return claims
}

function buildRouteClaim(from, to, scenarioId, runId, stepIndex) {
  const start = quantize(from)
  const end = quantize(to)
  const description = `Route ${stepIndex} establishes movement from (${start.x}, ${start.y}, ${start.z}) to (${end.x}, ${end.y}, ${end.z}).`
  return createClaimPayload({
    type: 'RouteClaim',
    description,
    goalTags: ['scouting', 'route'],
    location: start,
    metadata: {
      start,
      end,
      length: Math.round(distance2D(start, end)),
      stepIndex
    },
    confidence: 0.73,
    runId,
    scenarioId
  })
}

function emitRouteLearningClaims(routeLog, failedWaypointCounts, claims, dedupe, scenarioId, runId, fallbackY) {
  const successfulSegments = routeLog.filter(entry => entry && entry.success && entry.from && entry.to)
  if (successfulSegments.length > 0) {
    const waypoints = []
    for (const segment of successfulSegments) {
      if (waypoints.length === 0) waypoints.push(quantize(segment.from))
      waypoints.push(quantize(segment.to))
    }
    const routeWaypoints = dedupeSequential(waypoints)
    if (routeWaypoints.length >= 3) {
      const anchors = buildSparseRouteAnchors(routeWaypoints)
      const frontiers = buildFrontierTransitions(anchors)
      const productiveRegions = buildProductiveRegions(anchors, frontiers)
      const start = routeWaypoints[0]
      const end = routeWaypoints[routeWaypoints.length - 1]
      const claim = createClaimPayload({
        type: 'ScoutRouteMemoryClaim',
        description: `Successful scout traversal captured ${anchors.length} reusable anchors from (${start.x}, ${start.y}, ${start.z}) to (${end.x}, ${end.y}, ${end.z}).`,
        goalTags: ['scouting', 'route', 'route_memory'],
        location: start,
        metadata: {
          anchors,
          frontiers,
          productiveRegions,
          start,
          end,
          segmentCount: successfulSegments.length,
          pathLength: computePathLength(anchors)
        },
        confidence: 0.84,
        runId,
        scenarioId
      })
      pushClaim(claims, claim, dedupe, `route_memory:${start.x}:${start.z}:${end.x}:${end.z}:${successfulSegments.length}`)
    }
  }

  const deadzoneEntries = Array.from(failedWaypointCounts.entries())
    .filter(([, attempts]) => attempts >= 2)
    .slice(0, 8)

  deadzoneEntries.forEach(([key, attempts]) => {
    const [x, z] = key.split(':').map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(z)) return
    const location = { x, y: fallbackY, z }
    const claim = createClaimPayload({
      type: 'DeadzoneClaim',
      description: `Repeated scout navigation failures near (${x}, ${fallbackY}, ${z}) (${attempts} attempts).`,
      goalTags: ['scouting', 'deadzone'],
      location,
      metadata: {
        attempts,
        radius: DEADZONE_BLOCK_RADIUS
      },
      confidence: 0.8,
      runId,
      scenarioId
    })
    pushClaim(claims, claim, dedupe, `deadzone:${x}:${z}`)
  })
}

async function runScoutEpisode(bot, logger, options = {}) {
  const runId = options.runId || uuidv4()
  const config = resolveScoutAreaConfig(options.bounds || options)
  const scenarioId = config.scenarioId
  const mode = options.mode || 'distilled'
  const memoryMode = resolveMemoryMode(mode)

  logger.log('scout_episode_start', {
    runId,
    scenarioId,
    bounds: config.bounds,
    maxSteps: config.maxSteps,
    scanRadius: config.scanRadius
  })

  await ensureSpawnReset(bot, logger, config.spawnPosition, runId, 'start')

  let memoryBias = null
  let routeMemoryAvailable = false
  if (memoryMode.includeDistilled || memoryMode.includeRaw) {
    const retrieved = await ragRetrieveHybrid({
      scenarioId,
      consumerScenarioId: scenarioId,
      observation: { position: quantize(bot.entity.position) },
      topK: 8,
      includeDistilled: memoryMode.includeDistilled,
      includeRaw: memoryMode.includeRaw
    })
    const balancedMemories = rebalanceScoutMemories(retrieved, scenarioId, 8)
    routeMemoryAvailable = balancedMemories.some(isSuccessfulRouteMemory)
    if (routeMemoryAvailable) {
      memoryBias = buildScoutMemoryBias(balancedMemories)
    } else {
      // If there is no route memory, keep scout in raw-style exploration.
      memoryBias = null
    }
    logger.log('scout_memory_bias', {
      runId,
      mode,
      memoryCount: memoryBias ? memoryBias.memoryCount : 0,
      hazardHints: memoryBias ? memoryBias.hazards.length : 0,
      routeHints: memoryBias ? memoryBias.routes.length : 0,
      deadzoneHints: memoryBias ? memoryBias.deadzones.length : 0,
      routeSeeds: memoryBias ? memoryBias.productiveRegions.length : 0,
      routeMemoryAvailable
    })
  }

  const waypoints = buildWaypointGrid(config.bounds, config.gridStep, config.center)
  if (Array.isArray(config.priorityWaypoints) && config.priorityWaypoints.length > 0) {
    config.priorityWaypoints.forEach(point => {
      if (!point) return
      waypoints.push({
        x: Math.round(point.x),
        y: Number.isFinite(point.y) ? point.y : config.center.y,
        z: Math.round(point.z)
      })
    })
  }
  const visitedCells = new Set()
  const claims = []
  const dedupe = new Set()
  const visitLog = []
  const routeLog = []
  const hazardRecords = new Map()
  const failedWaypointCounts = new Map()
  let steps = 0
  let failedMoves = 0
  let successfulMoves = 0
  let consecutiveFailures = 0
  let consecutiveFailureMax = 0
  let recoveryTeleportUsed = false
  let terminatedByStagnation = false
  let routeReuseSelections = 0
  let routeReuseSuccesses = 0
  let deadzoneAvoidSkips = 0
  let routeSeedsAttempted = 0
  let routeSeedsRejectedUnreachable = 0
  let routeSeedsReached = 0
  let routeFallbackToExploration = 0

  let currentPos = quantize(bot.entity.position)
  visitedCells.add(cellKey(currentPos))

  const runCtx = { dedupe, scenarioId, runId }

  while (steps < config.maxSteps) {
    const selectionTelemetry = { deadzoneAvoidSkips }
    const selectionExcluded = new Set()
    let chosenTarget = null
    let chosenSource = 'explore'
    let activeMemoryBias = memoryBias
    let guidanceRegion = null

    if (memoryBias && routeMemoryAvailable) {
      routeSeedsAttempted += 1
      guidanceRegion = selectReachableProductiveRegion(bot, currentPos, memoryBias)
      if (!guidanceRegion) {
        routeSeedsRejectedUnreachable += 1
        activeMemoryBias = null
        routeFallbackToExploration += 1
      } else {
        routeReuseSelections += 1
        chosenSource = 'route_bias'
      }
    }

    chosenTarget = chooseNextWaypoint(
      currentPos,
      waypoints,
      visitedCells,
      config.gridStep,
      config.waypointJitter,
      activeMemoryBias,
      selectionTelemetry,
      guidanceRegion,
      selectionExcluded
    )
    deadzoneAvoidSkips = selectionTelemetry.deadzoneAvoidSkips || 0

    let target = null
    while (chosenTarget) {
      const feasible = resolveFeasibleWaypoint(bot, chosenTarget, currentPos.y)
      if (feasible && distance2D(feasible, chosenTarget) <= MAX_RESOLVED_WAYPOINT_DRIFT) {
        target = feasible
        break
      }
      selectionExcluded.add(cellKey(chosenTarget))
      chosenTarget = chooseNextWaypoint(
        currentPos,
        waypoints,
        visitedCells,
        config.gridStep,
        config.waypointJitter,
        activeMemoryBias,
        selectionTelemetry,
        guidanceRegion,
        selectionExcluded
      )
      deadzoneAvoidSkips = selectionTelemetry.deadzoneAvoidSkips || 0
      chosenSource = 'explore'
    }
    if (!target) break

    logger.log('scout_waypoint_selected', {
      runId,
      waypoint: target,
      stepIndex: steps,
      source: chosenSource
    })

    const navigation = await moveToWaypoint(bot, target, config.navigationTimeoutMs, {
      currentPos,
      bounds: config.bounds,
      allowDetours: true,
      logger,
      runId,
      stepIndex: steps
    })
    const arrivedPos = quantize(bot.entity.position)
    visitedCells.add(cellKey(arrivedPos))

    routeLog.push({ from: currentPos, to: arrivedPos, success: navigation.success })

    if (navigation.success) {
      successfulMoves += 1
      if (chosenSource === 'route_bias') {
        routeReuseSuccesses += 1
        routeSeedsReached += 1
      }
      consecutiveFailures = 0
      failedWaypointCounts.delete(cellKey(target))
      const routeClaim = buildRouteClaim(currentPos, arrivedPos, scenarioId, runId, steps + 1)
      pushClaim(claims, routeClaim, dedupe, `route:${routeClaim.metadata.start.x}:${routeClaim.metadata.end.x}:${steps}`)
      const featureClaims = await detectFeatures(bot, config, runCtx)
      featureClaims.forEach(claim => {
        claims.push(claim)
        if (claim.type === 'HazardZoneClaim') {
          registerHazardRecord(hazardRecords, claim)
        }
      })
      trackSafePathSegments(hazardRecords, currentPos, arrivedPos)
    } else {
      failedMoves += 1
      consecutiveFailures += 1
      consecutiveFailureMax = Math.max(consecutiveFailureMax, consecutiveFailures)
      const waypointKey = cellKey(target)
      logger.log('scout_navigation_failed', {
        runId,
        target,
        arrived: arrivedPos,
        reason: navigation.reason || 'unknown'
      })

      if (chosenSource === 'route_bias') {
        routeFallbackToExploration += 1
      }

      if (failedMoves <= 5) {
        logger.log('scout_failure_trace', {
          runId,
          stepIndex: steps,
          chosenWaypoint: chosenTarget,
          resolvedFeasibleWaypoint: target,
          arrived: arrivedPos,
          reason: navigation.reason || 'unknown',
          surroundingBlocks: sampleSurroundingBlocks(bot, target)
        })
      }

      const attempts = (failedWaypointCounts.get(waypointKey) || 0) + 1
      failedWaypointCounts.set(waypointKey, attempts)
      if (attempts >= 2) {
        visitedCells.add(waypointKey)
      }

      if (consecutiveFailures >= STAGNATION_FAILURE_LIMIT) {
        if (!recoveryTeleportUsed) {
          recoveryTeleportUsed = true
          logger.log('scout_stagnation_recovery', {
            runId,
            stepIndex: steps,
            consecutiveFailures
          })
          await ensureSpawnReset(bot, logger, config.spawnPosition, runId, 'recovery')
          currentPos = quantize(bot.entity.position)
          consecutiveFailures = 0
        } else {
          terminatedByStagnation = true
          logger.log('scout_stagnation_stop', {
            runId,
            stepIndex: steps,
            consecutiveFailures
          })
          break
        }
      }
    }

    visitLog.push({
      target,
      arrived: arrivedPos,
      success: navigation.success
    })

    currentPos = arrivedPos
    steps += 1
  }

  emitSafePathClaims(hazardRecords, claims, dedupe, scenarioId, runId)
  emitRouteLearningClaims(routeLog, failedWaypointCounts, claims, dedupe, scenarioId, runId, config.center.y)

  const waypointAttempts = successfulMoves + failedMoves
  const waypointKeySet = new Set(waypoints.map(cellKey))
  const uniqueWaypointCount = waypointKeySet.size
  const coveredWaypointCount = Array.from(visitedCells).reduce((count, key) => {
    return count + (waypointKeySet.has(key) ? 1 : 0)
  }, 0)
  const coverageRatio = uniqueWaypointCount > 0
    ? Number((Math.min(coveredWaypointCount, uniqueWaypointCount) / uniqueWaypointCount).toFixed(3))
    : 0
  const waypointSuccessRate = waypointAttempts > 0
    ? Number((successfulMoves / waypointAttempts).toFixed(3))
    : 0
  const success = coverageRatio >= SCOUT_MIN_COVERAGE_SUCCESS && waypointSuccessRate >= SCOUT_MIN_WAYPOINT_SUCCESS

  debugLog('claims', 'ScoutEpisode summary', {
    runId,
    scenarioId,
    claimsRecorded: claims.length,
    visitedCells: visitedCells.size,
    failedMoves
  })

  logger.log('scout_episode_end', {
    runId,
    scenarioId,
    steps,
    visitedCells: visitedCells.size,
    claims: claims.length,
    failedMoves,
    successfulMoves,
    coverageRatio,
    waypointSuccessRate,
    consecutiveFailureMax,
    success,
    terminatedByStagnation,
    recoveryTeleportUsed,
    routeReuseSelections,
    routeReuseSuccesses,
    deadzoneAvoidSkips,
    routeSeedsAttempted,
    routeSeedsRejectedUnreachable,
    routeSeedsReached,
    routeFallbackToExploration
  })

  return {
    runId,
    scenarioId,
    stepsExecuted: steps,
    success,
    visitedCells: visitedCells.size,
    claims,
    visitLog,
    routeLog,
    failedMoves,
    successfulMoves,
    coverageRatio,
    waypointSuccessRate,
    consecutiveFailureMax,
    terminatedByStagnation,
    recoveryTeleportUsed,
    routeReuseSelections,
    routeReuseSuccesses,
    deadzoneAvoidSkips,
    routeSeedsAttempted,
    routeSeedsRejectedUnreachable,
    routeSeedsReached,
    routeFallbackToExploration,
    scanRadius: config.scanRadius,
    bounds: config.bounds
  }
}

module.exports = { runScoutEpisode }
