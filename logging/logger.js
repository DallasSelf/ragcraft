const fs = require('fs')
const path = require('path')

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function safeSlug(value, fallback = 'unknown') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || fallback
}

function normalizeMemoryMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  return safeSlug(mode || 'unknown')
}

function buildRunDir(baseRunsDir, scenarioId, memoryMode, runId) {
  const scenarioSlug = safeSlug(scenarioId, 'unknown')
  const modeSlug = normalizeMemoryMode(memoryMode)
  const runSlug = safeSlug(runId, `run-${nowStamp()}`)
  const runDir = path.join(baseRunsDir, scenarioSlug, modeSlug, runSlug)
  ensureDir(runDir)
  return {
    scenarioId: scenarioSlug,
    memoryMode: modeSlug,
    runId: runSlug,
    runDir,
    logPath: path.join(runDir, 'events.jsonl')
  }
}

function resolveLogPath(arg) {
  const baseRunsDir = path.resolve(__dirname, '..', 'runs')
  ensureDir(baseRunsDir)

  if (typeof arg === 'string') {
    return {
      logPath: path.join(baseRunsDir, `${safeSlug(arg)}.jsonl`),
      runDir: null,
      scenarioId: null,
      memoryMode: null,
      runId: null
    }
  }

  if (arg && (arg.scenarioId || arg.memoryMode || arg.mode || arg.runId)) {
    return buildRunDir(
      baseRunsDir,
      arg.scenarioId || 'unknown',
      arg.memoryMode || arg.mode || 'unknown',
      arg.runId || `run-${nowStamp()}`
    )
  }

  const dirPath = arg && arg.dirPath ? path.resolve(arg.dirPath) : null
  const fileBase = arg && arg.fileBase ? String(arg.fileBase) : null

  if (dirPath && fileBase) {
    ensureDir(dirPath)
    return {
      logPath: path.join(dirPath, `${safeSlug(fileBase)}.jsonl`),
      runDir: dirPath,
      scenarioId: arg && arg.scenarioId ? safeSlug(arg.scenarioId) : null,
      memoryMode: arg && (arg.memoryMode || arg.mode) ? normalizeMemoryMode(arg.memoryMode || arg.mode) : null,
      runId: safeSlug(fileBase)
    }
  }

  const scenarioId = arg && arg.scenarioId ? String(arg.scenarioId) : 'unknown'
  const runId = arg && arg.runId ? String(arg.runId) : `run-${nowStamp()}`
  return buildRunDir(baseRunsDir, scenarioId, arg && (arg.memoryMode || arg.mode), runId)
}

function createLogger(arg) {
  const resolved = resolveLogPath(arg)
  const stream = fs.createWriteStream(resolved.logPath, { flags: 'a' })
  let entriesWritten = 0

  function log(type, payload = {}) {
    const entry = {
      type,
      timestamp: Date.now(),
      ...payload
    }
    stream.write(JSON.stringify(entry) + '\n')
    entriesWritten += 1
  }

  function close() {
    stream.end()
  }

  function getStats() {
    return {
      entriesWritten,
      scenarioId: resolved.scenarioId,
      memoryMode: resolved.memoryMode,
      runId: resolved.runId
    }
  }

  return {
    log,
    close,
    getStats,
    logPath: resolved.logPath,
    runDir: resolved.runDir,
    scenarioId: resolved.scenarioId,
    memoryMode: resolved.memoryMode,
    runId: resolved.runId
  }
}

module.exports = { createLogger }
