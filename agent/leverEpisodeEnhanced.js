const { v4: uuidv4 } = require('uuid')
const { trySequenceInWorld } = require('./leverWorld')
const { chooseLeverSequence } = require('./leverStrategy')
const { leverPuzzleConfig } = require('../scenarios/leverPuzzleConfig')
const { ingestLeverAttempt } = require('../rag/kb')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { ragRetrieveHybrid } = require('../rag/retrieval')
const { MetricsCollector } = require('../rag/eval/metrics')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function closeDoor(bot, logger) {
  const pos = leverPuzzleConfig.doorPowerBlock
  const material = leverPuzzleConfig.doorPowerOff
  const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} ${material}`
  bot.chat(cmd)
  logger.log('lever_door_close', { cmd })
  await wait(300)
}

async function openDoor(bot, logger) {
  const pos = leverPuzzleConfig.doorPowerBlock
  const material = leverPuzzleConfig.doorPowerOn
  const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} ${material}`
  bot.chat(cmd)
  logger.log('lever_door_open', { cmd })
  await wait(300)
}

async function resetLevers(bot, logger) {
  const face = leverPuzzleConfig.leverFace || 'wall'
  const facing = leverPuzzleConfig.leverFacing || 'north'

  for (const pos of leverPuzzleConfig.leverBlocks) {
    const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} lever[face=${face},facing=${facing},powered=false]`
    bot.chat(cmd)
    logger.log('lever_reset_block', { cmd, pos })
    await wait(150)
  }

  await wait(250)
}

/**
 * Enhanced lever episode with vector RAG retrieval and metrics
 */
async function runLeverEpisodeEnhanced(bot, logger, options = {}) {
  const scenarioId = leverPuzzleConfig.scenarioId
  const runId = uuidv4()
  const mode = options.mode || 'distilled'  // 'distilled' or 'raw'

  const metrics = new MetricsCollector(runId, scenarioId, mode)

  logger.log('lever_episode_start', { runId, scenarioId, mode })

  const maxAttempts = leverPuzzleConfig.maxAttempts || 6
  let attempts = 0
  let solved = false

  await closeDoor(bot, logger)
  await resetLevers(bot, logger)

  metrics.snapshotStore()

  while (attempts < maxAttempts && !solved) {
    const retrievalStart = Date.now()

    const memories = await ragRetrieveHybrid({
      scenarioId,
      observation: {},
      topK: 5,
      includeDistilled: mode === 'distilled',
      includeRaw: mode === 'raw'
    })

    const retrievalLatency = Date.now() - retrievalStart

    metrics.recordRetrieval({
      queryText: 'successful lever sequence puzzle solution',
      results: memories,
      latencyMs: retrievalLatency,
      source: mode
    })

    const choice = chooseLeverSequence(
      scenarioId,
      leverPuzzleConfig.leverCount,
      memories
    )

    const sequence = choice.sequence

    logger.log('lever_attempt', {
      runId,
      attemptIndex: attempts,
      sequence,
      source: choice.source,
      memoryCount: memories.length,
      retrievalLatency
    })

    await trySequenceInWorld(bot, sequence, leverPuzzleConfig, logger)
    await wait(300)

    const isCorrect =
      JSON.stringify(sequence) === JSON.stringify(leverPuzzleConfig.correctSequence)

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      sequence,
      success: isCorrect,
      timestamp: Date.now()
    }

    await ingestLeverAttempt(attemptLog)

    const distilled = distillMemoryUnits(attemptLog)
    await ingestDistilledMemory(distilled)

    logger.log('lever_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: isCorrect,
      distilledAdded: distilled.length
    })

    if (isCorrect) {
      await openDoor(bot, logger)
      logger.log('lever_solved', {
        runId,
        attempts: attempts + 1,
        sequence
      })
      solved = true
    } else {
      await closeDoor(bot, logger)
      await resetLevers(bot, logger)
      logger.log('lever_incorrect', {
        runId,
        attemptIndex: attempts,
        sequence
      })
      attempts += 1
      await wait(400)
    }

    metrics.snapshotStore()
  }

  metrics.recordOutcome({
    success: solved,
    solved,
    attempts: solved ? attempts + 1 : attempts
  })

  metrics.save()

  logger.log('lever_episode_end', {
    runId,
    scenarioId,
    attempts: solved ? attempts + 1 : attempts,
    solved
  })

  return { runId, scenarioId, attempts, solved }
}

module.exports = { runLeverEpisodeEnhanced }
