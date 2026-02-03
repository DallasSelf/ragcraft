const { v4: uuidv4 } = require('uuid')
const { trySolveMazeInWorld } = require('../maze/mazeWorld')
const { chooseMazePlan } = require('./mazeStrategy')
const { mazeConfig } = require('../scenarios/mazeConfig')
const { ingestMazeAttempt } = require('../rag/kb')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { ragRetrieveHybrid } = require('../rag/retrieval')
const { MetricsCollector } = require('../rag/eval/metrics')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runMazeEpisodeEnhanced(bot, logger, options = {}) {
  const scenarioId = mazeConfig.scenarioId
  const runId = uuidv4()
  const mode = options.mode || 'distilled'

  const metrics = new MetricsCollector(runId, scenarioId, mode)

  logger.log('maze_episode_start', { runId, scenarioId, mode })

  const maxAttempts = mazeConfig.maxAttempts || 6
  let attempts = 0
  let solved = false

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
      queryText: 'successful maze navigation turn sequence',
      results: memories,
      latencyMs: retrievalLatency,
      source: mode
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
      turnSequence: plan.turnSequence || [],
      actions: result.actions || [],
      stepCount: result.stepCount || 0,
      success: !!result.success,
      timestamp: Date.now()
    }

    await ingestMazeAttempt(attemptLog)

    const distilled = await distillMemoryUnits(attemptLog)
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
