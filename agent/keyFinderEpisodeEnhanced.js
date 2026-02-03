const { v4: uuidv4 } = require('uuid')
const { goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const { keyFinderConfig } = require('../scenarios/keyFinderConfig')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestKeyFinderAttempt } = require('../rag/kb')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { ragRetrieveHybrid } = require('../rag/retrieval')
const { MetricsCollector } = require('../rag/eval/metrics')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function chooseKeySearchPlan(defaultChestPos, memories = []) {
  const successMemory = memories.find(
    m => m.text && m.text.startsWith('Key found')
  )

  if (successMemory) {
    const match = successMemory.text.match(/\(([-0-9]+),([-0-9]+),([-0-9]+)\)/)
    if (match) {
      const chestPos = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) }
      return { chestPos, source: 'memory_success' }
    }
  }

  return { chestPos: defaultChestPos, source: 'default' }
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

  try {
    const chest = await bot.openChest(block)
    actions.push({ type: 'open_chest', pos: chestPos })

    const hasKey = chest.slots.some(slot => {
      if (!slot) return false
      const itemName = slot.name || ''
      return itemName.includes('key') || itemName.includes('tripwire_hook')
    })

    chest.close()
    actions.push({ type: 'close_chest', pos: chestPos })

    return { chest, success: hasKey }
  } catch (err) {
    actions.push({ type: 'chest_error', pos: chestPos, error: err.message })
    return { chest: null, success: false }
  }
}

async function runKeyFinderEpisodeEnhanced(bot, logger, options = {}) {
  const scenarioId = keyFinderConfig.scenarioId
  const runId = uuidv4()
  const mode = options.mode || 'distilled'

  const metrics = new MetricsCollector(runId, scenarioId, mode)

  logger.log('key_finder_episode_start', { runId, scenarioId, mode })

  const maxAttempts = keyFinderConfig.maxAttempts || 6
  let attempts = 0
  let found = false

  await resetChestState(bot, logger)
  metrics.snapshotStore()

  while (attempts < maxAttempts && !found) {
    const retrievalStart = Date.now()

    const memories = await ragRetrieveHybrid({
      scenarioId,
      observation: { position: bot.entity.position },
      topK: 5,
      includeDistilled: mode === 'distilled',
      includeRaw: mode === 'raw'
    })

    const retrievalLatency = Date.now() - retrievalStart

    metrics.recordRetrieval({
      queryText: `key search near position ${bot.entity.position.x} ${bot.entity.position.y} ${bot.entity.position.z}`,
      results: memories,
      latencyMs: retrievalLatency,
      source: mode
    })

    const plan = chooseKeySearchPlan(keyFinderConfig.chestBlock, memories)
    const actions = []

    logger.log('key_attempt', {
      runId,
      attemptIndex: attempts,
      targetPos: plan.chestPos,
      source: plan.source,
      memoryCount: memories.length,
      retrievalLatency
    })

    try {
      await moveToChest(bot, plan.chestPos)
      actions.push({ type: 'move', pos: plan.chestPos })
      await wait(300)

      const result = await inspectChest(bot, plan.chestPos, actions)
      found = result.success
    } catch (err) {
      actions.push({ type: 'error', message: err.message })
      found = false
    }

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      targetPos: plan.chestPos,
      actions,
      success: found,
      timestamp: Date.now()
    }

    await ingestKeyFinderAttempt(attemptLog)

    const distilled = await distillMemoryUnits(attemptLog)
    await ingestDistilledMemory(distilled)

    logger.log('key_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: found,
      distilledAdded: distilled.length
    })

    attempts += 1
    metrics.snapshotStore()

    if (!found) {
      await resetChestState(bot, logger)
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
