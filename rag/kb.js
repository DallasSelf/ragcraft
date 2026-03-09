
const fs = require('fs')
const path = require('path')
const { addRawEpisode } = require('./store/vectorStore')
const { getProfileAwarePath, onMemoryProfileChange } = require('./memory/profile')

const ragDir = __dirname
if (!fs.existsSync(ragDir)) fs.mkdirSync(ragDir, { recursive: true })

function getKbFilePath() {
  return getProfileAwarePath(ragDir, 'kb.json')
}

function loadKb() {
  const file = getKbFilePath()
  if (!fs.existsSync(file)) return []
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveKb(kb) {
  const file = getKbFilePath()
  fs.writeFileSync(file, JSON.stringify(kb, null, 2), 'utf8')
}

let kb = loadKb()

onMemoryProfileChange(() => {
  kb = loadKb()
})

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
    wrongTurns: attempt.wrongTurns || 0,
    revisitCount: attempt.revisitCount || 0,
    pathEfficiency: attempt.pathEfficiency || 0,
    optimalPathLength: attempt.optimalPathLength || null,
    baselinePathLength: attempt.baselinePathLength || null,
    decisionNodes: Array.isArray(attempt.decisionNodes) ? attempt.decisionNodes : [],
    optimalPath: Array.isArray(attempt.optimalPath) ? attempt.optimalPath : [],
    timestamp: attempt.timestamp || Date.now()
  }
  kb.push(entry)
  saveKb(kb)

  const text = `${attempt.success ? 'Successful' : 'Failed'} maze navigation with ${attempt.stepCount} steps, ${entry.wrongTurns} wrong turns, efficiency ${entry.pathEfficiency || 0}`
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

function resetKb() {
  kb = []
  saveKb(kb)
}

module.exports = {
  ragRetrieve,
  ragIngestTrial,
  ingestLeverAttempt,
  retrieveLeverAttempts,
  ingestKeyFinderAttempt,
  retrieveKeyFinderAttempts,
  ingestMazeAttempt,
  retrieveMazeAttempts,
  resetKb
}
