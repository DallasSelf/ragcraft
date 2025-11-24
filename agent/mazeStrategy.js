const { retrieveMazeAttempts } = require('../rag/kb')

function normalizeSequence(sequence) {
  if (!Array.isArray(sequence)) return null
  return JSON.stringify(
    sequence.map(item => {
      if (!item) return null
      const x = Number(item.x ?? item[0] ?? 0)
      const y = Number(item.y ?? item[1] ?? 0)
      const z = Number(item.z ?? item[2] ?? 0)
      return { x, y, z }
    }).filter(Boolean)
  )
}

function chooseMazePlan(scenarioId, mazeConfig, distilledMemories = []) {
  const attempts = retrieveMazeAttempts(scenarioId)
  const triedSequences = new Set(
    attempts
      .map(a => normalizeSequence(a.turnSequence))
      .filter(Boolean)
  )

  const parsedDistilled = distilledMemories
    .filter(mem => mem.type === 'maze_distilled')
    .map(mem => {
      try {
        return { raw: mem, data: JSON.parse(mem.text) }
      } catch {
        return null
      }
    })
    .filter(Boolean)

  const avoidedSequences = new Set(
    parsedDistilled
      .filter(item => item.data.outcome === 'failed')
      .map(item => normalizeSequence(item.data.turnSequence))
      .filter(Boolean)
  )

  const successCandidates = parsedDistilled
    .filter(item => item.data.outcome === 'success')
    .map(item => item.data.turnSequence)
    .filter(seq => Array.isArray(seq) && seq.length > 0)

  const preferredSuccess = successCandidates.find(seq => {
    const normalized = normalizeSequence(seq)
    if (!normalized) return false
    if (triedSequences.has(normalized)) return false
    if (avoidedSequences.has(normalized)) return false
    return true
  })

  if (preferredSuccess) {
    return {
      type: 'distilled_success',
      target: mazeConfig.goalPos,
      turnSequence: preferredSuccess,
      source: 'distilled_success'
    }
  }

  const lastAttempt = attempts
    .filter(a => Array.isArray(a.turnSequence) && a.turnSequence.length > 0)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]

  if (lastAttempt) {
    const normalized = normalizeSequence(lastAttempt.turnSequence)
    if (normalized && !avoidedSequences.has(normalized)) {
      return {
        type: 'recent_attempt',
        target: mazeConfig.goalPos,
        turnSequence: lastAttempt.turnSequence,
        source: 'recent_attempt'
      }
    }
  }

  return {
    type: 'direct_path',
    target: mazeConfig.goalPos,
    turnSequence: null,
    source: avoidedSequences.size > 0 ? 'avoidance_mode' : 'naive_exploration'
  }
}

module.exports = { chooseMazePlan }

