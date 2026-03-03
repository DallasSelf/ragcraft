const { v4: uuidv4 } = require('uuid')
const { captiveRescueConfig } = require('../scenarios/captiveRescueConfig')
const { getLeverSequenceLength, verifyLeverSequence } = require('../scenarios/leverPuzzleConfig')
const { retrieveGoalAlignedClaims } = require('../rag/memory/goalRetriever')
const { createScenarioPlan, extractSequenceFromClaim } = require('./planning/planner')
const { snapshotInventory } = require('./planning/utils')
const { debugLog } = require('../logging/debugFlags')
const { createWorldModel } = require('./world_model')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildGoalContext() {
  const doorLocation = captiveRescueConfig.doorBlock
  const captiveLocation = captiveRescueConfig.captiveCell
  const doorId = captiveRescueConfig.doorId || `${captiveRescueConfig.scenarioId}_door`
  return {
    text: 'Rescue the captive by opening the locked door using the known lever code.',
    goal: {
      goal_id: 'captive_rescue',
      goal_tags: ['door', 'code', 'captive', 'rescue'],
      entities: {
        door: doorLocation ? [{ id: doorId, location: doorLocation, lockType: captiveRescueConfig.lockType || null }] : [],
        location: doorLocation ? [doorLocation] : [],
        code: [{ source: 'lever_sequence', length: getLeverSequenceLength() || 3 }],
        captive: captiveLocation ? [{ location: captiveLocation }] : []
      },
      symbolic_entities: ['door', 'code', 'captive'],
      lockType: captiveRescueConfig.lockType || null
    }
  }
}

function buildWorldState() {
  return {
    doorLocation: captiveRescueConfig.doorBlock,
    captiveLocation: captiveRescueConfig.captiveCell,
    doorLocked: true,
    doorId: captiveRescueConfig.doorId || `${captiveRescueConfig.scenarioId}_door`,
    lockType: captiveRescueConfig.lockType || null,
    leverCount: getLeverSequenceLength() || null
  }
}

async function teleportToStart(bot, logger) {
  const spawn = captiveRescueConfig.spawnPosition
  if (!spawn) return
  const cmd = `/tp ${bot.username} ${spawn.x} ${spawn.y} ${spawn.z}`
  bot.chat(cmd)
  logger.log('captive_rescue_spawn', { cmd })
  await wait(300)
}

async function setDoorState(bot, logger, powered) {
  const powerBlock = captiveRescueConfig.doorPowerBlock
  if (!powerBlock) return
  const material = powered
    ? captiveRescueConfig.doorPowerOn
    : captiveRescueConfig.doorPowerOff
  const cmd = `/setblock ${powerBlock.x} ${powerBlock.y} ${powerBlock.z} ${material}`
  bot.chat(cmd)
  logger.log('captive_rescue_door_state', { cmd, powered })
  await wait(captiveRescueConfig.resetDelayMs || 300)
}

function extractPlanSequences(plan, claims) {
  const planSequences = Array.isArray(plan?.metadata?.claimSequences)
    ? plan.metadata.claimSequences.filter(seq => Array.isArray(seq) && seq.length > 0)
    : []

  if (planSequences.length > 0) {
    return planSequences.map(seq => seq.map(n => Number(n))).filter(seq => seq.every(Number.isFinite))
  }

  return claims
    .map(claim => extractSequenceFromClaim(claim))
    .filter(seq => Array.isArray(seq) && seq.length > 0)
}

function buildFailure(reason, data = {}) {
  return { success: false, reason, ...data }
}

