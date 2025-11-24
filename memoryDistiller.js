const { v4: uuidv4 } = require('uuid')

function formatTurnSequence(turnSequence = []) {
  if (!Array.isArray(turnSequence) || turnSequence.length === 0) return '[]'
  const trimmed = turnSequence
    .map(point => {
      if (!point) return null
      const x = Number(point.x ?? point[0] ?? 0)
      const y = Number(point.y ?? point[1] ?? 0)
      const z = Number(point.z ?? point[2] ?? 0)
      return { x, y, z }
    })
    .filter(Boolean)
  return JSON.stringify(trimmed)
}

function distillLeverAttempt(attempt) {
  const sequenceText = Array.isArray(attempt.sequence)
    ? attempt.sequence.join('-')
    : 'unknown'
  const success = Boolean(attempt.success)
  const statusText = success ? 'Successful' : 'Failed'
  const confidence = success ? 0.9 : 0.55

  return [{
    id: uuidv4(),
    scenarioId: attempt.scenarioId,
    type: 'lever_sequence_distilled',
    text: `${statusText} lever sequence ${sequenceText} at attempt ${attempt.attemptIndex ?? 'n/a'}`,
    confidence,
    evidenceRunIds: attempt.runId ? [attempt.runId] : [],
    timestamp: attempt.timestamp || Date.now()
  }]
}

function distillKeyFinderAttempt(attempt) {
  const actionCount = Array.isArray(attempt.actions) ? attempt.actions.length : 0
  const found = Boolean(attempt.success)
  const focusPos = attempt.targetPos
    ? ` (${attempt.targetPos.x},${attempt.targetPos.y},${attempt.targetPos.z})`
    : ''
  const statusText = found ? 'Key found' : 'Key not found'
  const confidence = found ? 0.85 : 0.5

  const advisory = found
    ? 'Prioritize this area for future searches.'
    : 'Avoid repeating this exact search path unless new evidence appears.'

  return [{
    id: uuidv4(),
    scenarioId: attempt.scenarioId,
    type: 'key_finder_distilled',
    text: `${statusText}${focusPos} after ${actionCount} actions. ${advisory}`,
    confidence,
    evidenceRunIds: attempt.runId ? [attempt.runId] : [],
    timestamp: attempt.timestamp || Date.now()
  }]
}

function distillMazeAttempt(attempt) {
  const turnSequence = Array.isArray(attempt.turnSequence) ? attempt.turnSequence : []
  const serializedSequence = turnSequence.length > 0 ? formatTurnSequence(turnSequence) : null
  const stepCount = attempt.stepCount ?? turnSequence.length ?? 0
  const success = Boolean(attempt.success)

  const payload = {
    outcome: success ? 'success' : 'failed',
    stepCount,
    turnSequence,
    rule: success
      ? serializedSequence
        ? `Successful route uses turn sequence ${serializedSequence}`
        : `Reached goal after ${stepCount} steps`
      : serializedSequence
        ? `Avoid turn sequence ${serializedSequence} because it led to a dead end`
        : 'Avoid repeating this attempt; it failed without a recorded route'
  }

  return [{
    id: uuidv4(),
    scenarioId: attempt.scenarioId,
    type: 'maze_distilled',
    text: JSON.stringify(payload),
    confidence: success ? 0.85 : 0.55,
    evidenceRunIds: attempt.runId ? [attempt.runId] : [],
    timestamp: attempt.timestamp || Date.now()
  }]
}

function distillMemoryUnits(attempt) {
  if (!attempt || !attempt.scenarioId) return []

  if (attempt.scenarioId.startsWith('lever_puzzle')) {
    return distillLeverAttempt(attempt)
  }

  if (attempt.scenarioId.startsWith('key_finder')) {
    return distillKeyFinderAttempt(attempt)
  }

  if (attempt.scenarioId.startsWith('maze')) {
    return distillMazeAttempt(attempt)
  }

  return []
}

module.exports = { distillMemoryUnits }