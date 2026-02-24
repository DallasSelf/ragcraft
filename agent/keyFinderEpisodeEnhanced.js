const { v4: uuidv4 } = require('uuid')
const { once } = require('events')
const { goals, Movements } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const mcDataLoader = require('minecraft-data')
const { keyFinderConfig } = require('../scenarios/keyFinderConfig')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestKeyFinderAttempt } = require('../rag/kb')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { ragRetrieveHybrid } = require('../rag/retrieval')
const { MetricsCollector } = require('../rag/eval/metrics')
const { resolveMemoryMode } = require('./memoryModes')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const searchConfig = keyFinderConfig.search || {}
const SEARCH_STEP = searchConfig.step || 4
const STEPS_PER_ATTEMPT = searchConfig.stepsPerAttempt || 12
const DETECTION_RADIUS = searchConfig.detectionRadius || 3
const MEMORY_BIAS_RADIUS = searchConfig.memoryBiasRadius || 6
const MIN_STEPS_BEFORE_KEY = searchConfig.minStepsBeforeKey || 2
const MOVE_TIMEOUT_MS = searchConfig.moveTimeoutMs || 8000
const MAX_MEMORY_TARGETS = searchConfig.maxMemoryTargets || 5
const SEARCH_BOUNDS = searchConfig.bounds || {
  minX: keyFinderConfig.keyItemPos.x - 8,
  maxX: keyFinderConfig.keyItemPos.x + 8,
  minZ: keyFinderConfig.keyItemPos.z - 8,
  maxZ: keyFinderConfig.keyItemPos.z + 8,
  y: keyFinderConfig.keyItemPos.y
}
const ENTITY_SPOT_RADIUS = searchConfig.entitySpotRadius || 12
const ENTITY_APPROACH_RADIUS = searchConfig.entityApproachRadius || 1.4
const FORCED_KEY_STEP = searchConfig.forceKeyStep || 0

let cachedSearchMovements = null
let cachedMovementsVersion = null

function ensureSearchMovements(bot) {
  if (!cachedSearchMovements || cachedMovementsVersion !== bot.version) {
    const mcData = mcDataLoader(bot.version)
    const movements = new Movements(bot, mcData)
    movements.canDig = false
    movements.allow1by1towers = false
    movements.allowParkour = false
    movements.canSwim = false
    movements.scafoldingBlocks = []
    cachedSearchMovements = movements
    cachedMovementsVersion = bot.version
  }

  bot.pathfinder.setMovements(cachedSearchMovements)
}

function cellKey(pos) {
  return `${Math.round(pos.x / SEARCH_STEP)}_${Math.round(pos.z / SEARCH_STEP)}`
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function snapToSearchPlane(pos = {}) {
  const y = SEARCH_BOUNDS.y ?? keyFinderConfig.spawnPos.y
  const snappedX = Math.round(pos.x / SEARCH_STEP) * SEARCH_STEP
  const snappedZ = Math.round(pos.z / SEARCH_STEP) * SEARCH_STEP
  return {
    x: clamp(snappedX, SEARCH_BOUNDS.minX, SEARCH_BOUNDS.maxX),
    y,
    z: clamp(snappedZ, SEARCH_BOUNDS.minZ, SEARCH_BOUNDS.maxZ)
  }
}

function randomSearchPoint() {
  const rangeX = SEARCH_BOUNDS.maxX - SEARCH_BOUNDS.minX
  const rangeZ = SEARCH_BOUNDS.maxZ - SEARCH_BOUNDS.minZ
  const randX = SEARCH_BOUNDS.minX + Math.random() * rangeX
  const randZ = SEARCH_BOUNDS.minZ + Math.random() * rangeZ
  return snapToSearchPlane({ x: randX, z: randZ })
}

function extractCoordsFromText(text) {
  if (!text) return null
  const match = text.match(/(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/)
  if (!match) return null
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3])
  }
}

function parseMemoryHints(memories = []) {
  const hints = { prefer: [], avoid: [] }
  for (const mem of memories) {
    if (mem.type !== 'key_finder_distilled' || !mem.text) continue
    const coords = extractCoordsFromText(mem.text)
    if (!coords) continue
    if (mem.text.startsWith('Key found')) {
      hints.prefer.push(coords)
    } else if (mem.text.startsWith('Key not found')) {
      hints.avoid.push(coords)
    }
  }
  return hints
}

