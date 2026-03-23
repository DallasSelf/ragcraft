const { runScenario } = require('./runScenario')
const { retrieveDistilledMemories } = require('../rag/distilledMemory')
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const CONTAINER_BLOCK_KEYS = ['chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box']

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeItemName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function scenarioAlias(value) {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'keyfinder' || v === 'key_finder' || v === 'key-finder') return 'key'
  if (v === 'scan' || v === 'survey') return 'scout'
  return v
}

function hasItemInInventory(bot, targetItem) {
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') {
    return { found: false, count: 0 }
  }

  const itemKey = normalizeItemName(targetItem)
  const items = bot.inventory.items()
  let count = 0
  for (const item of items) {
    const names = [item.name, item.displayName]
      .filter(Boolean)
      .map(v => normalizeItemName(v))
    if (names.some(name => name.includes(itemKey) || itemKey.includes(name))) {
      count += Number(item.count || 0)
    }
  }

  return { found: count > 0, count }
}

function memoryText(memory) {
  const parts = [
    memory.text,
    memory.description,
    memory.action_recipe,
    memory.type,
    ...(Array.isArray(memory.goal_tags) ? memory.goal_tags : [])
  ]

  const toolIds = Array.isArray(memory.entities?.tool)
    ? memory.entities.tool.map(t => (t && t.id ? String(t.id) : '')).filter(Boolean)
    : []
  parts.push(...toolIds)

  return parts
    .filter(Boolean)
    .map(v => String(v).toLowerCase())
    .join(' ')
}

function claimLocation(memory) {
  const fromEntities = Array.isArray(memory.entities?.location) ? memory.entities.location[0] : null
  if (fromEntities && Number.isFinite(fromEntities.x) && Number.isFinite(fromEntities.z)) {
    return fromEntities
  }
  return null
}

function findScoutReconMatches(targetText) {
  const targetKey = normalizeItemName(targetText)
  const memories = retrieveDistilledMemories('scout_area_v1') || []

  const exact = memories.filter(m => memoryText(m).includes(targetKey))
  const knownLocations = memories.filter(m => {
    const tags = Array.isArray(m.goal_tags) ? m.goal_tags.map(t => String(t).toLowerCase()) : []
    return tags.includes('tool') || tags.includes('supply') || tags.includes('interaction') || tags.includes('interactable') || tags.includes('landmark') || tags.includes('hazard') || tags.includes('door')
  })

  return {
    exact,
    knownLocations,
    exactLocations: exact.map(claimLocation).filter(Boolean).slice(0, 5),
    knownSearchLocations: knownLocations.map(claimLocation).filter(Boolean).slice(0, 5)
  }
}

function pickScenarioForSearch(taskType, targetText) {
  const target = String(targetText || '').toLowerCase()
  if (target.includes('lever_room') || target.includes('lever')) return 'lever'
  if (target.includes('maze')) return 'maze'
  if (taskType === 'acquire_object' && target.includes('key')) return 'key'
  return 'scout'
}

function buildRunLabel(task, commandText) {
  const base = `${task.taskType}_${task.scenario || 'auto'}_${Date.now()}`
  const slug = String(base).replace(/[^a-zA-Z0-9_-]+/g, '_')
  const preview = String(commandText || '').trim().slice(0, 32).replace(/\s+/g, '_')
  return `nl_${slug}${preview ? `_${preview}` : ''}`
}

function pickSourceUsed(chosenPath = []) {
  if (chosenPath.includes('inventory hit')) return 'inventory'
  if (chosenPath.includes('scout memory hit')) return 'distilled_scout_recon'
  if (chosenPath.includes('known memory location hit')) return 'known_memory_locations'
  if (chosenPath.includes('scout requested')) return 'scout_requested'
  if (chosenPath.includes('fallback search')) return 'fallback_search'
  return 'unavailable'
}

