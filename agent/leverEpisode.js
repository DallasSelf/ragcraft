const { v4: uuidv4 } = require('uuid')
const { trySequenceInWorld } = require('./leverWorld')
const { chooseLeverSequence } = require('./leverStrategy')
const { leverPuzzleConfig } = require('../scenarios/leverPuzzleConfig')
const { ingestLeverAttempt } = require('../rag/kb')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestDistilledMemory, retrieveDistilledMemories } = require('../rag/distilledMemory')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function closeDoor(bot, logger) {
  const pos = leverPuzzleConfig.doorPowerBlock
  const offMat = leverPuzzleConfig.doorPowerOff
  const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} ${offMat}`

  logger.log('door_state_change', {
    open: false,
    command: cmd,
    powerPos: pos
  })

  bot.chat(cmd)
  await wait(200)
}

async function openDoor(bot, logger) {
  const pos = leverPuzzleConfig.doorPowerBlock
  const onMat = leverPuzzleConfig.doorPowerOn
  const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} ${onMat}`

@@ -45,71 +47,82 @@ async function resetLevers(bot, logger) {
  for (const pos of leverPuzzleConfig.leverBlocks) {
    const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} lever[face=${face},facing=${facing},powered=false]`
    logger.log('lever_reset', {
      position: pos,
      command: cmd
    })
    bot.chat(cmd)
    await wait(100)
  }
}

async function runLeverEpisode(bot, logger) {
  const scenarioId = leverPuzzleConfig.scenarioId
  const runId = uuidv4()

  logger.log('lever_episode_start', { runId, scenarioId })

  await closeDoor(bot, logger)
  await resetLevers(bot, logger)

  const maxAttempts = 100
  let attempts = 0
  let solved = false

  while (attempts < maxAttempts && !solved) {
    const choice = chooseLeverSequence(scenarioId, leverPuzzleConfig.leverCount)
    const distilledMemories = retrieveDistilledMemories(scenarioId)
    const choice = chooseLeverSequence(
      scenarioId,
      leverPuzzleConfig.leverCount,
      distilledMemories
    )
    const sequence = choice.sequence

    logger.log('lever_attempt', {
      runId,
      attemptIndex: attempts,
      sequence,
      source: choice.source
    })

    await trySequenceInWorld(bot, sequence, leverPuzzleConfig, logger)

    const isCorrect =
      JSON.stringify(sequence) === JSON.stringify(leverPuzzleConfig.correctSequence)

    ingestLeverAttempt({
    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      sequence,
      success: isCorrect
    })
      success: isCorrect,
      timestamp: Date.now()
    }

    ingestLeverAttempt(attemptLog)
    const distilled = distillMemoryUnits(attemptLog)
    ingestDistilledMemory(distilled)

    logger.log('lever_attempt_result', {
      runId,
      attemptIndex: attempts,
      sequence,
      isCorrect
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
    }