function scoreMemoryTarget(memory) {
  if (!memory || typeof memory.text !== 'string') return 0
  const baseScore =
    typeof memory.boostedScore === 'number'
      ? memory.boostedScore
      : typeof memory.score === 'number'
        ? memory.score
        : typeof memory.similarity === 'number'
          ? memory.similarity
          : 0
  const successBonus = memory.text.startsWith('Key found') ? 0.6 : 0
  return baseScore + successBonus
}

function buildMemoryTargetQueue(memories = [], limit = MAX_MEMORY_TARGETS) {
  const candidates = memories
    .filter(mem => mem && mem.type === 'key_finder_distilled' && typeof mem.text === 'string')
    .map(mem => ({
      pos: extractCoordsFromText(mem.text),
      success: mem.text.startsWith('Key found'),
      score: scoreMemoryTarget(mem)
    }))
    .filter(entry => entry.pos)
    .sort((a, b) => b.score - a.score)

  const unique = []
  const seenCells = new Set()
  for (const candidate of candidates) {
    const key = cellKey(candidate.pos)
    if (seenCells.has(key)) continue
    unique.push(candidate)
    seenCells.add(key)
    if (unique.length >= limit) break
  }

  return unique
}

function nextMemoryTarget(queue, visitedCells) {
  if (!Array.isArray(queue)) return null
  while (queue.length > 0) {
    const candidate = queue.shift()
    if (!candidate || !candidate.pos) continue
    if (visitedCells.has(cellKey(candidate.pos))) continue
    return candidate
  }
  return null
}

function distance2D(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0)
  const dz = (a?.z || 0) - (b?.z || 0)
  return Math.sqrt(dx * dx + dz * dz)
}

function chooseSearchWaypoint(memoryHintsOrMemories, visitedCells, opts = {}) {
  const hints =
    memoryHintsOrMemories && typeof memoryHintsOrMemories === 'object' && Array.isArray(memoryHintsOrMemories.prefer)
      ? memoryHintsOrMemories
      : parseMemoryHints(Array.isArray(memoryHintsOrMemories) ? memoryHintsOrMemories : [])

  if (!opts.skipPreferred) {
    const preferred = hints.prefer.find(pt => !visitedCells.has(cellKey(pt)))
    if (preferred) {
      return snapToSearchPlane(preferred)
    }
  }

  let attempts = 0
  while (attempts < 40) {
    const candidate = randomSearchPoint()
    const key = cellKey(candidate)
    if (visitedCells.has(key)) {
      attempts += 1
      continue
    }

    const avoidList = opts.customAvoid || hints.avoid
    const nearAvoid = avoidList.some(pt => distance2D(pt, candidate) <= MEMORY_BIAS_RADIUS)
    const avoidTarget = opts.avoidNear
    const avoidCenter = avoidTarget?.center
    const avoidRadius = avoidTarget?.radius || 0
    const nearForcedAvoid = avoidCenter ? distance2D(candidate, avoidCenter) <= avoidRadius : false

    if (!nearAvoid && !nearForcedAvoid) {
      return candidate
    }
    attempts += 1
  }

  return randomSearchPoint()
}

function hasKeyInInventory(bot) {
  const expectedId = keyFinderConfig.keyItem.id
  const custom = keyFinderConfig.keyItem.customName?.toLowerCase()
  return bot.inventory.items().some(item => {
    if (!item) return false
    if (item.name !== expectedId) return false
    if (!custom) return true
    const label = (item.customName || item.displayName || '').toLowerCase()
    return label.includes(custom)
  })
}

function findKeyItem(bot) {
  const expectedId = keyFinderConfig.keyItem.id
  return bot.inventory.items().find(item => item && item.name === expectedId)
}

function replacePlayerPlaceholder(cmd, bot) {
  if (!cmd) return null
  return cmd.replace('__PLAYER__', bot.username)
}

