#!/usr/bin/env node
require('dotenv').config()

const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { runScenario } = require('./runner/runScenario')

function parsePointString(token) {
  if (!token) return null
  const parts = String(token).split(',').map(Number)
  if (parts.length < 3) return null
  const [x, y, z] = parts
  if ([x, y, z].every(Number.isFinite)) {
    return { x, y, z }
  }
  return null
}

function parseArgs(argv) {
  const args = { runs: 3, mode: 'distilled' }
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--runs' && argv[i + 1]) {
      args.runs = Math.max(1, Number(argv[++i]) || args.runs)
      continue
    }
    if (token === '--mode' && argv[i + 1]) {
      args.mode = argv[++i]
      continue
    }
    if (token === '--scout-radius' && argv[i + 1]) {
      args.scout = args.scout || {}
      args.scout.scanRadius = Number(argv[++i])
      continue
    }
    if (token === '--scout-steps' && argv[i + 1]) {
      args.scout = args.scout || {}
      args.scout.maxSteps = Number(argv[++i])
      continue
    }
    if (token === '--scout-center' && argv[i + 1]) {
      const point = parsePointString(argv[++i])
      if (point) {
        args.scout = args.scout || {}
        args.scout.center = point
      }
      continue
    }
    if (token === '--scout-corner-a' && argv[i + 1]) {
      const point = parsePointString(argv[++i])
      if (point) {
        args.scout = args.scout || {}
        args.scout.cornerA = point
      }
      continue
    }
    if (token === '--scout-corner-b' && argv[i + 1]) {
      const point = parsePointString(argv[++i])
      if (point) {
        args.scout = args.scout || {}
        args.scout.cornerB = point
      }
      continue
    }
    if (token === '--skip-scout') {
      args.skipScout = true
      continue
    }
  }
  return args
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const CONDITION_SETTINGS = {
  transfer_disabled: {
    scope: 'local',
    allowedSources: 'claims_only',
    retrievalMode: 'local_claims_only'
  },
  transfer_enabled_claims_only: {
    scope: 'global',
    allowedSources: 'claims_only',
    retrievalMode: 'global_claims_only'
  },
  transfer_enabled: {
    scope: 'global',
    allowedSources: 'claims_and_raw',
    retrievalMode: 'global_claims_and_raw'
  }
}

async function executeCompositeRun(bot, condition, iteration, options) {
  const config = CONDITION_SETTINGS[condition] || CONDITION_SETTINGS.transfer_disabled
  const scope = config.scope
  const prevScope = process.env.GOAL_CLAIM_SCOPE
  const prevSources = process.env.GOAL_CLAIM_ALLOWED_SOURCES
  process.env.GOAL_CLAIM_SCOPE = scope
  process.env.GOAL_CLAIM_ALLOWED_SOURCES = config.allowedSources

  const compositeStart = Date.now()
  let scoutResult = null
  let scoutError = null
  if (!options.skipScout) {
    try {
      scoutResult = await runScenario(bot, 'scout', {
        mode: options.mode,
        runLabel: `${condition}_scout_${iteration}`,
        bounds: options.scout
      })
    } catch (err) {
      scoutError = err
      console.error('Scout scenario failed', err)
    }
    await wait(350)
  }

  const leverResult = await runScenario(bot, 'lever', {
    mode: options.mode,
    runLabel: `${condition}_lever_${iteration}`
  })

  await wait(500)

  const captiveResult = await runScenario(bot, 'captive', {
    mode: options.mode,
    runLabel: `${condition}_captive_${iteration}`
  })

  const completionTime = Date.now() - compositeStart
  process.env.GOAL_CLAIM_SCOPE = prevScope
  process.env.GOAL_CLAIM_ALLOWED_SOURCES = prevSources

  const scoutData = scoutResult?.result || {}
  const leverData = leverResult.result || {}
  const captiveData = captiveResult.result || {}

  const leverAttempts = leverData.attempts || 0
  const captiveAttempts = captiveData.attempts || 0
  const leverSolved = Boolean(leverData.solved)
  const captiveSuccess = Boolean(captiveData.success)

  const wrongLever = leverSolved ? Math.max(0, leverAttempts - 1) : leverAttempts
  const wrongCaptive = captiveData.wrongCodeEntries != null
    ? captiveData.wrongCodeEntries
    : (captiveSuccess ? Math.max(0, captiveAttempts - 1) : captiveAttempts)

  const metrics = {
    condition,
    retrieval_mode: config.retrievalMode,
    iteration,
    completion_time_ms: completionTime,
    number_of_actions: leverAttempts + captiveAttempts,
    number_of_wrong_interactions: wrongLever + wrongCaptive,
    number_of_revisits_to_lever_room: captiveData.leverRoomRevisits ?? (scope === 'local' ? 1 : 0),
    number_of_code_entries: leverAttempts + (captiveData.codeEntries ?? captiveAttempts),
    number_of_actions_lever: leverAttempts,
    number_of_actions_captive: captiveAttempts,
    scout_steps: scoutData.stepsExecuted || 0,
    scout_claims_detected: Array.isArray(scoutData.claims) ? scoutData.claims.length : 0,
    scout_cells_explored: scoutData.visitedCells || 0,
    scout_failed_moves: scoutData.failedMoves || 0,
    success: captiveSuccess,
    run_ids: {
      scout: scoutResult?.runId || null,
      lever: leverResult.runId,
      captive: captiveResult.runId
    },
    scout_error: scoutError ? (scoutError.message || 'unknown') : null,
    plan_strategy: captiveData.planStrategy || null,
    claimReferences: captiveData.claimReferences || []
  }

  metrics.number_of_wrong_interactions = Math.max(0, metrics.number_of_wrong_interactions)

  return metrics
}

