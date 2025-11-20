
const fs = require('fs')
const path = require('path')

const ragDir = path.join(process.cwd(), 'rag')
if (!fs.existsSync(ragDir)) fs.mkdirSync(ragDir, { recursive: true })

const kbFile = path.join(ragDir, 'kb.json')

function loadKb() {
  if (!fs.existsSync(kbFile)) return []
  try {
    const raw = fs.readFileSync(kbFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveKb(kb) {
  fs.writeFileSync(kbFile, JSON.stringify(kb, null, 2), 'utf8')
}

let kb = loadKb()

function ragRetrieve(query) {
  const scenarioId = query.scenarioId
  const items = kb.filter(item => item.scenarioId === scenarioId && item.success)
  const sorted = items.sort((a, b) => b.timestamp - a.timestamp)
  return sorted.slice(0, 3)
}

function ragIngestTrial(trial) {
  const item = {
    scenarioId: trial.scenarioId,
    runId: trial.runId,
    success: trial.success,
    steps: trial.steps,
    lastPosition: trial.lastPosition,
    timestamp: Date.now(),
    type: 'episode_summary'
  }
  kb.push(item)
  saveKb(kb)
}

function ingestLeverAttempt(attempt) {
  const entry = {
    type: 'lever_attempt',
    scenarioId: attempt.scenarioId,
    runId: attempt.runId,
    sequence: attempt.sequence,
    success: attempt.success,
    timestamp: Date.now()
  }
  kb.push(entry)
  saveKb(kb)
}

function retrieveLeverAttempts(scenarioId) {
  return kb.filter(item => item.type === 'lever_attempt' && item.scenarioId === scenarioId)
}

module.exports = {
  ragRetrieve,
  ragIngestTrial,
  ingestLeverAttempt,
  retrieveLeverAttempts
}
