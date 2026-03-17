const { v4: uuidv4 } = require('uuid')
const { trySequenceInWorld, createLeverScenarioController } = require('./leverWorld')
const { chooseLeverSequence } = require('./leverStrategy')
const { getLeverScenarioView, verifyLeverSequence, getLeverLockType } = require('../scenarios/leverPuzzleConfig')
const { ingestLeverAttempt } = require('../rag/kb')
const { distillMemoryUnits } = require('../memoryDistiller')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { ragRetrieveHybrid } = require('../rag/retrieval')
const { MetricsCollector } = require('../rag/eval/metrics')
const { resolveMemoryMode } = require('./memoryModes')
const { retrieveGoalAlignedClaims } = require('../rag/memory/goalRetriever')
const { createScenarioPlan } = require('./planning/planner')
const { snapshotInventory } = require('./planning/utils')
const { debugLog } = require('../logging/debugFlags')
const { createWorldModel } = require('./world_model')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildLeverWorldState(leverScenario, lockType) {
  return {
    doorLocation: leverScenario.doorBlock,
    leverCount: leverScenario.leverCount,
    doorLocked: true,
    doorId: leverScenario.doorId || `${leverScenario.scenarioId || 'lever'}_door`,
    lockType: lockType || null
  }
}

function buildLeverGoalContext(leverScenario, lockType) {
  const doorLocation = leverScenario.doorBlock || null
  const leverBlocks = Array.isArray(leverScenario.leverBlocks) ? leverScenario.leverBlocks : []
  const doorId = leverScenario.doorId || `${leverScenario.scenarioId || 'lever'}_door`
  return {
    text: 'Open the locked exit door using the correct lever code sequence.',
    goal: {
      goal_id: 'lever_unlock',
      goal_tags: ['door', 'code', 'lever', 'unlock'],
      entities: {
        door: doorLocation
          ? [{ id: doorId, location: doorLocation, lockType: lockType || null }]
          : [],
        code: [{ length: leverScenario.leverCount }],
        lever: leverBlocks.map((pos, idx) => ({ id: `lever_${idx + 1}`, location: pos }))
      },
      symbolic_entities: ['door', 'lever', 'code'],
      lockType: lockType || null
    }
  }
}

/**
 * Enhanced lever episode with vector RAG retrieval and metrics
 */
