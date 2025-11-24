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

async function runMazeEpisode(bot, logger, options = {}) {
  const scenarioId = mazeConfig.scenarioId
  const runId = uuidv4()

  logger.log('maze_episode_start', { runId, scenarioId })

  const preloadFile = options.preloadFile || process.env.MAZE_PRELOAD_FILE
  if (preloadFile) {
    preloadDistilledMemories(preloadFile)
    logger.log('maze_preload_memories', { runId, scenarioId, preloadFile })
  }

  const maxAttempts = 10
  let attempts = 0
  let solved = false

  while (attempts < maxAttempts && !solved) {
    const distilledMemories = retrieveDistilledMemories(scenarioId)
    const plan = chooseMazePlan(scenarioId, mazeConfig, distilledMemories)

    logger.log('maze_attempt', {
      runId,
      attemptIndex: attempts,
      plan: plan,
      source: plan.source
    })

    const result = await trySolveMazeInWorld(bot, plan, mazeConfig, logger)

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      actions: result.actions,
      turnSequence: result.actions.map(a => a.target),
      success: result.success,
      stepCount: result.stepCount,
      timestamp: Date.now()
    }

    ingestMazeAttempt(attemptLog)
    const distilledUnits = distillMemoryUnits(attemptLog)
    if (distilledUnits.length > 0) {
      ingestDistilledMemory(distilledUnits)
      logger.log('maze_distillation', {
        runId,
        attemptIndex: attempts,
        distilledCount: distilledUnits.length
      })
    }

    logger.log('maze_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: result.success,
      stepCount: result.stepCount
    })

    if (result.success) {
      logger.log('maze_solved', {
        runId,
        attempts: attempts + 1,
        stepCount: result.stepCount
      })
      solved = true
    } else {
      logger.log('maze_failed', {
        runId,
        attemptIndex: attempts,
        stepCount: result.stepCount
      })
    }

    attempts++
    
    if (!solved && attempts < maxAttempts) {
      await wait(1000)
    }
  }

  logger.log('maze_episode_end', {
    runId,
    totalAttempts: attempts,
    solved
  })

  return { solved, attempts }
}

module.exports = { runMazeEpisode }

