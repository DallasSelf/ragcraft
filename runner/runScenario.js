const path = require('path')
const { createLogger } = require('../logging/logger')
const { getScenarioByName, scenarios, listScenarios } = require('./scenarioRegistry')
const { distillClaimsFromEpisode } = require('../rag/memory/claimDistiller')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { attachHazardExposureLogger } = require('../agent/utils/hazardExposureTracker')
const { buildRunContext } = require('../agent/utils/runContext')

function safeSlug(v) {
  return String(v).replace(/[^a-zA-Z0-9_-]+/g, '_')
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function runScenario(bot, scenarioName, options = {}) {
  const scenario = getScenarioByName(scenarioName)
  if (!scenario) {
    const known = Object.keys(scenarios).join(', ')
    throw new Error(`Unknown scenario "${scenarioName}". Known: ${known}`)
  }

  const runId = options.runId || `${scenario.id}-${nowStamp()}`
  const baseDir = options.runsDir || path.join(__dirname, '..', 'runs')
  const scenarioDir = path.join(baseDir, scenario.id)

  const logger = createLogger({ dirPath: scenarioDir, fileBase: safeSlug(runId) })
  const executionMode = options.mode || 'default'
  const runContext = buildRunContext({ scenarioId: scenario.id, mode: executionMode })
  const hazardStats = { exposureCount: 0 }

  logger.log('run_start', {
    scenarioId: scenario.id,
    runId,
    mode: executionMode,
    runLabel: options.runLabel || null,
    git: options.git || null
  })

  let result = null
  const startedAt = Date.now()
  const hazardTelemetry = attachHazardExposureLogger(bot, logger, {
    runId,
    scenarioId: scenario.id,
    onExposure: () => {
      hazardStats.exposureCount += 1
    }
  })
  const scenarioOptions = {
    ...options,
    runId,
    scenarioId: scenario.id,
    runContext,
    hazardStats
  }
  try {
    result = await scenario.run(bot, logger, scenarioOptions)

    const claims = await distillClaimsFromEpisode({
      scenarioId: scenario.id,
      runId,
      result,
      logger
    })

    if (Array.isArray(claims) && claims.length > 0) {
      try {
        await ingestDistilledMemory(claims)
        logger.log('run_claims_distilled', {
          scenarioId: scenario.id,
          runId,
          claimCount: claims.length
        })
      } catch (err) {
        logger.log('run_claims_distilled_error', {
          scenarioId: scenario.id,
          runId,
          message: err.message
        })
      }
    }
    logger.log('run_end', {
      scenarioId: scenario.id,
      runId,
      runLabel: options.runLabel || null,
      ms: Date.now() - startedAt,
      hazardExposures: hazardStats.exposureCount,
      result
    })
    return {
      scenarioId: scenario.id,
      runId,
      runLabel: options.runLabel || null,
      hazardExposures: hazardStats.exposureCount,
      result
    }
  } catch (err) {
    logger.log('run_error', {
      scenarioId: scenario.id,
      runId,
      runLabel: options.runLabel || null,
      ms: Date.now() - startedAt,
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : null
    })
    throw err
  } finally {
    if (hazardTelemetry && typeof hazardTelemetry.dispose === 'function') {
      hazardTelemetry.dispose()
    }
    logger.close()
  }
}

async function runAll(bot, options = {}) {
  const ordered = listScenarios().map(s => s.id)
  const results = []
  for (const name of ordered) {
    results.push(await runScenario(bot, name, options))
  }
  return results
}

module.exports = { runScenario, runAll }
