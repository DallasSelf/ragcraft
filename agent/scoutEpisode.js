const { v4: uuidv4 } = require('uuid')
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { resolveScoutAreaConfig } = require('../scenarios/scoutAreaConfig')
const { debugLog } = require('../logging/debugFlags')
const { HAZARD_BLOCK_TAGS, DEFAULT_HAZARD_RADIUS, SAFE_PATH_BUFFER_RADIUS } = require('./constants/hazards')

const LANDMARK_KEYS = ['beacon', 'bell', 'lodestone', 'campfire', 'fountain', 'portal']
const INTERACTABLE_KEYS = ['lever', 'button', 'pressure_plate', 'tripwire']
const TOOL_BLOCKS = ['crafting_table', 'smithing_table', 'anvil', 'grindstone', 'loom', 'cartography_table', 'stonecutter', 'brewing_stand', 'enchanting_table']
const DOOR_KEYS = ['door', 'fence_gate', 'trapdoor']
const SAFE_PATH_MIN_DISTANCE = 2

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
  for (let x = Math.floor(bounds.min.x); x <= Math.ceil(bounds.max.x); x += step) {
    for (let z = Math.floor(bounds.min.z); z <= Math.ceil(bounds.max.z); z += step) {
      waypoints.push({ x, y: center.y, z })
    }
  }
  waypoints.push({ x: center.x, y: center.y, z: center.z })
  return waypoints
}

function chooseNextWaypoint(current, waypoints, visited, gridStep) {
  const candidates = waypoints.filter(point => !visited.has(cellKey(point)))
  if (candidates.length === 0) return null

  let best = null
  for (const point of candidates) {
    const novelty = 1 / (1 + countVisitedNeighbors(point, visited, gridStep))
    const dist = distance2D(current, point)
    const score = novelty * 2 - dist * 0.01
    if (!best || score > best.score) {
      best = { point, score }
    }
  }
  return best.point
}

async function teleportToStart(bot, logger, position) {
  if (!position) return
  const cmd = `/tp ${bot.username} ${position.x} ${position.y} ${position.z}`
  bot.chat(cmd)
  logger.log('scout_teleport_start', { cmd })
  await wait(200)
}

async function moveToWaypoint(bot, waypoint, timeoutMs) {
  const goal = new goals.GoalNear(Math.floor(waypoint.x), Math.floor(waypoint.y), Math.floor(waypoint.z), 1)
  try {
    const movePromise = bot.pathfinder.goto(goal)
    const result = await Promise.race([
      movePromise.then(() => 'arrived'),
      wait(timeoutMs).then(() => 'timeout')
    ])
    if (result === 'timeout') {
      bot.pathfinder.stop()
      return { success: false, reason: 'timeout' }
    }
    return { success: true }
  } catch (err) {
    bot.pathfinder.stop()
    return { success: false, reason: err.message }
  }
}

function blockNameAt(bot, pos) {
  const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
  return block?.name || 'unknown'
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

function detectFeatures(bot, config, runCtx) {
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

async function runScoutEpisode(bot, logger, options = {}) {
  const runId = options.runId || uuidv4()
  const config = resolveScoutAreaConfig(options.bounds || options)
  const scenarioId = config.scenarioId

  logger.log('scout_episode_start', {
    runId,
    scenarioId,
    bounds: config.bounds,
    maxSteps: config.maxSteps,
    scanRadius: config.scanRadius
  })

  await teleportToStart(bot, logger, config.spawnPosition)

  const waypoints = buildWaypointGrid(config.bounds, config.gridStep, config.center)
  const visitedCells = new Set()
  const claims = []
  const dedupe = new Set()
  const visitLog = []
  const routeLog = []
  const hazardRecords = new Map()
  let steps = 0
  let failedMoves = 0

  let currentPos = quantize(bot.entity.position)
  visitedCells.add(cellKey(currentPos))

  const runCtx = { dedupe, scenarioId, runId }

  while (steps < config.maxSteps) {
    const target = chooseNextWaypoint(currentPos, waypoints, visitedCells, config.gridStep)
    if (!target) break

    logger.log('scout_waypoint_selected', {
      runId,
      waypoint: target,
      stepIndex: steps
    })

    const navigation = await moveToWaypoint(bot, target, config.navigationTimeoutMs)
    const arrivedPos = quantize(bot.entity.position)
    visitedCells.add(cellKey(arrivedPos))

    routeLog.push({ from: currentPos, to: arrivedPos, success: navigation.success })

    if (navigation.success) {
      const routeClaim = buildRouteClaim(currentPos, arrivedPos, scenarioId, runId, steps + 1)
      pushClaim(claims, routeClaim, dedupe, `route:${routeClaim.metadata.start.x}:${routeClaim.metadata.end.x}:${steps}`)
      const featureClaims = detectFeatures(bot, config, runCtx)
      featureClaims.forEach(claim => {
        claims.push(claim)
        if (claim.type === 'HazardZoneClaim') {
          registerHazardRecord(hazardRecords, claim)
        }
      })
      trackSafePathSegments(hazardRecords, currentPos, arrivedPos)
    } else {
      failedMoves += 1
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
    failedMoves
  })

  return {
    runId,
    scenarioId,
    stepsExecuted: steps,
    visitedCells: visitedCells.size,
    claims,
    visitLog,
    routeLog,
    failedMoves,
    scanRadius: config.scanRadius,
    bounds: config.bounds
  }
}

module.exports = { runScoutEpisode }
