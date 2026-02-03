const { v4: uuidv4 } = require('uuid')
const { trySolveMazeInWorld } = require('../maze/mazeWorld')
const { chooseMazePlan } = require('./mazeStrategy')
const { mazeConfig } = require('../scenarios/mazeConfig')
const { ingestMazeAttempt } = require('../rag/kb')
const { distillMemoryUnits } = require('../memoryDistiller')
const {
  ingestDistilledMemory,
  retrieveDistilledMemories,
  preloadDistilledMemories
} = require('../rag/distilledMemory')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runMazeEpisode(bot, logger, opts = {}) {
  const scenarioId = mazeConfig.scenarioId
  const runId = uuidv4()

  const preloadFile = opts.preloadFile || process.env.MAZE_PRELOAD_FILE
  if (preloadFile) {
    preloadDistilledMemories(preloadFile)
    logger.log('maze_preload', { runId, scenarioId, preloadFile })
  }

  const maxAttempts = mazeConfig.maxAttempts || 6
  let attempts = 0
  let solved = false

  logger.log('maze_episode_start', {
    runId,
    scenarioId,
    maxAttempts
  })

  while (attempts < maxAttempts && !solved) {
    const distilledMemories = retrieveDistilledMemories(scenarioId)
    const plan = chooseMazePlan(scenarioId, mazeConfig, distilledMemories)

    logger.log('maze_attempt', {
      runId,
      attemptIndex: attempts,
      plan,
      distilledCount: distilledMemories.length
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

    ingestMazeAttempt(attemptLog)

    const distilled = await distillMemoryUnits(attemptLog)
    ingestDistilledMemory(distilled)

    logger.log('maze_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: attemptLog.success,
      stepCount: attemptLog.stepCount,
      distilledAdded: distilled.length
    })

    solved = attemptLog.success
    attempts += 1

    if (!solved) {
      await wait(500)
    }
  }

  logger.log('maze_episode_end', {
    runId,
    scenarioId,
    attempts,
    solved
  })

  return { runId, scenarioId, attempts, solved }
}

module.exports = { runMazeEpisode }