async function runCaptiveRescueEpisode(bot, logger, options = {}) {
  const scenarioId = captiveRescueConfig.scenarioId
  const runId = uuidv4()

  logger.log('captive_rescue_start', { runId, scenarioId })

  await teleportToStart(bot, logger)
  await setDoorState(bot, logger, false)

  const goalContext = buildGoalContext()
  let goalClaims = []
  try {
    goalClaims = await retrieveGoalAlignedClaims({
      goalText: goalContext.text,
      goal: goalContext.goal,
      topK: 5,
      scenarioId
    })
  } catch (err) {
    logger.log('captive_rescue_claim_error', { runId, message: err.message })
  }

  if (goalClaims.length > 0) {
    logger.log('captive_rescue_claims', {
      runId,
      claimCount: goalClaims.length,
      explanations: goalClaims.map(c => c.explanation)
    })
  }

  debugLog('retrieval', 'Captive rescue goal claims', {
    runId,
    scenarioId,
    claims_found: goalClaims.length,
    samples: goalClaims.slice(0, 2).map(claim => ({
      id: claim.id || claim.memory_id || 'unknown',
      explanation: claim.explanation,
      text_preview: typeof claim.text === 'string' ? claim.text.slice(0, 80) : null
    }))
  })

  const worldModel = createWorldModel(goalClaims)

  const plan = createScenarioPlan({
    scenarioId,
    goalText: goalContext.text,
    goal: goalContext.goal,
    worldState: buildWorldState(),
    inventory: snapshotInventory(bot),
    claimMemories: goalClaims,
    worldModel
  })

  logger.log('captive_rescue_plan', {
    runId,
    strategy: plan.strategy,
    steps: plan.steps.map(step => ({ id: step.id, kind: step.kind, claimRef: step.claimRef })),
    unlockStrategy: plan.metadata?.doorUnlockPlan || null
  })

  debugLog('plan', 'Captive rescue plan generated', {
    runId,
    scenarioId,
    strategy: plan.strategy,
    step_count: plan.steps.length,
    claim_refs: plan.metadata?.claimReferences || [],
    unlockStrategy: plan.metadata?.doorUnlockPlan || null
  })

  const planMetadata = plan.metadata || {}
  const baseResult = {
    runId,
    scenarioId,
    planStrategy: plan.strategy,
    claimReferences: planMetadata.claimReferences || [],
    leverRoomRevisits: planMetadata.skipLeverRoom ? 0 : 1
  }

  const candidateSequences = extractPlanSequences(plan, goalClaims)
  if (!Array.isArray(candidateSequences) || candidateSequences.length === 0) {
    logger.log('captive_rescue_failed', { runId, reason: 'missing_claim_code' })
    return {
      ...baseResult,
      attempts: 0,
      success: false,
      reason: 'missing_claim_code',
      codeEntries: 0,
      wrongCodeEntries: 0
    }
  }

  debugLog('claims', 'Captive rescue candidate sequences', {
    runId,
    scenarioId,
    candidate_count: candidateSequences.length,
    sample_sequences: candidateSequences.slice(0, 2).map(seq => seq.join('-'))
  })

  const maxAttempts = captiveRescueConfig.maxAttempts || candidateSequences.length
  const timeoutAt = Date.now() + (captiveRescueConfig.timeoutMs || 20000)

  let attempts = 0
  let rescued = false
  let usedSequence = null

  for (const sequence of candidateSequences) {
    if (attempts >= maxAttempts) break
    if (Date.now() > timeoutAt) break
    attempts += 1

    logger.log('captive_rescue_attempt', {
      runId,
      attemptIndex: attempts - 1,
      sequence,
      claimSource: plan.metadata?.claimReferences?.[attempts - 1] || null
    })

    debugLog('claims', 'Captive rescue attempt', {
      runId,
      scenarioId,
      attemptIndex: attempts - 1,
      sequence,
      claimSource: plan.metadata?.claimReferences?.[attempts - 1] || null
    })

    if (verifyLeverSequence(sequence)) {
      await setDoorState(bot, logger, true)
      await wait(250)
      logger.log('captive_rescue_door_opened', {
        runId,
        attemptIndex: attempts - 1,
        sequence
      })
      rescued = true
      usedSequence = sequence
      break
    } else {
      logger.log('captive_rescue_wrong_code', {
        runId,
        attemptIndex: attempts - 1,
        triedSequence: sequence
      })
      await wait(350)
    }
  }

  if (!rescued && Date.now() > timeoutAt) {
    logger.log('captive_rescue_failed', { runId, reason: 'timeout', attempts })
    await setDoorState(bot, logger, false)
    return {
      ...baseResult,
      attempts,
      success: false,
      reason: 'timeout',
      codeEntries: attempts,
      wrongCodeEntries: attempts
    }
  }

  if (!rescued) {
    logger.log('captive_rescue_failed', { runId, reason: 'wrong_code', attempts })
    await setDoorState(bot, logger, false)
    return {
      ...baseResult,
      attempts,
      success: false,
      reason: 'wrong_code',
      codeEntries: attempts,
      wrongCodeEntries: attempts
    }
  }

  logger.log('captive_rescue_success', {
    runId,
    attempts,
    sequence: usedSequence,
    captiveLocation: captiveRescueConfig.captiveCell
  })

  return {
    ...baseResult,
    attempts,
    success: true,
    sequence: usedSequence,
    codeEntries: attempts,
    wrongCodeEntries: Math.max(0, attempts - 1)
  }
}

module.exports = {
  runCaptiveRescueEpisode,
  setCaptiveDoorState: setDoorState
}
