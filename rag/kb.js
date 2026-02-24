
const fs = require('fs')
const path = require('path')
const { addRawEpisode } = require('./store/vectorStore')

const ragDir = __dirname
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

async function ingestLeverAttempt(attempt) {
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

  const text = `${attempt.success ? 'Successful' : 'Failed'} lever sequence ${attempt.sequence.join('-')}`
  try {
    await addRawEpisode({
      id: entry.runId + '_' + attempt.attemptIndex,
      scenarioId: entry.scenarioId,
      type: 'lever_attempt',
      text,
      timestamp: entry.timestamp
    })
  } catch (err) {
  }
}

function retrieveLeverAttempts(scenarioId) {
  return kb.filter(item => item.type === 'lever_attempt' && item.scenarioId === scenarioId)
}

async function ingestKeyFinderAttempt(attempt) {
  const entry = {
    type: 'key_attempt',
    scenarioId: attempt.scenarioId,
    runId: attempt.runId,
    attemptIndex: attempt.attemptIndex,
    targetPos: attempt.targetPos,
     keyPos: attempt.keyPos,
     searchPath: attempt.searchPath,
     visitedCells: attempt.visitedCells,
    actions: attempt.actions,
     obtainedKey: attempt.obtainedKey,
    success: attempt.success,
    timestamp: attempt.timestamp || Date.now()
  }
  kb.push(entry)
  saveKb(kb)

  const focus = attempt.keyPos || attempt.targetPos || (attempt.searchPath && attempt.searchPath[attempt.searchPath.length - 1]) || { x: 0, y: 0, z: 0 }
  const text = `${attempt.success ? 'Key found' : 'Key not found'} at (${focus.x},${focus.y},${focus.z})`
  try {
    await addRawEpisode({
      id: entry.runId + '_' + attempt.attemptIndex,
      scenarioId: entry.scenarioId,
      type: 'key_attempt',
      text,
      timestamp: entry.timestamp
    })
  } catch (err) {
  }
}

function retrieveKeyFinderAttempts(scenarioId) {
  return kb.filter(item => item.type === 'key_attempt' && item.scenarioId === scenarioId)
}

async function ingestMazeAttempt(attempt) {
  const entry = {
    type: 'maze_attempt',
    scenarioId: attempt.scenarioId,
    runId: attempt.runId,
    attemptIndex: attempt.attemptIndex,
    actions: attempt.actions,
    turnSequence: attempt.turnSequence,
    success: attempt.success,
    stepCount: attempt.stepCount,
    timestamp: attempt.timestamp || Date.now()
  }
  kb.push(entry)
  saveKb(kb)

  const text = `${attempt.success ? 'Successful' : 'Failed'} maze navigation with ${attempt.stepCount} steps`
  try {
    await addRawEpisode({
      id: entry.runId + '_' + attempt.attemptIndex,
      scenarioId: entry.scenarioId,
      type: 'maze_attempt',
      text,
      timestamp: entry.timestamp
    })
  } catch (err) {
  }
}

function retrieveMazeAttempts(scenarioId) {
  return kb.filter(item => item.type === 'maze_attempt' && item.scenarioId === scenarioId)
}

module.exports = {
  ragRetrieve,
  ragIngestTrial,
  ingestLeverAttempt,
  retrieveLeverAttempts,
  ingestKeyFinderAttempt,
  retrieveKeyFinderAttempts,
  ingestMazeAttempt,
  retrieveMazeAttempts
}