async function ensureBotAtSpawn(bot, logger) {
  const spawn = keyFinderConfig.spawnPos
  if (!spawn) return
  const dist = bot.entity.position.distanceTo(new Vec3(spawn.x, spawn.y, spawn.z))
  if (dist < 1) return
  const cmd = `/tp ${bot.username} ${spawn.x} ${spawn.y} ${spawn.z}`
  bot.chat(cmd)
  logger.log('key_spawn_reset', { cmd })
  await wait(350)
}

async function resetScenarioWorld(bot, logger) {
  const cmds = [
    keyFinderConfig.commands.clearLooseKeys,
    keyFinderConfig.commands.clearLockedChest,
    keyFinderConfig.commands.rebuildLockedChest,
    replacePlayerPlaceholder(keyFinderConfig.commands.clearKeyTemplate, bot),
    keyFinderConfig.commands.summonKeyItem
  ].filter(Boolean)

  for (const cmd of cmds) {
    bot.chat(cmd)
    logger.log('key_reset_command', { cmd })
    await wait(300)
  }
}

function buildGoal(pos, opts = {}) {
  const x = Math.round(pos.x)
  const z = Math.round(pos.z)
  const hasY = typeof pos.y === 'number'
  const radius = opts.radius || 0

  if (hasY && radius > 0) {
    return new goals.GoalNear(x, Math.round(pos.y), z, radius)
  }

  if (hasY) {
    return new goals.GoalBlock(x, Math.round(pos.y), z)
  }

  if (radius > 0) {
    return new goals.GoalNearXZ(x, z, radius)
  }

  return new goals.GoalXZ(x, z)
}

function createMoveTimeout() {
  let timer = null
  let rejectFn = null

  const promise = new Promise((_, reject) => {
    rejectFn = reject
    timer = setTimeout(() => {
      const err = new Error('move_timeout')
      err.code = 'move_timeout'
      reject(err)
    }, MOVE_TIMEOUT_MS)
  })

  return {
    promise,
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      rejectFn = null
    }
  }
}

async function waitForPathStop(bot) {
  try {
    await once(bot, 'path_stop')
  } catch (err) {
    // ignore emitter teardown issues
  }
}

async function cancelActiveMove(bot, movePromise) {
  const awaitingStop = bot.pathfinder.isMoving() ? waitForPathStop(bot) : Promise.resolve()
  bot.pathfinder.stop()
  try {
    await movePromise
  } catch (err) {
    // swallow rejection from cancellation
  }
  await awaitingStop
}

async function gotoPosition(bot, pos, label, actions, opts = {}) {
  const goal = buildGoal(pos, opts)
  const movePromise = bot.pathfinder.goto(goal)
  const timeout = createMoveTimeout()
  const actionType = opts.actionType || 'search_move'

  try {
    await Promise.race([movePromise, timeout.promise])
    timeout.cancel()
    actions.push({ type: actionType, label, pos })
    return true
  } catch (err) {
    timeout.cancel()
    if (err.code === 'move_timeout') {
      await cancelActiveMove(bot, movePromise)
      actions.push({ type: `${actionType}_timeout`, label, pos })
    } else {
      actions.push({ type: `${actionType}_error`, label, pos, error: err.message })
    }
    return false
  }
}

function inDetectionRange(botPos, target, radius) {
  if (!botPos || !target) return false
  const dx = botPos.x - target.x
  const dy = botPos.y - target.y
  const dz = botPos.z - target.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= radius
}

async function waitForKeyPickup(bot) {
  const timeoutMs = 6000
  const started = Date.now()
  while (!hasKeyInInventory(bot) && Date.now() - started < timeoutMs) {
    await wait(200)
  }
  return hasKeyInInventory(bot)
}

function findKeyEntity(bot, radius = ENTITY_SPOT_RADIUS) {
  const entities = Object.values(bot.entities || {})
  let best = null
  let bestDistance = Infinity

  for (const entity of entities) {
    if (!entity || entity.name !== 'item' || !entity.position) continue
    const distance = entity.position.distanceTo(bot.entity.position)
    if (radius && distance > radius) continue
    if (distance < bestDistance) {
      best = entity
      bestDistance = distance
    }
  }

  return best
}

