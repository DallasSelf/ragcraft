#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { resetFacility } = require('../runner/facilityReset')
const { resetKnowledgeStores } = require('../runner/knowledgeReset')

const REPO_ROOT = path.resolve(__dirname, '..')
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'runs', 'composite')

const GOAL_TYPES = [
  { id: 'maze', label: 'Maze Goal', scenario: 'maze' },
  { id: 'unlock', label: 'Unlock Goal', scenario: 'lever' },
  { id: 'captive', label: 'Captive Goal', scenario: 'captive' },
  { id: 'artifact', label: 'Retrieve Artifact Goal', scenario: 'key' }
]

const CONDITIONS = [
  {
    id: 'A',
    label: 'Condition A – No Scout / No Transfer',
    description: 'Baseline runs without scouting or cross-task transfer.',
    requiresScout: false,
    carryKnowledgeBetweenGoals: false,
    resetMemoryBeforeTrials: true,
    mode: 'distilled',
    env: {
      GOAL_CLAIM_SCOPE: 'local',
      GOAL_CLAIM_ALLOWED_SOURCES: 'claims_only'
    }
  },
  {
    id: 'B',
    label: 'Condition B – Scout + Full Transfer',
    description: 'Pre-scout plus cross-task transfer using claims and raw context.',
    requiresScout: true,
    carryKnowledgeBetweenGoals: true,
    resetMemoryBeforeTrials: false,
    mode: 'hybrid',
    env: {
      GOAL_CLAIM_SCOPE: 'global',
      GOAL_CLAIM_ALLOWED_SOURCES: 'claims_and_raw'
    }
  },
  {
    id: 'C',
    label: 'Condition C – Scout + Claims Only',
    description: 'Pre-scout plus claims-only transfer with global scope.',
    requiresScout: true,
    carryKnowledgeBetweenGoals: true,
    resetMemoryBeforeTrials: false,
    mode: 'distilled',
    env: {
      GOAL_CLAIM_SCOPE: 'global',
      GOAL_CLAIM_ALLOWED_SOURCES: 'claims_only'
    }
  }
]

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    trials: 3,
    delayMs: 1500,
    outputPath: undefined,
    outputDisabled: false,
    wipeMemory: false,
    verboseReset: false
  }

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token === '--trials' && args[i + 1]) {
      options.trials = Math.max(1, Number(args[i + 1]))
      i += 1
    } else if (token === '--delay' && args[i + 1]) {
      options.delayMs = Math.max(0, Number(args[i + 1]))
      i += 1
    } else if (token === '--output' && args[i + 1]) {
      const value = args[i + 1]
      if (value.toLowerCase() === 'none') {
        options.outputDisabled = true
        options.outputPath = null
      } else {
        options.outputPath = path.resolve(value)
      }
      i += 1
    } else if (token === '--wipeMemory' || token === '--wipe-memory' || token === '--wipe') {
      options.wipeMemory = true
    } else if (token === '--verboseReset') {
      options.verboseReset = true
    }
  }

  if (!options.outputDisabled && !options.outputPath) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    if (!fs.existsSync(DEFAULT_OUTPUT_DIR)) {
      fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true })
    }
    options.outputPath = path.join(DEFAULT_OUTPUT_DIR, `composite-${stamp}.json`)
  }

  return options
}

function delay(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}

function extractJson(text) {
  if (!text) return null
  const trimmed = text.trim()
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  const candidate = trimmed.slice(first, last + 1)
  try {
    return JSON.parse(candidate)
  } catch (err) {
    return null
  }
}

function interpretGoalResult(goalId, runData) {
  const result = runData?.result || null
  switch (goalId) {
    case 'maze':
    case 'unlock':
      return {
        success: Boolean(result?.solved),
        attempts: Number.isFinite(result?.attempts) ? result.attempts : null
      }
    case 'artifact':
      return {
        success: Boolean(result?.found),
        attempts: Number.isFinite(result?.attempts) ? result.attempts : null
      }
    case 'captive':
      return {
        success: Boolean(result?.success),
        attempts: Number.isFinite(result?.attempts) ? result.attempts : null
      }
    default:
      return { success: false, attempts: null }
  }
}

function initializeGoalSummaries() {
  const summaries = {}
  GOAL_TYPES.forEach(goal => {
    summaries[goal.id] = {
      goalId: goal.id,
      label: goal.label,
      scenario: goal.scenario,
      runs: [],
      totals: {
        runCount: 0,
        successCount: 0,
        attemptSamples: 0,
        attemptSum: 0
      }
    }
  })
  return summaries
}

function recordGoalRun(summary, detail) {
  summary.runs.push(detail)
  summary.totals.runCount += 1
  if (detail.success) summary.totals.successCount += 1
  if (Number.isFinite(detail.attempts)) {
    summary.totals.attemptSamples += 1
    summary.totals.attemptSum += detail.attempts
  }
}

function finalizeGoalSummary(summary) {
  const runCount = summary.totals.runCount || 1
  const attemptSamples = summary.totals.attemptSamples || 0
  return {
    goalId: summary.goalId,
    label: summary.label,
    scenario: summary.scenario,
    runs: summary.runs,
    successRate: summary.totals.successCount / runCount,
    avgAttempts: attemptSamples > 0 ? summary.totals.attemptSum / attemptSamples : null
  }
}