function buildCandidateHints(scoutRecon = {}) {
  const exact = Array.isArray(scoutRecon.exact) ? scoutRecon.exact.slice(0, 5) : []
  return {
    exactLocationHints: Array.isArray(scoutRecon.exactLocations) ? scoutRecon.exactLocations : [],
    knownLocationHints: Array.isArray(scoutRecon.knownSearchLocations) ? scoutRecon.knownSearchLocations : [],
    sampleClaims: exact.map(m => ({
      id: m.id || null,
      type: m.type || null,
      scenarioId: m.scenarioId || m.task_id || null,
      location: claimLocation(m)
    }))
  }
}

function resolveVerificationState(taskType, beforeInventory, afterInventory, scoutRecon, runResult) {
  if (beforeInventory && beforeInventory.found) return 'inventory_confirmed'

  if (taskType === 'acquire_object' && afterInventory && afterInventory.found) {
    return 'acquired'
  }

  if ((taskType === 'find_object' || taskType === 'acquire_object') && afterInventory && afterInventory.found) {
    return 'inventory_confirmed'
  }

  if (runResult && runResult.result && runResult.result.found === true) {
    return 'observed_in_world'
  }

  const hasMemoryHints =
    (Array.isArray(scoutRecon.exactLocations) && scoutRecon.exactLocations.length > 0) ||
    (Array.isArray(scoutRecon.knownSearchLocations) && scoutRecon.knownSearchLocations.length > 0)
  if (hasMemoryHints) return 'memory_hint_only'

  return 'unverified'
}

function normalizeLocationHint(loc) {
  if (!loc || !Number.isFinite(loc.x) || !Number.isFinite(loc.z)) return null
  return {
    x: Math.round(loc.x),
    y: Number.isFinite(loc.y) ? Math.round(loc.y) : null,
    z: Math.round(loc.z)
  }
}

async function gotoHint(bot, hint, fallbackY) {
  if (!bot || !hint || !Number.isFinite(hint.x) || !Number.isFinite(hint.z)) return false
  const targetY = Number.isFinite(hint.y) ? hint.y : fallbackY
  if (!Number.isFinite(targetY)) return false

  try {
    const g = new goals.GoalNear(hint.x, targetY, hint.z, 2)
    const movePromise = bot.pathfinder.goto(g)
    const timeout = wait(7000).then(() => 'timeout')
    const moved = await Promise.race([movePromise.then(() => 'ok'), timeout])
    if (moved === 'timeout') {
      bot.pathfinder.stop()
      return false
    }
    return true
  } catch {
    bot.pathfinder.stop()
    return false
  }
}

function blockMatchesTarget(blockName, targetKey) {
  const name = String(blockName || '').toLowerCase()
  if (!name || !targetKey) return false
  const normalized = targetKey.replace(/\s+/g, '_')
  return name.includes(normalized) || normalized.includes(name)
}

function verifyLocationByBlocks(bot, targetKey, radius = 6) {
  if (!bot || !bot.findBlocks) return false
  const matches = bot.findBlocks({
    matching: block => block && blockMatchesTarget(block.name, targetKey),
    maxDistance: radius,
    count: 8
  })
  return Array.isArray(matches) && matches.length > 0
}

function itemFrameDisplayedItemName(frame) {
  const metadata = Array.isArray(frame?.metadata) ? frame.metadata : []
  for (const entry of metadata) {
    if (!entry) continue
    if (typeof entry.name === 'string' && entry.name) return String(entry.name).toLowerCase()
    if (entry.value && typeof entry.value === 'object') {
      const candidate = entry.value.name || entry.value.displayName || entry.value.itemName
      if (candidate) return String(candidate).toLowerCase()
    }
  }
  return ''
}

function verifyByItemFrame(bot, targetKey, radius = 7) {
  if (!bot || !bot.entities) return false
  const origin = bot.entity?.position
  if (!origin) return false
  const entities = Object.values(bot.entities)
  return entities.some(entity => {
    if (!entity || !['item_frame', 'glow_item_frame'].includes(entity.name)) return false
    if (origin.distanceTo(entity.position) > radius) return false
    const displayed = itemFrameDisplayedItemName(entity)
    return displayed && blockMatchesTarget(displayed, targetKey)
  })
}

