const { v4: uuidv4 } = require('uuid')
const { trySequenceInWorld, createLeverScenarioController } = require('./leverWorld')
const { chooseLeverSequence } = require('./leverStrategy')
const { getLeverScenarioView, verifyLeverSequence } = require('../scenarios/leverPuzzleConfig')
const { ingestLeverAttempt } = require('../rag/kb')
const { distillMemoryUnits } = require('../memoryDistiller')
const {
  ingestDistilledMemory,
  retrieveDistilledMemories
} = require('../rag/distilledMemory')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runLeverEpisode(bot, logger) {
  const leverScenario = getLeverScenarioView()
  const scenarioController = createLeverScenarioController(leverScenario)
  const scenarioId = leverScenario.scenarioId
  const runId = uuidv4()

  logger.log('lever_episode_start', { runId, scenarioId })

  const maxAttempts = leverScenario.maxAttempts || 6
  let attempts = 0
  let solved = false
  const attemptHistory = []

  await scenarioController.closeDoor(bot, logger)
  await scenarioController.resetLevers(bot, logger)

  while (attempts < maxAttempts && !solved) {
    const distilledMemories = retrieveDistilledMemories(scenarioId)

    const choice = chooseLeverSequence(
      scenarioId,
      leverScenario.leverCount,
      distilledMemories,
      attemptHistory
    )

    const sequence = choice.sequence
    if (Array.isArray(sequence)) {
      attemptHistory.push([...sequence])
    }

    logger.log('lever_attempt', {
      runId,
      attemptIndex: attempts,
      sequence,
      source: choice.source,
      distilledCount: distilledMemories.length
    })

    await trySequenceInWorld(bot, sequence, leverScenario, logger)
    await wait(300)

    const isCorrect = verifyLeverSequence(sequence)

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      sequence,
      success: isCorrect,
      timestamp: Date.now()
    }

    ingestLeverAttempt(attemptLog)

    const distilled = await distillMemoryUnits(attemptLog)
    ingestDistilledMemory(distilled)

    logger.log('lever_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: isCorrect,
      distilledAdded: distilled.length
    })

    if (isCorrect) {
      await scenarioController.openDoor(bot, logger)
      logger.log('lever_solved', {
        runId,
        attempts: attempts + 1,
        sequence
      })
      solved = true
    } else {
      await scenarioController.closeDoor(bot, logger)
      await scenarioController.resetLevers(bot, logger)
      logger.log('lever_incorrect', {
        runId,
        attemptIndex: attempts,
        sequence
      })
      attempts += 1
      await wait(400)
    }
  }

  logger.log('lever_episode_end', {
    runId,
    scenarioId,
    attempts: solved ? attempts + 1 : attempts,
    solved
  })

  return { runId, scenarioId, attempts, solved }
}

module.exports = { runLeverEpisode }