async function runScenarioProcess(scenario, mode, label, envOverrides = {}) {
  const scriptPath = path.join(REPO_ROOT, 'run.js')
  const args = [scriptPath, scenario]
  if (mode) {
    args.push('--mode', mode)
  }
  if (label) {
    args.push('--label', label)
  }

  const childEnv = { ...process.env, ...envOverrides }

  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
    })

    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('close', code => {
      const parsed = extractJson(stdout)
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
        result: parsed
      })
    })
  })
}

async function runCondition(condition, options) {
  const goalSummaries = initializeGoalSummaries()
  const logPrefix = `[Condition ${condition.id}]`

  for (let trial = 1; trial <= options.trials; trial += 1) {
    console.log(`${logPrefix} Starting trial ${trial} / ${options.trials}`)
    console.log(`${logPrefix} Resetting facility before trial ${trial} ...`)
    const facilitySummary = await resetFacility({ quiet: !options.verboseReset })
    if (options.verboseReset) {
      console.log(`${logPrefix} Facility reset summary:`, facilitySummary)
    }

    if (options.wipeMemory || condition.resetMemoryBeforeTrials) {
      resetKnowledgeStores()
      console.log(`${logPrefix} Knowledge stores cleared before trial ${trial}`)
    }

    if (condition.requiresScout) {
      const scoutLabel = `${condition.id}-trial${trial}-scout`
      const scoutEnv = {
        ...condition.env,
        COMPOSITE_CONDITION: condition.id,
        COMPOSITE_PHASE: 'scout'
      }
      console.log(`${logPrefix} Trial ${trial}: running scout pass (${scoutLabel})`)
      await runScenarioProcess('scout', condition.mode, scoutLabel, scoutEnv)
      await delay(options.delayMs)
    }

    for (const goal of GOAL_TYPES) {
      if (!condition.carryKnowledgeBetweenGoals || options.wipeMemory) {
        resetKnowledgeStores()
        console.log(`${logPrefix} Cleared knowledge stores before ${goal.label}`)
      }

      const label = `${condition.id}-trial${trial}-${goal.id}`
      const goalEnv = {
        ...condition.env,
        COMPOSITE_CONDITION: condition.id,
        COMPOSITE_GOAL: goal.id,
        COMPOSITE_TRIAL: String(trial)
      }

      console.log(`${logPrefix} Trial ${trial}: running ${goal.label} (${label})`)
      const runData = await runScenarioProcess(goal.scenario, condition.mode, label, goalEnv)
      const interpreted = interpretGoalResult(goal.id, runData)
      const detail = {
        label,
        trial,
        scenario: goal.scenario,
        success: interpreted.success && runData.ok,
        attempts: interpreted.attempts,
        runId: runData.result?.runId || null,
        exitCode: runData.exitCode
      }
      recordGoalRun(goalSummaries[goal.id], detail)
      if (options.delayMs > 0) {
        await delay(options.delayMs)
      }
    }
  }

  const finalizedGoals = Object.values(goalSummaries).map(finalizeGoalSummary)
  const totals = finalizedGoals.reduce((acc, entry) => {
    acc.runCount += entry.runs.length
    acc.successSum += entry.successRate * entry.runs.length
    if (Number.isFinite(entry.avgAttempts)) {
      acc.attemptSum += entry.avgAttempts
      acc.attemptSamples += 1
    }
    return acc
  }, { runCount: 0, successSum: 0, attemptSum: 0, attemptSamples: 0 })

  const overallSuccessRate = totals.runCount > 0 ? totals.successSum / totals.runCount : 0
  const overallAvgAttempts = totals.attemptSamples > 0 ? totals.attemptSum / totals.attemptSamples : null

  return {
    conditionId: condition.id,
    label: condition.label,
    description: condition.description,
    trials: options.trials,
    requiresScout: condition.requiresScout,
    mode: condition.mode,
    env: condition.env,
    goals: finalizedGoals,
    overall: {
      successRate: overallSuccessRate,
      avgAttempts: overallAvgAttempts,
      totalRuns: totals.runCount
    }
  }
}

function printSummary(experiment) {
  console.log('\nComposite Experiment Summary')
  experiment.conditions.forEach(condition => {
    console.log(`\n${condition.label}`)
    console.log(`  Success Rate: ${(condition.overall.successRate * 100).toFixed(1)}% (${condition.overall.totalRuns} runs)`)
    if (Number.isFinite(condition.overall.avgAttempts)) {
      console.log(`  Avg Attempts: ${condition.overall.avgAttempts.toFixed(2)}`)
    }
    condition.goals.forEach(goal => {
      const rate = (goal.successRate * 100).toFixed(1)
      const attemptText = Number.isFinite(goal.avgAttempts)
        ? goal.avgAttempts.toFixed(2)
        : 'n/a'
      console.log(`    - ${goal.label}: ${rate}% success, avg attempts ${attemptText}`)
    })
  })
}

async function main() {
  const options = parseArgs()
  const experiment = {
    startedAt: new Date().toISOString(),
    trialsPerCondition: options.trials,
    delayMs: options.delayMs,
    conditions: []
  }

  for (const condition of CONDITIONS) {
    const summary = await runCondition(condition, options)
    experiment.conditions.push(summary)
  }

  experiment.completedAt = new Date().toISOString()

  if (options.outputPath) {
    const dir = path.dirname(options.outputPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(options.outputPath, JSON.stringify(experiment, null, 2), 'utf8')
    console.log(`\nAggregate metrics saved to ${path.relative(REPO_ROOT, options.outputPath)}`)
  }

  printSummary(experiment)
}

main().catch(err => {
  console.error('Composite experiment runner failed:', err)
  process.exit(1)
})
