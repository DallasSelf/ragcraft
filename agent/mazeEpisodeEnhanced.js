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
const { retrieveGoalAlignedClaims } = require('../rag/memory/goalRetriever')
const { createScenarioPlan, extractTurnSequenceFromClaim } = require('./planning/planner')
const { snapshotInventory } = require('./planning/utils')
const { createWorldModel } = require('./world_model')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildMazeWorldState(bot) {
  return {
    atGoal: false,
    goalPos: mazeConfig.goalPos,
    inventory: bot && bot.inventory ? bot.inventory.items().length : 0
  }
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
  const mazeGoalContext = buildMazeGoalContext()

  logger.log('maze_episode_start', { runId, scenarioId, mode })

  const maxAttempts = mazeConfig.maxAttempts || 6
  let attempts = 0
  let solved = false

  await teleportToMazeStart(bot, logger)
  metrics.snapshotStore()
  const worldModel = createWorldModel()

  const loadGoalClaims = async attemptIndex => {
    let claims = []
    try {
      claims = await retrieveGoalAlignedClaims({
        goalText: mazeGoalContext.text,
        goal: mazeGoalContext.goal,
        topK: 4,
        scenarioId
      })
    } catch (err) {
      logger.log('maze_goal_claim_error', {
        runId,
        attemptIndex,
        message: err.message
      })
    }

    if (claims.length > 0) {
      logger.log('maze_goal_claims', {
        runId,
        attemptIndex,
        claimCount: claims.length,
        explanations: claims.map(c => c.explanation)
      })
      worldModel.ingestClaims(claims)
    }

    return claims
  }

  let goalClaims = await loadGoalClaims(0)
  let routeBaseline = extractRouteBaselineFromClaims(goalClaims)
  let finalPathMetrics = null

  while (attempts < maxAttempts && !solved) {

    const plan = createScenarioPlan({
      scenarioId,
      goalText: mazeGoalContext.text,
      goal: mazeGoalContext.goal,
      worldState: buildMazeWorldState(bot),
      inventory: snapshotInventory(bot),
      claimMemories: goalClaims,
      worldModel
    })

    logger.log('maze_plan', {
      runId,
      attemptIndex: attempts,
      strategy: plan.strategy,
      steps: plan.steps.map(step => ({ id: step.id, kind: step.kind, claimRef: step.claimRef }))
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
      queryText: 'successful maze navigation turn sequence',
      results: memories,
      latencyMs: retrievalLatency,
      source: memoryMode.dataset
    })

    const planDetails = chooseMazePlan(scenarioId, mazeConfig, memories, { goalClaims, plan })

    logger.log('maze_attempt', {
      runId,
      attemptIndex: attempts,
      plan: planDetails,
      memoryCount: memories.length,
      retrievalLatency
    })

    const result = await trySolveMazeInWorld(bot, planDetails, mazeConfig, logger)

    const attemptLog = {
      scenarioId,
      runId,
      attemptIndex: attempts,
      turnSequence: (result && result.turnSequence) || planDetails.turnSequence || [],
      actions: result.actions || [],
      stepCount: result.stepCount || 0,
      success: !!result.success,
      timestamp: Date.now()
    }

    const pathStats = result.pathStats || null
    const resolvedPathLength = pathStats && Number.isFinite(pathStats.optimalPathLength)
      ? pathStats.optimalPathLength
      : Array.isArray(pathStats?.optimalPath)
        ? Math.max(0, pathStats.optimalPath.length - 1)
        : attemptLog.stepCount || 0
    const baselineLength = Number.isFinite(routeBaseline?.pathLength)
      ? routeBaseline.pathLength
      : resolvedPathLength || attemptLog.stepCount || 1
    const pathEfficiency = computePathEfficiencyRatio(
      resolvedPathLength || attemptLog.stepCount || 0,
      baselineLength || resolvedPathLength || attemptLog.stepCount || 1
    )

    attemptLog.wrongTurns = pathStats?.wrongTurns || 0
    attemptLog.revisitCount = pathStats?.revisitCount || 0
    attemptLog.decisionNodes = pathStats?.decisionNodes || []
    attemptLog.optimalPathLength = resolvedPathLength
    attemptLog.pathEfficiency = pathEfficiency
    attemptLog.baselinePathLength = baselineLength
    attemptLog.optimalPath = pathStats?.optimalPath || []

    finalPathMetrics = {
      wrongTurns: attemptLog.wrongTurns,
      revisitCount: attemptLog.revisitCount,
      pathEfficiency,
      optimalPathLength: resolvedPathLength
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
      distilledAdded: distilled.length,
      wrongTurns: attemptLog.wrongTurns,
      revisits: attemptLog.revisitCount,
      pathEfficiency
    })

    solved = attemptLog.success
    attempts += 1

    if (attemptLog.success) {
      routeBaseline = await persistRouteClaimIfImproved({
        scenarioId,
        runId,
        pathStats,
        routeBaseline,
        logger
      })
    }

    metrics.snapshotStore()

    if (!solved && attempts < maxAttempts) {
      goalClaims = await loadGoalClaims(attempts)
    }

    if (!solved) {
      await wait(500)
    }
  }

  metrics.recordOutcome({
    success: solved,
    solved,
    attempts,
    wrongTurns: finalPathMetrics?.wrongTurns ?? null,
    revisits: finalPathMetrics?.revisitCount ?? null,
    pathEfficiency: finalPathMetrics?.pathEfficiency ?? null,
    optimalPathLength: finalPathMetrics?.optimalPathLength ?? null
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

function buildMazeGoalContext() {
  return {
    text: 'Navigate the maze and reach the goal block.',
    goal: {
      goal_id: 'maze_goal',
      goal_tags: ['maze', 'navigation', 'goal'],
      entities: {
        location: [mazeConfig.goalPos],
        door: [],
        code: [],
        tool: []
      },
      symbolic_entities: ['maze']
    }
  }
}

function extractRouteBaselineFromClaims(goalClaims = []) {
  const candidates = []
  for (const claim of goalClaims) {
    if (!claim) continue
    const sequence = extractTurnSequenceFromClaim(claim)
    if (!Array.isArray(sequence) || sequence.length === 0) continue
    const derivedLength = claim.route_metadata?.pathLength ?? claim.optimalPathLength
    const pathLength = Number.isFinite(derivedLength)
      ? derivedLength
      : Math.max(0, sequence.length - 1)
    candidates.push({
      claimId: claim.id || claim.memory_id,
      pathLength,
      decisionNodes: claim.decisionNodes || claim.route_metadata?.decisionNodes || [],
      sequence,
      confidence: claim.confidence || 0.8
    })
  }

  candidates.sort((a, b) => {
    if (Number.isFinite(a.pathLength) && Number.isFinite(b.pathLength)) {
      return a.pathLength - b.pathLength
    }
    return (b.confidence || 0) - (a.confidence || 0)
  })

  return candidates[0] || null
}

function computePathEfficiencyRatio(actualLength, baselineLength) {
  if (!Number.isFinite(actualLength) || actualLength <= 0) return 1
  if (!Number.isFinite(baselineLength) || baselineLength <= 0) return 1
  return Number((actualLength / baselineLength).toFixed(3))
}

function buildRouteClaimRecord({ scenarioId, runId, pathStats }) {
  if (!pathStats) return null
  const optimalPath = Array.isArray(pathStats.optimalPath) ? pathStats.optimalPath : []
  if (optimalPath.length === 0) return null
  const optimalPathLength = Number.isFinite(pathStats.optimalPathLength)
    ? pathStats.optimalPathLength
    : Math.max(0, optimalPath.length - 1)
  const decisionNodes = Array.isArray(pathStats.decisionNodes) ? pathStats.decisionNodes : []

  return {
    id: uuidv4(),
    scenarioId,
    memory_type: 'claim',
    type: 'route_claim',
    text: `Optimal maze route completes in ${optimalPathLength} steps with ${decisionNodes.length} decision nodes.`,
    goal_tags: ['maze', 'navigation', 'route'],
    entities: {
      location: mazeConfig.goalPos ? [mazeConfig.goalPos] : [],
      door: [],
      code: [],
      tool: []
    },
    turnSequence: optimalPath,
    decisionNodes,
    route_metadata: {
      pathLength: optimalPathLength,
      decisionNodeCount: decisionNodes.length,
      wrongTurns: pathStats.wrongTurns || 0,
      revisitCount: pathStats.revisitCount || 0
    },
    action_recipe: `turn sequence ${JSON.stringify(optimalPath)}`,
    confidence: 0.95,
    prerequisites: ['reach_maze_goal'],
    evidenceRunIds: runId ? [runId] : [],
    timestamp: Date.now()
  }
}

async function persistRouteClaimIfImproved({ scenarioId, runId, pathStats, routeBaseline, logger }) {
  if (!pathStats || !Array.isArray(pathStats.optimalPath) || pathStats.optimalPath.length === 0) {
    return routeBaseline
  }

  const newLength = Number.isFinite(pathStats.optimalPathLength)
    ? pathStats.optimalPathLength
    : Math.max(0, pathStats.optimalPath.length - 1)
  const hasBaseline = routeBaseline && Number.isFinite(routeBaseline.pathLength)
  if (hasBaseline && newLength >= routeBaseline.pathLength) {
    return routeBaseline
  }

  const record = buildRouteClaimRecord({ scenarioId, runId, pathStats })
  if (!record) return routeBaseline

  await ingestDistilledMemory([record])
  logger.log('maze_route_claim_recorded', {
    runId,
    scenarioId,
    pathLength: newLength,
    decisionNodeCount: record.route_metadata.decisionNodeCount
  })

  return {
    claimId: record.id,
    pathLength: newLength,
    decisionNodes: record.decisionNodes,
    sequence: record.turnSequence,
    confidence: record.confidence
  }
}

module.exports = { runMazeEpisodeEnhanced }
