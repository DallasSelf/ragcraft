const { v4: uuidv4 } = require('uuid')
const { distillWithLLM } = require('./llm/distiller')
/**
 * Formats a turn sequence array into a JSON string representation.
 * @param {Array} turnSequence - Array of points (objects with x,y,z or arrays [x,y,z])
 * @returns {string} JSON string representation of the sequence
 */
function formatTurnSequence(turnSequence = []) {
  if (!Array.isArray(turnSequence) || turnSequence.length === 0) return '[]'
  const trimmed = turnSequence
    .map(point => {
      if (!point) return null
      const x = Number(point.x ?? point[0] ?? 0)
      const y = Number(point.y ?? point[1] ?? 0)
      const z = Number(point.z ?? point[2] ?? 0)
      // Filter out points that are all zeros (likely invalid)
      if (x === 0 && y === 0 && z === 0) return null
      return { x, y, z }
    })
    .filter(Boolean)
  return JSON.stringify(trimmed)
}

/**
 * Distills a lever puzzle attempt into a memory unit.
 * @param {Object} attempt - The attempt object
 * @param {string} attempt.scenarioId - Scenario identifier
 * @param {string} [attempt.runId] - Run identifier for evidence tracking
 * @param {Array|string} [attempt.sequence] - Lever sequence
 * @param {boolean} [attempt.success] - Whether the attempt was successful
 * @param {number} [attempt.attemptIndex] - Index of the attempt
 * @param {number} [attempt.timestamp] - Timestamp of the attempt
 * @returns {Array} Array containing one distilled memory unit
 */
function distillLeverAttempt(attempt) {
  if (!attempt || typeof attempt.scenarioId !== 'string') {
    return []
  }

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

/**
 * Distills a key finder attempt into a memory unit.
 * @param {Object} attempt - The attempt object
 * @param {string} attempt.scenarioId - Scenario identifier
 * @param {string} [attempt.runId] - Run identifier for evidence tracking
 * @param {Array} [attempt.actions] - Array of actions taken
 * @param {Object} [attempt.targetPos] - Target position object
 * @param {number} [attempt.targetPos.x] - X coordinate
 * @param {number} [attempt.targetPos.y] - Y coordinate
 * @param {number} [attempt.targetPos.z] - Z coordinate
 * @param {boolean} [attempt.success] - Whether the key was found
 * @param {number} [attempt.timestamp] - Timestamp of the attempt
 * @returns {Array} Array containing one distilled memory unit
 */
function distillKeyFinderAttempt(attempt) {
  if (!attempt || typeof attempt.scenarioId !== 'string') {
    return []
  }

  const actionCount = Array.isArray(attempt.actions) ? attempt.actions.length : 0
  const found = Boolean(attempt.success)
  
  // Safely extract position coordinates
  let focusPos = ''
  if (attempt.targetPos && typeof attempt.targetPos === 'object') {
    const x = attempt.targetPos.x ?? attempt.targetPos[0] ?? 0
    const y = attempt.targetPos.y ?? attempt.targetPos[1] ?? 0
    const z = attempt.targetPos.z ?? attempt.targetPos[2] ?? 0
    focusPos = ` (${x},${y},${z})`
  }
  
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

/**
 * Distills a maze navigation attempt into a memory unit.
 * @param {Object} attempt - The attempt object
 * @param {string} attempt.scenarioId - Scenario identifier
 * @param {string} [attempt.runId] - Run identifier for evidence tracking
 * @param {Array} [attempt.turnSequence] - Array of turn points
 * @param {number} [attempt.stepCount] - Number of steps taken
 * @param {boolean} [attempt.success] - Whether the maze was solved
 * @param {number} [attempt.timestamp] - Timestamp of the attempt
 * @returns {Array} Array containing one distilled memory unit
 */
function distillMazeAttempt(attempt) {
  if (!attempt || typeof attempt.scenarioId !== 'string') {
    return []
  }

  const turnSequence = Array.isArray(attempt.turnSequence) ? attempt.turnSequence : []
  const serializedSequence = turnSequence.length > 0 ? formatTurnSequence(turnSequence) : null
  // Use stepCount if provided and > 0, otherwise fall back to turnSequence length, then 0
  const stepCount = (typeof attempt.stepCount === 'number' && attempt.stepCount >= 0)
    ? attempt.stepCount
    : (turnSequence.length > 0 ? turnSequence.length : 0)
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

/**
 * Main function to distill an attempt into memory units based on scenario type.
 * @param {Object} attempt - The attempt object to distill
 * @param {string} attempt.scenarioId - Scenario identifier (must be a string)
 * @returns {Array} Array of distilled memory units (empty if invalid or unknown scenario)
 */
async function distillMemoryUnits(attempt) {
  if (!attempt || !attempt.scenarioId) return []

  if (typeof attempt.scenarioId !== 'string') {
    return []
  }

  if (process.env.LLM_ENABLED === 'true') {
    try {
      const unit = await distillWithLLM(attempt)
      if (unit) return [unit]
    } catch (error) {
      console.error('LLM distillation failed, using template:', error.message)
    }
  }

  try {
    if (attempt.scenarioId.startsWith('lever_puzzle')) {
      return distillLeverAttempt(attempt)
    }

    if (attempt.scenarioId.startsWith('key_finder')) {
      return distillKeyFinderAttempt(attempt)
    }

    if (attempt.scenarioId.startsWith('maze')) {
      return distillMazeAttempt(attempt)
    }
  } catch (error) {
    console.error('Error distilling memory units:', error)
    return []
  }

  return []
}

module.exports = { distillMemoryUnits }