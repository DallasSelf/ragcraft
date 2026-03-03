const { v4: uuidv4 } = require('uuid')

const MemoryTypes = Object.freeze({
  EPISODE: 'episode',
  CLAIM: 'claim'
})

const ENTITY_KEYS = ['door', 'code', 'location', 'tool']

function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function coerceStringArray(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map(v => (typeof v === 'string' ? v.trim() : null))
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  }
  return []
}

function coerceValueArray(value) {
  if (value == null) return []
  if (!Array.isArray(value)) return coerceValueArray([value])
  return value
    .map(entry => {
      if (entry == null) return null
      if (typeof entry === 'string') return entry
      if (typeof entry === 'object') return entry
      return null
    })
    .filter(Boolean)
}

function sanitizeEntities(input) {
  const source = typeof input === 'object' && input !== null ? input : {}
  const entities = {}
  for (const key of ENTITY_KEYS) {
    entities[key] = coerceValueArray(source[key])
  }
  return entities
}

function resolveTaskId(input, fallbackTaskId) {
  const direct = input.task_id || input.taskId
  if (direct) return String(direct)
  if (input.scenarioId) return String(input.scenarioId)
  if (fallbackTaskId) return String(fallbackTaskId)
  throw new Error('task_id is required to construct a memory record')
}

function resolveScenarioId(input, taskId) {
  if (input.scenarioId) return String(input.scenarioId)
  return taskId
}

function resolveActionRecipe(input) {
  if (typeof input.action_recipe === 'string' && input.action_recipe.trim()) {
    return input.action_recipe.trim()
  }
  if (typeof input.actionRecipe === 'string' && input.actionRecipe.trim()) {
    return input.actionRecipe.trim()
  }
  return null
}

function resolveTimestamp(input) {
  if (Number.isFinite(input.timestamp)) return input.timestamp
  return Date.now()
}

function resolveSourceEpisodes(input) {
  const merged = [
    ...coerceStringArray(input.source_episode_ids),
    ...coerceStringArray(input.sourceEpisodeIds),
    ...coerceStringArray(input.evidenceRunIds)
  ]
  const unique = Array.from(new Set(merged))
  return unique
}

function buildMemoryRecord(payload, forcedType) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Memory payload must be an object')
  }

  const memoryType = forcedType || payload.memory_type || payload.memoryType
  if (!memoryType || ![MemoryTypes.EPISODE, MemoryTypes.CLAIM].includes(memoryType)) {
    throw new Error('memory_type must be "episode" or "claim"')
  }

  const taskId = resolveTaskId(payload)
  const actionRecipe = resolveActionRecipe(payload)
  const confidence = clampConfidence(payload.confidence)
  const goalTags = coerceStringArray(payload.goal_tags || payload.goalTags)
  const prerequisites = coerceStringArray(payload.prerequisites)
  const sourceEpisodes = resolveSourceEpisodes(payload)
  const entities = sanitizeEntities(payload.entities)
  const timestamp = resolveTimestamp(payload)

  const record = {
    id: payload.id || uuidv4(),
    ...payload,
    memory_type: memoryType,
    task_id: taskId,
    scenarioId: resolveScenarioId(payload, taskId),
    goal_tags: goalTags,
    entities,
    prerequisites,
    action_recipe: actionRecipe,
    confidence,
    timestamp,
    source_episode_ids: sourceEpisodes
  }

  return record
}

function validateMemoryRecord(record) {
  const errors = []
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be an object'] }
  }

  if (!record.memory_type || ![MemoryTypes.EPISODE, MemoryTypes.CLAIM].includes(record.memory_type)) {
    errors.push('memory_type must be "episode" or "claim"')
  }

  if (!record.task_id || typeof record.task_id !== 'string') {
    errors.push('task_id must be a non-empty string')
  }

  if (!Array.isArray(record.goal_tags)) {
    errors.push('goal_tags must be an array of strings')
  }

  if (!record.entities || typeof record.entities !== 'object') {
    errors.push('entities must be an object')
  }

  if (!Array.isArray(record.prerequisites)) {
    errors.push('prerequisites must be an array of strings')
  }

  if (!Array.isArray(record.source_episode_ids)) {
    errors.push('source_episode_ids must be an array of strings')
  }

  if (!Number.isFinite(record.timestamp)) {
    errors.push('timestamp must be a number')
  }

  if (!Number.isFinite(record.confidence)) {
    errors.push('confidence must be a number between 0 and 1')
  } else if (record.confidence < 0 || record.confidence > 1) {
    errors.push('confidence must be within [0,1]')
  }

  return { valid: errors.length === 0, errors }
}

function assertValidMemory(record) {
  const { valid, errors } = validateMemoryRecord(record)
  if (!valid) {
    throw new Error(`Invalid memory record: ${errors.join('; ')}`)
  }
  return record
}

function createEpisodeMemory(payload = {}) {
  const record = buildMemoryRecord(payload, MemoryTypes.EPISODE)
  return assertValidMemory(record)
}

function createClaimMemory(payload = {}) {
  const record = buildMemoryRecord(payload, MemoryTypes.CLAIM)
  return assertValidMemory(record)
}

module.exports = {
  MemoryTypes,
  ENTITY_KEYS,
  createEpisodeMemory,
  createClaimMemory,
  validateMemoryRecord,
  assertValidMemory
}
