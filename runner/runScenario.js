const path = require('path')
const { createLogger } = require('../logging/logger')
const { getScenarioByName, scenarios, listScenarios } = require('./scenarioRegistry')
const { distillClaimsFromEpisode } = require('../rag/memory/claimDistiller')
const { ingestDistilledMemory } = require('../rag/distilledMemory')
const { attachHazardExposureLogger } = require('../agent/utils/hazardExposureTracker')
const { buildRunContext } = require('../agent/utils/runContext')
const { applySafetyRails } = require('../agent/utils/safetyRails')
const { buildStandardRunRecord, writeRunArtifacts } = require('./runSummary')

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
  const executionMode = options.mode || 'default'
  const logger = createLogger({
    scenarioId: scenario.id,
    runId,
    memoryMode: executionMode
  })
  applySafetyRails(bot, logger)
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
    runOutputDir: logger.runDir,
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

    const loggerStats = typeof logger.getStats === 'function' ? logger.getStats() : {}
    const runSummary = buildStandardRunRecord({
      runId,
      scenario: scenario.id,
      memoryMode: executionMode,
      startedAt,
      endedAt: Date.now(),
      result,
      runLabel: options.runLabel || null,
      eventLogPath: logger.logPath,
      metricsPath: logger.runDir ? path.join(logger.runDir, 'metrics.json') : null,
      entriesWritten: loggerStats.entriesWritten,
      hazardExposures: hazardStats.exposureCount
    })

    writeRunArtifacts({
      runDir: logger.runDir,
      summaryRecord: runSummary,
      repoRoot: path.join(__dirname, '..')
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

    const loggerStats = typeof logger.getStats === 'function' ? logger.getStats() : {}
    const runSummary = buildStandardRunRecord({
      runId,
      scenario: scenario.id,
      memoryMode: executionMode,
      startedAt,
      endedAt: Date.now(),
      result,
      error: err,
      runLabel: options.runLabel || null,
      eventLogPath: logger.logPath,
      metricsPath: logger.runDir ? path.join(logger.runDir, 'metrics.json') : null,
      entriesWritten: loggerStats.entriesWritten,
      hazardExposures: hazardStats.exposureCount
    })

    writeRunArtifacts({
      runDir: logger.runDir,
      summaryRecord: runSummary,
      repoRoot: path.join(__dirname, '..')
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
