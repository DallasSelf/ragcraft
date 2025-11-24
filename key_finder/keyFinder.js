const { v4: uuidv4 } = require('uuid')
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { keyFinderConfig } = require('../scenarios/keyFinderConfig')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestKeyFinderAttempt } = require('../rag/kb')
const {
  ingestDistilledMemory,
  retrieveDistilledMemories
} = require('../rag/distilledMemory')
const {
  saveEvent,
  summarizeEvent,
  embedEvent,
  storeMemory,
  getRelevantMemories
} = require('./memory/episodicMemory')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function chooseKeySearchPlan(defaultChestPos, scenarioId, distilledMemories = []) {
  const successMemory = distilledMemories.find(
    m => m.type === 'key_finder_distilled' && m.text && m.text.startsWith('Key found')
  )

  if (successMemory) {
    const match = successMemory.text.match(/\(([-0-9]+),([-0-9]+),([-0-9]+)\)/)
    if (match) {
      const chestPos = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }
      return { chestPos, source: 'distilled_success', distilledMemories }
    }
  }

  return { chestPos: defaultChestPos, source: 'default', distilledMemories }
}

async function resetChestState(bot, logger) {
  const pos = keyFinderConfig.chestBlock
  if (!pos) return
  const blockState = keyFinderConfig.resetBlockState || 'chest'
  const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} ${blockState}`
  bot.chat(cmd)
  logger.log('key_reset_chest', { cmd })
  await wait(400)
}

async function moveToChest(bot, chestPos) {
  const goal = new goals.GoalBlock(chestPos.x, chestPos.y, chestPos.z)
  await bot.pathfinder.goto(goal)
}

async function inspectChest(bot, chestPos, actions) {
  const target = new Vec3(chestPos.x, chestPos.y, chestPos.z)
  const block = bot.blockAt(target)
  if (!block) {
    actions.push({ type: 'missing_chest', pos: chestPos })
    return { chest: null, success: false }
  }
  const chest = await bot.openChest(block)
  actions.push({ type: 'open_chest', pos: chestPos })
  return { chest, success: true }
}

async function executeSearch(bot, chestPos, logger) {
  const actions = []
  let foundKey = false
  let chest = null

  try {
    await moveToChest(bot, chestPos)
    actions.push({ type: 'move', pos: chestPos })

    const check = await inspectChest(bot, chestPos, actions)
    if (!check.chest) {
      return { actions, success: false }
    }

    chest = check.chest
    const items = chest.containerItems()
    const keyItem = items.find(item => item && item.name === 'stick' && item.customName === 'Key')

    if (keyItem) {
      await bot.tossStack(keyItem)
      actions.push({ type: 'found_key', item: keyItem.name })
      foundKey = true
    } else {
      actions.push({ type: 'no_key_found' })
    }
  } catch (err) {
    logger.log('key_search_error', { error: err.message })
    actions.push({ type: 'error', message: err.message })
  } finally {
    if (chest) chest.close()
  }

  return { actions, success: foundKey }
}

async function recordMemory(attemptLog) {
  const rawEvent = {
    scenarioId: attemptLog.scenarioId,
    eventType: 'key_search_attempt',
    timestamp: attemptLog.timestamp,
    runId: attemptLog.runId,
    targetPos: attemptLog.targetPos,
    actions: attemptLog.actions,
    attemptIndex: attemptLog.attemptIndex,
    result: attemptLog.success ? 'success' : 'fail'
  }

  await saveEvent(rawEvent)
  const summary = await summarizeEvent(rawEvent)
  const embedding = await embedEvent(summary)

  await storeMemory({
    scenarioId: attemptLog.scenarioId,
    memoryType: 'key_search',
    rawEvent,
    summary,
    embedding
  })
}

async function runKeyFinderEpisode(bot, logger) {
  const scenarioId = keyFinderConfig.scenarioId
  const runId = uuidv4()
  const maxAttempts = keyFinderConfig.maxAttempts || 5
  let attemptIndex = 0
  let solved = false

  logger.log('key_episode_start', { scenarioId, runId, maxAttempts })

  while (attemptIndex < maxAttempts && !solved) {
    await resetChestState(bot, logger)
    const distilledMemories = retrieveDistilledMemories(scenarioId)
    const plan = chooseKeySearchPlan(
      keyFinderConfig.defaultChestPos,
      scenarioId,
      distilledMemories
    )

    logger.log('key_attempt', {
      runId,
      attemptIndex,
      target: plan.chestPos,
      source: plan.source,
      distilledCount: distilledMemories.length
    })

    const searchResult = await executeSearch(bot, plan.chestPos, logger)

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex,
      actions: searchResult.actions,
      targetPos: plan.chestPos,
      success: searchResult.success,
      timestamp: Date.now()
    }

    ingestKeyFinderAttempt(attemptLog)
    const distilled = distillMemoryUnits(attemptLog)
    if (distilled.length > 0) {
      ingestDistilledMemory(distilled)
    }
    await recordMemory(attemptLog)

    const memories = await getRelevantMemories(scenarioId, 'key_search')
    logger.log('key_memory_stats', {
      runId,
      attemptIndex,
      success: attemptLog.success,
      storedMemories: memories.length
    })

    solved = attemptLog.success
    attemptIndex += 1

    if (!solved) {
      await wait(500)
    }
  }

  logger.log('key_episode_end', {
    scenarioId,
    runId,
    attempts: attemptIndex,
    solved
  })

  return { runId, scenarioId, attempts: attemptIndex, solved }
}

module.exports = { runKeyFinderEpisode }