async function equipKey(bot, logger, actions) {
  const item = findKeyItem(bot)
  if (!item) {
    actions.push({ type: 'equip_missing_key' })
    return false
  }
  try {
    await bot.equip(item, 'hand')
    actions.push({ type: 'equip_key', item: item.displayName || item.name })
    await wait(200)
    return true
  } catch (err) {
    actions.push({ type: 'equip_error', error: err.message })
    logger.log('key_equip_error', { error: err.message })
    return false
  }
}

async function unlockChest(bot, chestPos, actions) {
  const block = bot.blockAt(new Vec3(chestPos.x, chestPos.y, chestPos.z))
  if (!block) {
    actions.push({ type: 'lock_missing', pos: chestPos })
    return false
  }

  const target = block.position.offset(0.5, 0.5, 0.5)
  await bot.lookAt(target, true)
  await wait(120)

  try {
    const chest = await bot.openChest(block)
    actions.push({ type: 'unlock_open', pos: chestPos })
    await wait(200)
    chest.close()
    actions.push({ type: 'unlock_close', pos: chestPos })
    return true
  } catch (err) {
    actions.push({ type: 'unlock_error', pos: chestPos, error: err.message })
    return false
  }
}

async function runKeyFinderEpisodeEnhanced(bot, logger, options = {}) {
  const scenarioId = keyFinderConfig.scenarioId
  const runId = uuidv4()
  const mode = options.mode || 'distilled'
  const memoryMode = resolveMemoryMode(mode)

  const metrics = new MetricsCollector(runId, scenarioId, mode)

  logger.log('key_finder_episode_start', { runId, scenarioId, mode })

  const maxAttempts = keyFinderConfig.maxAttempts || 6
  let attempts = 0
  let found = false

  await resetScenarioWorld(bot, logger)
  await ensureBotAtSpawn(bot, logger)
  ensureSearchMovements(bot)
  metrics.snapshotStore()

  while (attempts < maxAttempts && !found) {
    const retrievalStart = Date.now()

    const memories = await ragRetrieveHybrid({
      scenarioId,
      observation: { position: bot.entity.position },
      topK: 5,
      includeDistilled: memoryMode.includeDistilled,
      includeRaw: memoryMode.includeRaw
    })

    const retrievalLatency = Date.now() - retrievalStart
    const memoryHints = parseMemoryHints(memories)
    const memoryTargetQueue = buildMemoryTargetQueue(memories)

    metrics.recordRetrieval({
      queryText: `key search near position ${bot.entity.position.x} ${bot.entity.position.y} ${bot.entity.position.z}`,
      results: memories,
      latencyMs: retrievalLatency,
      source: memoryMode.dataset
    })

    const actions = []
    const searchPath = []
    const visitedCells = new Set()
    let obtainedKey = hasKeyInInventory(bot)
    let unlocked = false
    let steps = 0
    let lastKnownKeyPos = null
    let lastKeyApproachStep = -1

    logger.log('key_attempt', {
      runId,
      attemptIndex: attempts,
      searchBounds: SEARCH_BOUNDS,
      memoryCount: memories.length,
      retrievalLatency,
      memoryTargets: memoryTargetQueue.map(target => ({
        pos: target.pos,
        success: target.success,
        score: Number.isFinite(target.score) ? Number(target.score.toFixed(3)) : target.score
      }))
    })

    while (steps < STEPS_PER_ATTEMPT && !obtainedKey) {
      const stepNumber = steps + 1
      const avoidNear = stepNumber <= MIN_STEPS_BEFORE_KEY
        ? { center: keyFinderConfig.keyItemPos, radius: DETECTION_RADIUS * 3 }
        : null

      let waypoint
      if (!obtainedKey && FORCED_KEY_STEP > 0 && stepNumber === FORCED_KEY_STEP) {
        waypoint = snapToSearchPlane(keyFinderConfig.keyItemPos)
        actions.push({ type: 'search_forced_key_waypoint', step: stepNumber, pos: waypoint })
      } else {
        const memoryTarget = nextMemoryTarget(memoryTargetQueue, visitedCells)
        if (memoryTarget) {
          waypoint = snapToSearchPlane(memoryTarget.pos)
          actions.push({
            type: 'memory_target_selected',
            step: stepNumber,
            pos: waypoint,
            successBias: memoryTarget.success,
            score: Number.isFinite(memoryTarget.score)
              ? Number(memoryTarget.score.toFixed(3))
              : memoryTarget.score
          })
        } else {
          waypoint = chooseSearchWaypoint(memoryHints, visitedCells, { avoidNear })
        }
      }

      const successMove = await gotoPosition(bot, waypoint, `step_${stepNumber}`, actions)
      visitedCells.add(cellKey(waypoint))
      if (successMove) {
        searchPath.push({ x: waypoint.x, y: waypoint.y, z: waypoint.z })
      }

      const botPos = bot.entity.position
      let spottedEntity = null

      if (!obtainedKey) {
        spottedEntity = findKeyEntity(bot, ENTITY_SPOT_RADIUS)
        if (spottedEntity) {
          lastKnownKeyPos = {
            x: spottedEntity.position.x,
            y: spottedEntity.position.y,
            z: spottedEntity.position.z
          }
          actions.push({
            type: 'key_spotted',
            pos: lastKnownKeyPos,
            distance: spottedEntity.position.distanceTo(bot.entity.position)
          })
        }
      }

      if (!obtainedKey && lastKnownKeyPos && lastKeyApproachStep !== steps) {
        lastKeyApproachStep = steps
        const label = spottedEntity ? `key_entity_${stepNumber}` : `key_memory_${stepNumber}`
        const approached = await gotoPosition(bot, lastKnownKeyPos, label, actions, {
          radius: ENTITY_APPROACH_RADIUS,
          actionType: 'key_move'
        })

        if (approached) {
          const pickupStart = Date.now()
          const pickupSuccess = await waitForKeyPickup(bot)
          actions.push({
            type: 'key_pickup',
            success: pickupSuccess,
            elapsedMs: Date.now() - pickupStart
          })
          obtainedKey = pickupSuccess
          if (pickupSuccess) {
            lastKnownKeyPos = null
          } else {
            actions.push({ type: 'key_pickup_failed', pos: lastKnownKeyPos })
          }
        } else {
          actions.push({ type: 'key_entity_unreachable', pos: lastKnownKeyPos })
        }
      } else if (
        !obtainedKey &&
        stepNumber >= MIN_STEPS_BEFORE_KEY &&
        inDetectionRange(botPos, keyFinderConfig.keyItemPos, DETECTION_RADIUS)
      ) {
        actions.push({ type: 'key_location_empty', pos: keyFinderConfig.keyItemPos })
      }

      steps += 1
    }

    if (obtainedKey) {
      const chestMove = await gotoPosition(bot, keyFinderConfig.lockedChest, 'locked_chest', actions)
      if (chestMove) {
        const equipped = await equipKey(bot, logger, actions)
        if (equipped) {
          unlocked = await unlockChest(bot, keyFinderConfig.lockedChest, actions)
        }
      } else {
        actions.push({ type: 'chest_move_failed' })
      }
    } else {
      actions.push({
        type: 'key_not_found_after_search',
        stepsTaken: steps,
        visitedCells: visitedCells.size
      })
    }

    found = unlocked

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      targetPos: keyFinderConfig.lockedChest,
      keyPos: keyFinderConfig.keyItemPos,
      searchPath,
      visitedCells: Array.from(visitedCells),
      actions,
      obtainedKey,
      success: found,
      timestamp: Date.now()
    }

    await ingestKeyFinderAttempt(attemptLog)

    const distilled = await distillMemoryUnits(attemptLog, {
      distillStyle: memoryMode.distillStyle
    })
    await ingestDistilledMemory(distilled)

    logger.log('key_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: found,
      stepsTaken: steps,
      distilledAdded: distilled.length
    })

    attempts += 1
    metrics.snapshotStore()

    if (!found) {
      await resetScenarioWorld(bot, logger)
      await ensureBotAtSpawn(bot, logger)
      ensureSearchMovements(bot)
      await wait(500)
    }
  }

  metrics.recordOutcome({
    success: found,
    attempts
  })

  metrics.save()

  logger.log('key_finder_episode_end', {
    runId,
    scenarioId,
    attempts,
    found
  })

  return { runId, scenarioId, attempts, found }
}

module.exports = { runKeyFinderEpisodeEnhanced }