function summarizeCondition(condition, runs) {
  const validRuns = runs.filter(run => run && typeof run.completion_time_ms === 'number')
  const summary = {
    condition,
    total_runs: runs.length,
    successful_runs: runs.filter(run => run && run.success).length,
    success_rate: 0,
    avg_completion_time_ms: 0,
    avg_number_of_actions: 0,
    avg_wrong_interactions: 0,
    avg_revisits_to_lever_room: 0,
    avg_code_entries: 0,
    avg_scout_steps: 0,
    avg_scout_claims_detected: 0,
    avg_scout_cells_explored: 0
  }

  if (runs.length > 0) {
    summary.success_rate = summary.successful_runs / runs.length
  }

  if (validRuns.length > 0) {
    summary.avg_completion_time_ms = average(validRuns.map(r => r.completion_time_ms))
    summary.avg_number_of_actions = average(validRuns.map(r => r.number_of_actions))
    summary.avg_wrong_interactions = average(validRuns.map(r => r.number_of_wrong_interactions))
    summary.avg_revisits_to_lever_room = average(validRuns.map(r => r.number_of_revisits_to_lever_room))
    summary.avg_code_entries = average(validRuns.map(r => r.number_of_code_entries))
    summary.avg_scout_steps = average(validRuns.map(r => r.scout_steps || 0))
    summary.avg_scout_claims_detected = average(validRuns.map(r => r.scout_claims_detected || 0))
    summary.avg_scout_cells_explored = average(validRuns.map(r => r.scout_cells_explored || 0))
  }

  return summary
}

