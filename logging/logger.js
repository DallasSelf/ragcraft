const fs = require('fs')
const path = require('path')

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function resolveLogPath(arg) {
  const baseRunsDir = path.resolve(__dirname, '..', 'runs')
  ensureDir(baseRunsDir)

  if (typeof arg === 'string') {
    return path.join(baseRunsDir, `${arg}.jsonl`)
  }

  const dirPath = arg && arg.dirPath ? path.resolve(arg.dirPath) : null
  const fileBase = arg && arg.fileBase ? String(arg.fileBase) : null

  if (dirPath && fileBase) {
    ensureDir(dirPath)
    return path.join(dirPath, `${fileBase}.jsonl`)
  }

  const scenarioId = arg && arg.scenarioId ? String(arg.scenarioId) : 'unknown'
  const runId = arg && arg.runId ? String(arg.runId) : `run-${nowStamp()}`

  const perScenarioDir = path.join(baseRunsDir, scenarioId)
  ensureDir(perScenarioDir)
  return path.join(perScenarioDir, `${runId}.jsonl`)
}

function createLogger(arg) {
  const logPath = resolveLogPath(arg)
  const stream = fs.createWriteStream(logPath, { flags: 'a' })

  function log(type, payload = {}) {
    const entry = {
      type,
      timestamp: Date.now(),
      ...payload
    }
    stream.write(JSON.stringify(entry) + '\n')
  }

  function close() {
    stream.end()
  }

  return { log, close, logPath }
}

module.exports = { createLogger }
