const { v4: uuidv4 } = require('uuid')
const { trySolveMazeInWorld } = require('../maze/mazeWorld')
const { chooseMazePlan } = require('./mazeStrategy')
const { mazeConfig } = require('../scenarios/mazeConfig')
const { ingestMazeAttempt } = require('../rag/kb')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { ragRetrieveHybrid } = require('../rag/retrieval')
const { MetricsCollector } = require('../rag/eval/metrics')
const { resolveMemoryMode } = require('./memoryModes')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function teleportToMazeStart(bot, logger) {
  const pos = mazeConfig.spawnPosition || mazeConfig.startPos
  if (!pos) return

  const cmd = `/tp ${bot.username} ${pos.x} ${pos.y} ${pos.z}`
  bot.chat(cmd)
  logger.log('maze_teleport_start', { cmd })
  await wait(300)
}

async function runMazeEpisodeEnhanced(bot, logger, options = {}) {
  const scenarioId = mazeConfig.scenarioId
  const runId = uuidv4()
  const mode = options.mode || 'distilled'
  const memoryMode = resolveMemoryMode(mode)

  const metrics = new MetricsCollector(runId, scenarioId, mode)

  logger.log('maze_episode_start', { runId, scenarioId, mode })

  const maxAttempts = mazeConfig.maxAttempts || 6
  let attempts = 0
  let solved = false

  await teleportToMazeStart(bot, logger)
  metrics.snapshotStore()

  while (attempts < maxAttempts && !solved) {
    const retrievalStart = Date.now()

    const memories = await ragRetrieveHybrid({
      scenarioId,
      observation: {},
      topK: 5,
      includeDistilled: memoryMode.includeDistilled,
      includeRaw: memoryMode.includeRaw
    })

    const retrievalLatency = Date.now() - retrievalStart

    metrics.recordRetrieval({
      queryText: 'successful maze navigation turn sequence',
      results: memories,
      latencyMs: retrievalLatency,
      source: memoryMode.dataset
    })

    const plan = chooseMazePlan(scenarioId, mazeConfig, memories)

    logger.log('maze_attempt', {
      runId,
      attemptIndex: attempts,
      plan,
      memoryCount: memories.length,
      retrievalLatency
    })

    const result = await trySolveMazeInWorld(bot, plan, mazeConfig, logger)

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      turnSequence: (result && result.turnSequence) || plan.turnSequence || [],
      actions: result.actions || [],
      stepCount: result.stepCount || 0,
      success: !!result.success,
      timestamp: Date.now()
    }

    await ingestMazeAttempt(attemptLog)

    const distilled = await distillMemoryUnits(attemptLog, {
      distillStyle: memoryMode.distillStyle
    })
    await ingestDistilledMemory(distilled)

    logger.log('maze_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: attemptLog.success,
      stepCount: attemptLog.stepCount,
      distilledAdded: distilled.length
    })

    solved = attemptLog.success
    attempts += 1

    metrics.snapshotStore()

    if (!solved) {
      await wait(500)
    }
  }

  metrics.recordOutcome({
    success: solved,
    solved,
    attempts
  })

  metrics.save()

  logger.log('maze_episode_end', {
    runId,
    scenarioId,
    attempts,
    solved
  })

  return { runId, scenarioId, attempts, solved }
}

module.exports = { runMazeEpisodeEnhanced }