function average(values) {
  if (!values || values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function saveExperimentResults(record, timestamp = new Date().toISOString()) {
  const experimentsDir = path.join(__dirname, 'runs', 'experiments')
  fs.mkdirSync(experimentsDir, { recursive: true })
  const safeTimestamp = timestamp.replace(/[:.]/g, '-')
  const filePath = path.join(
    experimentsDir,
    `transfer_${safeTimestamp}.json`
  )
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8')
  console.log('Experiment metrics saved to', filePath)
  return filePath
}

function saveTransferSummary(summary, timestamp = new Date().toISOString()) {
  const experimentsDir = path.join(__dirname, 'runs', 'experiments')
  fs.mkdirSync(experimentsDir, { recursive: true })
  const safeTimestamp = timestamp.replace(/[:.]/g, '-')
  const filePath = path.join(
    experimentsDir,
    `transfer_summary_${safeTimestamp}.json`
  )
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf8')
  console.log('Transfer summary saved to', filePath)
  return filePath
}

function buildTransferSummary(record) {
  const metrics = (record.conditions || []).map(entry => {
    const summary = entry.summary || {}
    const config = CONDITION_SETTINGS[entry.condition] || {}
    const avgTimeMs = summary.avg_completion_time_ms || 0
    return {
      condition: entry.condition,
      retrieval_mode: config.retrievalMode || 'unknown',
      trials_recorded: summary.total_runs || 0,
      avg_time_per_trial_ms: avgTimeMs,
      avg_time_per_trial_seconds: avgTimeMs / 1000,
      avg_actions_per_trial: summary.avg_number_of_actions || 0,
      avg_lever_revisits_per_trial: summary.avg_revisits_to_lever_room || 0,
      success_rate: summary.success_rate || 0,
      avg_scout_steps: summary.avg_scout_steps || 0,
      avg_scout_claims: summary.avg_scout_claims_detected || 0,
      avg_scout_cells: summary.avg_scout_cells_explored || 0
    }
  })

  return {
    experiment: record.experiment,
    timestamp: record.timestamp,
    runs_per_condition: record.runs_per_condition,
    memory_mode: record.memory_mode,
    metrics
  }
}

function printTransferTable(summary) {
  const rows = (summary.metrics || []).map(metric => [
    metric.condition,
    metric.retrieval_mode,
    `${metric.avg_time_per_trial_seconds.toFixed(2)}s`,
    metric.avg_actions_per_trial.toFixed(2),
    metric.avg_lever_revisits_per_trial.toFixed(2),
    `${(metric.success_rate * 100).toFixed(1)}%`
  ])

  if (rows.length === 0) {
    console.log('No transfer metrics to display yet.')
    return
  }

  const headers = [
    'Condition',
    'Retrieval Mode',
    'Time / Trial',
    'Actions / Trial',
    'Lever Revisits / Trial',
    'Success Rate'
  ]

  const colWidths = headers.map((header, idx) => {
    const maxRowWidth = Math.max(...rows.map(row => row[idx].length))
    return Math.max(header.length, maxRowWidth)
  })

  const divider = '+' + colWidths.map(width => '-'.repeat(width + 2)).join('+') + '+'
  const formatRow = values => {
    return '| ' + values.map((value, idx) => value.padEnd(colWidths[idx])).join(' | ') + ' |'
  }

  console.log('\nTRANSFER CONDITION SUMMARY')
  console.log(`Trials per condition: ${summary.runs_per_condition}`)
  console.log(divider)
  console.log(formatRow(headers))
  console.log(divider)
  rows.forEach(row => console.log(formatRow(row)))
  console.log(divider)
}

function createBot() {
  const bot = mineflayer.createBot({
    host: process.env.MC_HOST || 'localhost',
    port: Number(process.env.MC_PORT || 25565),
    username: process.env.MC_USERNAME || 'ragcraft_experiment',
    version: process.env.MC_VERSION || false
  })

  bot.loadPlugin(pathfinder)
  return bot
}

async function setupMovements(bot) {
  const mcData = mcDataLoader(bot.version)
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)
}

async function main() {
  const options = parseArgs(process.argv)
  const bot = createBot()

  bot.once('spawn', async () => {
    try {
      await setupMovements(bot)

      const conditions = ['transfer_disabled', 'transfer_enabled_claims_only', 'transfer_enabled']
      const conditionRuns = []

      for (const condition of conditions) {
        const runs = []
        for (let i = 0; i < options.runs; i++) {
          try {
            const metrics = await executeCompositeRun(bot, condition, i, options)
            runs.push(metrics)
            console.log(`[${condition}] run ${i + 1}/${options.runs}:`, {
              retrieval_mode: metrics.retrieval_mode,
              completion_time_ms: metrics.completion_time_ms,
              number_of_actions: metrics.number_of_actions,
              scout_claims_detected: metrics.scout_claims_detected,
              success: metrics.success
            })
          } catch (err) {
            console.error(`Composite run failed (${condition})`, err)
            runs.push({
              condition,
              iteration: i,
              success: false,
              error: err.message,
              completion_time_ms: null,
              number_of_actions: null,
              number_of_wrong_interactions: null,
              number_of_revisits_to_lever_room: null,
              number_of_code_entries: null
            })
          }
          await wait(750)
        }
        conditionRuns.push({
          condition,
          runs,
          summary: summarizeCondition(condition, runs)
        })
      }

      const timestamp = new Date().toISOString()
      const record = {
        experiment: 'composite_transfer',
        timestamp,
        runs_per_condition: options.runs,
        memory_mode: options.mode,
        conditions: conditionRuns
      }

      const summary = buildTransferSummary(record)
      const recordPath = saveExperimentResults(record, timestamp)
      const summaryPath = saveTransferSummary(summary, timestamp)
      printTransferTable(summary)
      console.log('\nSummary JSON:', summaryPath)
      console.log('Full run log:', recordPath)
    } catch (err) {
      console.error('Experiment runner failed:', err)
      process.exitCode = 1
    } finally {
      bot.quit()
    }
  })
}

main()
