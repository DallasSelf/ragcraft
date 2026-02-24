const path = require('path')
const { createLogger } = require('../logging/logger')
const { getScenarioByName, scenarios, listScenarios } = require('./scenarioRegistry')

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
  logger.log('run_start', {
    scenarioId: scenario.id,
    runId,
    mode: options.mode || 'default',
    runLabel: options.runLabel || null,
    git: options.git || null
  })

  let result = null
  const startedAt = Date.now()
  try {
    result = await scenario.run(bot, logger, { ...options, runId, scenarioId: scenario.id })
    logger.log('run_end', {
      scenarioId: scenario.id,
      runId,
      runLabel: options.runLabel || null,
      ms: Date.now() - startedAt,
      result
    })
    return { scenarioId: scenario.id, runId, runLabel: options.runLabel || null, result }
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
