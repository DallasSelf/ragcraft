const fs = require('fs')
const path = require('path')

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function safeString(value) {
  if (value === null || value === undefined) return null
  return String(value)
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  return mode || 'unknown'
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null
}

function deriveSuccess(result = {}) {
  if (typeof result.success === 'boolean') return result.success
  if (typeof result.solved === 'boolean') return result.solved
  if (typeof result.found === 'boolean') return result.found
  return null
}

function deriveAttempts(result = {}) {
  if (Number.isFinite(result.attempts)) return Number(result.attempts)
  if (Number.isFinite(result.stepsExecuted)) return Number(result.stepsExecuted)
  return null
}

function deriveActionCount(result = {}) {
  if (Number.isFinite(result.action_count)) return Number(result.action_count)
  if (Number.isFinite(result.actionCount)) return Number(result.actionCount)
  if (Number.isFinite(result.totalActions)) return Number(result.totalActions)
  if (Array.isArray(result.actions)) return result.actions.length
  return null
}

function deriveErrorList(error) {
  if (!error) return []
  if (Array.isArray(error)) {
    return error.map(item => safeString(item)).filter(Boolean)
  }
  const message = typeof error === 'string'
    ? error
    : safeString(error.message || error.code || error)
  return message ? [message] : []
}

function buildStandardRunRecord({
  runId,
  scenario,
  memoryMode,
  startedAt,
  endedAt,
  result,
  error,
  runLabel,
  eventLogPath,
  metricsPath,
  entriesWritten,
  hazardExposures
}) {
  const ts = numberOrNull(endedAt) || Date.now()
  const durationSeconds = Number.isFinite(startedAt) && Number.isFinite(endedAt)
    ? Number(((endedAt - startedAt) / 1000).toFixed(3))
    : null

  const base = {
    run_id: safeString(runId),
    timestamp: new Date(ts).toISOString(),
    scenario: safeString(scenario) || 'unknown',
    memory_mode: normalizeMode(memoryMode),
    success: deriveSuccess(result),
    attempts: deriveAttempts(result),
    duration_seconds: durationSeconds,
    action_count: deriveActionCount(result),
    errors: deriveErrorList(error),
    revisits: numberOrNull(result && result.revisits),
    wrong_turns: numberOrNull(result && result.wrongTurns),
    path_efficiency: numberOrNull(result && result.pathEfficiency),
    metadata: {
      run_label: safeString(runLabel),
      hazard_exposures: numberOrNull(hazardExposures),
      event_count: numberOrNull(entriesWritten),
      event_log_path: safeString(eventLogPath),
      metrics_path: safeString(metricsPath),
      raw_result: result && typeof result === 'object' ? result : null
    }
  }

  return base
}

function writeRunArtifacts({ runDir, summaryRecord, repoRoot }) {
  if (!runDir || !summaryRecord) return null

  ensureDir(runDir)
  const summaryPath = path.join(runDir, 'summary.json')
  fs.writeFileSync(summaryPath, JSON.stringify(summaryRecord, null, 2), 'utf8')

  const summaryRoot = path.join(repoRoot, 'runs', '_summary')
  ensureDir(summaryRoot)

  const allRunsPath = path.join(summaryRoot, 'all_runs.jsonl')
  fs.appendFileSync(allRunsPath, JSON.stringify(summaryRecord) + '\n', 'utf8')

  const latestPath = path.join(summaryRoot, 'latest_run.json')
  fs.writeFileSync(latestPath, JSON.stringify(summaryRecord, null, 2), 'utf8')

  return {
    summaryPath,
    allRunsPath,
    latestPath
  }
}

module.exports = {
  buildStandardRunRecord,
  writeRunArtifacts
}
