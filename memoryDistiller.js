const { v4: uuidv4 } = require('uuid')
const { distillWithLLM } = require('./llm/distiller')

function normalizeLeverSequenceText(attempt) {
  if (!attempt || !Array.isArray(attempt.sequence) || attempt.sequence.length === 0) {
    return null
  }

  const sequenceText = attempt.sequence
    .map(n => Number(n))
    .filter(n => Number.isFinite(n))
    .join('-')

  if (!sequenceText) return null

  const attemptIndex =
    typeof attempt.attemptIndex === 'number' && Number.isFinite(attempt.attemptIndex)
      ? attempt.attemptIndex
      : 'n/a'
  const statusText = attempt.success ? 'Successful' : 'Failed'

  return `${statusText} lever sequence ${sequenceText} at attempt ${attemptIndex}`
}
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

  const normalizedText = normalizeLeverSequenceText(attempt) || 'Lever sequence: unknown'
  const success = Boolean(attempt.success)
  const confidence = success ? 0.9 : 0.55

  return [{
    id: uuidv4(),
    scenarioId: attempt.scenarioId,
    type: 'lever_sequence_distilled',
    text: normalizedText,
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
  const visitedCount = Array.isArray(attempt.visitedCells) ? attempt.visitedCells.length : 0
  const searchCount = Array.isArray(attempt.searchPath) ? attempt.searchPath.length : 0

  const targetPos = attempt.targetPos || null
  const targetPosText = targetPos
    ? `(${targetPos.x ?? 0},${targetPos.y ?? 0},${targetPos.z ?? 0})`
    : '(unknown)'

  function resolveFocusPos() {
    if (attempt.keyPos && typeof attempt.keyPos === 'object') return attempt.keyPos
    if (attempt.targetPos && typeof attempt.targetPos === 'object') return attempt.targetPos
    if (Array.isArray(attempt.searchPath) && attempt.searchPath.length > 0) {
      return attempt.searchPath[attempt.searchPath.length - 1]
    }
    return null
  }

  const focus = resolveFocusPos()
  const focusPos = focus
    ? ` (${focus.x ?? 0},${focus.y ?? 0},${focus.z ?? 0})`
    : ''
  
  const statusText = found ? 'Key found' : 'Key not found'
  const confidence = found ? 0.9 : 0.45

  const advisory = found
    ? 'Prioritize this area for future searches.'
    : `Area swept (${visitedCount} cells, ${searchCount} waypoints); deprioritize unless new clues emerge.`

  return [{
    id: uuidv4(),
    scenarioId: attempt.scenarioId,
    type: 'key_finder_distilled',
    text: `${statusText} at ${focusPos} after ${actionCount} actions targeting ${targetPosText}. ${advisory}`,
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
async function distillMemoryUnits(attempt, options = {}) {
  if (!attempt || !attempt.scenarioId) return []

  if (typeof attempt.scenarioId !== 'string') {
    return []
  }

  const distillStyle = options.distillStyle || 'template'
  const llmEnabled = process.env.LLM_ENABLED === 'true'
  const shouldUseLLM = distillStyle === 'ollama' && llmEnabled

  if (shouldUseLLM) {
    try {
      const unit = await distillWithLLM(attempt)
      if (unit) {
        if (attempt.scenarioId.startsWith('lever_puzzle')) {
          const normalizedText = normalizeLeverSequenceText(attempt)
          if (normalizedText) {
            unit.type = 'lever_sequence_distilled'
            unit.text = normalizedText
            const defaultConfidence = attempt.success ? 0.9 : 0.55
            const incoming = typeof unit.confidence === 'number' ? unit.confidence : defaultConfidence
            unit.confidence = attempt.success
              ? Math.max(incoming, defaultConfidence)
              : Math.min(incoming, defaultConfidence)
          }
        }
        return [unit]
      }
    } catch (error) {
      console.error('LLM distillation failed, using template:', error.message)
    }
  } else if (distillStyle === 'ollama' && !llmEnabled) {
    console.warn('LLM distillation requested but LLM_ENABLED is not true; falling back to template distillation.')
  }

  if (distillStyle === 'none') {
    return []
  }

  try {
    if (attempt.scenarioId.startsWith('lever_puzzle')) {
      return distillLeverAttempt(attempt)
    }

    if (
      attempt.scenarioId.startsWith('key_finder') ||
      attempt.scenarioId.startsWith('key_unlock')
    ) {
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