async function runLeverEpisodeEnhanced(bot, logger, options = {}) {
  const leverScenario = getLeverScenarioView()
  const lockType = getLeverLockType(leverScenario)
  const scenarioController = createLeverScenarioController(leverScenario)
  const scenarioId = leverScenario.scenarioId
  const runId = uuidv4()
  const mode = options.mode || 'distilled'
  const memoryMode = resolveMemoryMode(mode)

  const metrics = new MetricsCollector(runId, scenarioId, mode)
  const leverGoalContext = buildLeverGoalContext(leverScenario, lockType)

  logger.log('lever_episode_start', { runId, scenarioId, mode })

  const maxAttempts = leverScenario.maxAttempts || 6
  let attempts = 0
  let solved = false
  let solvedSequence = null
  const attemptHistory = []

  await scenarioController.teleportToStart(bot, logger)
  await scenarioController.closeDoor(bot, logger)
  await scenarioController.resetLevers(bot, logger)
  if (!scenarioController.verifyReset(bot)) {
    logger.log('lever_reset_verification_failed', {
      runId,
      phase: 'initial'
    })
  }

  metrics.snapshotStore()

  const worldModel = createWorldModel()

  const loadGoalClaims = async attemptIndex => {
    let claims = []
    try {
      claims = await retrieveGoalAlignedClaims({
        goalText: leverGoalContext.text,
        goal: leverGoalContext.goal,
        topK: 4,
        scenarioId
      })
    } catch (err) {
      logger.log('lever_goal_claim_error', {
        runId,
        attemptIndex,
        message: err.message
      })
    }

    if (claims.length > 0) {
      logger.log('lever_goal_claims', {
        runId,
        attemptIndex,
        claimCount: claims.length,
        explanations: claims.map(c => c.explanation)
      })
    }

    debugLog('retrieval', 'Lever goal claims', {
      runId,
      scenarioId,
      attemptIndex,
      claims_found: claims.length,
      samples: claims.slice(0, 2).map(claim => ({
        id: claim.id || claim.memory_id || 'unknown',
        explanation: claim.explanation,
        text_preview: typeof claim.text === 'string' ? claim.text.slice(0, 80) : null
      }))
    })

    if (claims.length > 0) {
      worldModel.ingestClaims(claims)
    }

    return claims
  }

  let goalClaims = await loadGoalClaims(0)

  while (attempts < maxAttempts && !solved) {
    await scenarioController.teleportToStart(bot, logger)

    const plan = createScenarioPlan({
      scenarioId,
      goalText: leverGoalContext.text,
      goal: leverGoalContext.goal,
      worldState: buildLeverWorldState(leverScenario, lockType),
      inventory: snapshotInventory(bot),
      claimMemories: goalClaims,
      worldModel
    })

    logger.log('lever_plan', {
      runId,
      attemptIndex: attempts,
      strategy: plan.strategy,
      steps: plan.steps.map(step => ({ id: step.id, kind: step.kind, claimRef: step.claimRef })),
      unlockStrategy: plan.metadata?.doorUnlockPlan || null
    })

    debugLog('plan', 'Lever plan generated', {
      runId,
      scenarioId,
      attemptIndex: attempts,
      strategy: plan.strategy,
      step_count: plan.steps.length,
      claim_refs: plan.metadata?.claimReferences || [],
      unlockStrategy: plan.metadata?.doorUnlockPlan || null
    })

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
      queryText: 'successful lever sequence puzzle solution',
      results: memories,
      latencyMs: retrievalLatency,
      source: memoryMode.dataset
    })

    debugLog('retrieval', 'Lever memory retrieval', {
      runId,
      scenarioId,
      attemptIndex: attempts,
      dataset: memoryMode.dataset,
      memory_count: memories.length,
      latency_ms: retrievalLatency,
      top_memory: memories[0]
        ? {
            id: memories[0].id || memories[0].memory_id || 'unknown',
            similarity: memories[0].similarity,
            text_preview: typeof memories[0].text === 'string' ? memories[0].text.slice(0, 60) : null
          }
        : null
    })

    const choice = chooseLeverSequence(
      scenarioId,
      leverScenario.leverCount,
      memories,
      attemptHistory,
      { goalClaims, plan }
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
      memoryCount: memories.length,
      retrievalLatency
    })

    debugLog('claims', 'Lever sequence decision', {
      runId,
      scenarioId,
      attemptIndex: attempts,
      sequence,
      source: choice.source,
      avoided_sequences: attemptHistory.length,
      claim_support: {
        goal_claims: goalClaims.length,
        plan_claims: plan.metadata?.claimReferences?.length || 0
      }
    })

    const interactionOk = await trySequenceInWorld(bot, sequence, leverScenario, logger)
    await wait(300)

    const sequenceMatches = interactionOk && verifyLeverSequence(sequence)
    let worldValidated = false
    if (sequenceMatches) {
      await scenarioController.openDoor(bot, logger)
      await wait(200)
      worldValidated = scenarioController.verifyDoorOpen(bot)
      if (!worldValidated) {
        logger.log('lever_world_validation_failed', {
          runId,
          attemptIndex: attempts,
          sequence
        })
      }
    }
    const isCorrect = sequenceMatches && worldValidated

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      sequence,
      success: isCorrect,
      timestamp: Date.now()
    }

    await ingestLeverAttempt(attemptLog)

    const distilled = await distillMemoryUnits(attemptLog, {
      distillStyle: memoryMode.distillStyle
    })
    await ingestDistilledMemory(distilled)

    logger.log('lever_attempt_result', {
      runId,
      attemptIndex: attempts,
      success: isCorrect,
      distilledAdded: distilled.length
    })

    if (isCorrect) {
      logger.log('lever_solved', {
        runId,
        attempts: attempts + 1,
        sequence
      })
      solved = true
      solvedSequence = Array.isArray(sequence) ? [...sequence] : null
    } else {
      await scenarioController.closeDoor(bot, logger)
      await scenarioController.resetLevers(bot, logger)
      if (!scenarioController.verifyReset(bot)) {
        logger.log('lever_reset_verification_failed', {
          runId,
          attemptIndex: attempts
        })
      }
      logger.log('lever_incorrect', {
        runId,
        attemptIndex: attempts,
        sequence
      })
      attempts += 1
      await wait(400)
    }

    metrics.snapshotStore()

    if (!solved && attempts < maxAttempts) {
      goalClaims = await loadGoalClaims(attempts)
    }
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

  const successSequence = solvedSequence ? [...solvedSequence] : null
  const successEvidence = solved
    ? {
        doorUnlocked: true,
        verification: 'door_open_event',
        sequence: successSequence,
        doorLocation: leverScenario.doorBlock,
        doorId: leverScenario.doorId || `${scenarioId}_door`,
        howToApply: successSequence && successSequence.length > 0
          ? `Toggle levers in order ${successSequence.join('-')} to open the door.`
          : 'Toggle the known lever sequence to open the door.',
        sourceEpisodeId: runId,
        confidence: 0.97,
        lockType
      }
    : null

  return { runId, scenarioId, attempts, solved, successEvidence }
}

module.exports = { runLeverEpisodeEnhanced }