async function inspectNearbyContainersForItem(bot, targetKey, radius = 7) {
  if (!bot || !bot.findBlocks) return false

  const positions = bot.findBlocks({
    matching: block => block && CONTAINER_BLOCK_KEYS.some(key => String(block.name || '').includes(key)),
    maxDistance: radius,
    count: 8
  })

  for (const pos of positions) {
    const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
    if (!block) continue
    try {
      const opened = await bot.openChest(block)
      const items = Array.isArray(opened.containerItems()) ? opened.containerItems() : []
      const found = items.some(item => {
        const name = String(item?.name || item?.displayName || '').toLowerCase()
        return blockMatchesTarget(name, targetKey)
      })
      opened.close()
      if (found) return true
    } catch {
      // Ignore container open failures and continue scanning.
    }
  }

  return false
}

async function verifyFromHintCandidates({ bot, taskType, targetKey, hints }) {
  const ordered = [
    ...(Array.isArray(hints?.exactLocationHints) ? hints.exactLocationHints : []),
    ...(Array.isArray(hints?.knownLocationHints) ? hints.knownLocationHints : [])
  ]
    .map(normalizeLocationHint)
    .filter(Boolean)

  const seen = new Set()
  const uniqueHints = ordered.filter(h => {
    const k = `${h.x}:${h.y ?? 'na'}:${h.z}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 4)

  for (const hint of uniqueHints) {
    await gotoHint(bot, hint, Math.round(bot.entity.position.y))

    if (taskType === 'find_location') {
      if (verifyLocationByBlocks(bot, targetKey, 7)) {
        return { verified: true, state: 'observed_in_world' }
      }
      continue
    }

    if (verifyByItemFrame(bot, targetKey, 7)) {
      return { verified: true, state: 'item_frame_confirmed' }
    }

    const containerConfirmed = await inspectNearbyContainersForItem(bot, targetKey, 7)
    if (containerConfirmed) {
      return { verified: true, state: 'container_confirmed' }
    }

    if (verifyLocationByBlocks(bot, targetKey, 6)) {
      return { verified: true, state: 'observed_in_world' }
    }
  }

  return { verified: false, state: 'memory_hint_only' }
}

async function executeTask({ bot, task, commandText }) {
  const mode = task.memoryMode || 'distilled'

  if (task.taskType === 'run_scenario' || task.taskType === 'scout_area') {
    const scenario = scenarioAlias(task.scenario)
    const runLabel = buildRunLabel(task, commandText)
    const runResult = await runScenario(bot, scenario, {
      mode,
      runLabel,
      nlTask: task
    })
    return {
      ok: true,
      route: {
        taskType: task.taskType,
        scenario,
        memoryMode: mode,
        chosenPath: ['existing scenario executor'],
        priority: task.priority,
        successCondition: task.successCondition
      },
      runResult
    }
  }

  if (task.taskType === 'find_object' || task.taskType === 'find_location' || task.taskType === 'acquire_object') {
    const targetItem = normalizeItemName(task.targetObject || task.targetItem || task.targetLocation)
    const checks = []
    const chosenPath = []
    const inventoryRelevant = task.taskType !== 'find_location'

    let beforeInventory = { found: false, count: 0 }
    if (inventoryRelevant) {
      beforeInventory = hasItemInInventory(bot, targetItem)
      checks.push({ source: 'inventory', ...beforeInventory })
      if (beforeInventory.found) {
        chosenPath.push('inventory hit')
        return {
          ok: true,
          route: {
            taskType: task.taskType,
            targetItem,
            decision: 'already_in_inventory',
            memoryMode: mode,
            chosenPath
          },
          evidence: {
            sourceUsed: 'inventory',
            candidateHints: { exactLocationHints: [], knownLocationHints: [], sampleClaims: [] },
            verificationState: 'inventory_confirmed',
            verificationNote: 'Target confirmed in current inventory.'
          },
          checks,
          runResult: null
        }
      }
    } else {
      checks.push({ source: 'inventory', skipped: true, reason: 'not_relevant_for_location' })
    }

    let scoutRecon = { exact: [], knownLocations: [], exactLocations: [], knownSearchLocations: [] }
    if (mode !== 'raw') {
      scoutRecon = findScoutReconMatches(targetItem)
      checks.push({
        source: 'distilled_scout_recon',
        exactMatches: scoutRecon.exact.length,
        exactLocations: scoutRecon.exactLocations.length
      })
      if (scoutRecon.exact.length > 0 || scoutRecon.exactLocations.length > 0) {
        chosenPath.push('scout memory hit')
      }
    } else {
      checks.push({ source: 'distilled_scout_recon', skipped: true, reason: 'raw_mode' })
    }

    checks.push({
      source: 'known_memory_locations',
      locationHints: scoutRecon.knownSearchLocations.length
    })
    if (scoutRecon.knownSearchLocations.length > 0) {
      chosenPath.push('known memory location hit')
    }

    const scenario = pickScenarioForSearch(task.taskType, targetItem)
    if (scenario === 'scout') {
      chosenPath.push('scout requested')
    }
    if (scoutRecon.exactLocations.length === 0 && scoutRecon.knownSearchLocations.length === 0) {
      chosenPath.push('fallback search')
    }

    const runLabel = buildRunLabel(task, commandText)
    const runResult = await runScenario(bot, scenario, {
      mode,
      runLabel,
      nlTask: task,
      targetItem,
      // These are candidate hints only; execution logic remains in existing scenarios.
      memoryHints: {
        exactItemLocations: scoutRecon.exactLocations,
        knownSearchLocations: scoutRecon.knownSearchLocations
      }
    })

    const afterInventory = inventoryRelevant ? hasItemInInventory(bot, targetItem) : { found: false, count: 0 }
    const verificationState = resolveVerificationState(task.taskType, beforeInventory, afterInventory, scoutRecon, runResult)
    const sourceUsed = pickSourceUsed(chosenPath)
    const candidateHints = buildCandidateHints(scoutRecon)
    let finalVerificationState = verificationState

    if (verificationState === 'memory_hint_only') {
      const postCheck = await verifyFromHintCandidates({
        bot,
        taskType: task.taskType,
        targetKey: targetItem,
        hints: candidateHints
      })

      if (postCheck.verified) {
        finalVerificationState = postCheck.state
      }
    }

    const finalInventory = inventoryRelevant ? hasItemInInventory(bot, targetItem) : { found: false, count: 0 }
    if (task.taskType === 'acquire_object' && finalInventory.found) {
      finalVerificationState = 'acquired'
    }

    const verificationNote = finalVerificationState === 'memory_hint_only'
      ? 'Result currently based on memory hints/candidate locations; not directly observed or acquired yet.'
      : finalVerificationState === 'unverified'
        ? 'No direct confirmation found yet; treated as unverified.'
        : finalVerificationState === 'acquired'
          ? 'Target appears acquired in inventory after execution.'
          : finalVerificationState === 'inventory_confirmed'
            ? 'Target confirmed in inventory.'
            : finalVerificationState === 'container_confirmed'
              ? 'Target confirmed by opening and inspecting nearby container contents.'
              : finalVerificationState === 'item_frame_confirmed'
                ? 'Target confirmed by reading nearby item frame display.'
                : 'Target confirmed by direct world observation.'

    return {
      ok: true,
      route: {
        taskType: task.taskType,
        scenario,
        targetItem,
        memoryMode: mode,
        decision: 'search_routed_to_existing_executor',
        chosenPath,
        priority: task.priority,
        successCondition: task.successCondition
      },
      evidence: {
        sourceUsed,
        candidateHints,
        verificationState: finalVerificationState,
        verificationNote
      },
      checks,
      runResult
    }
  }

  return {
    ok: false,
    error: 'Unsupported task type. Supported: run_scenario, scout_area, find_object, find_location, acquire_object.'
  }
}

module.exports = {
  executeTask
}
