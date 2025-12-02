const { buildObservation } = require('./observation')
const { decideAction } = require('./llmClientStub')
const { executeAction } = require('./action')
const { ragRetrieve, ragIngestTrial } = require('../rag/kb')
const { v4: uuidv4 } = require('uuid')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runEpisode(bot, logger, options) {
  const scenarioId = options.scenarioId || 'sandbox_01'
  const maxSteps = options.maxSteps || 20
  const runId = uuidv4()

  logger.log('episode_start', { runId, scenarioId })

  let steps = 0
  let lastPosition = null

  while (steps < maxSteps) {
    await wait(1500)
    const observation = buildObservation(bot)
    lastPosition = observation.position
    const memories = ragRetrieve({ scenarioId, observation })
    const action = decideAction(observation, memories)

    logger.log('step_decision', {
      runId,
      step: steps,
      observation,
      memories,
      action
    })

    const result = await executeAction(bot, action)

    logger.log('step_result', {
      runId,
      step: steps,
      result,
      position: buildObservation(bot).position
    })

    steps += 1
  }

  const summary = {
    runId,
    scenarioId,
    success: false,
    steps,
    lastPosition
  }

  logger.log('episode_end', summary)
  ragIngestTrial(summary)
}

module.exports = { runEpisode }

