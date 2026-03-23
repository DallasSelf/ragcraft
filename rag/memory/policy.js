const SCOUT_SCENARIO_ID = 'scout_area_v1'

const SCOUT_RECON_TAGS = new Set([
  'scouting',
  'route',
  'route_memory',
  'safe_path',
  'hazard',
  'deadzone',
  'landmark',
  'interaction',
  'supply',
  'tool',
  'door',
  'frame'
])

function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(tag => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
}

function hasScoutReconTag(memory = {}) {
  const tags = normalizeTags(memory.goal_tags)
  return tags.some(tag => SCOUT_RECON_TAGS.has(tag))
}

function isScoutReconMemory(memory = {}) {
  if (!memory || typeof memory !== 'object') return false
  const scenarioId = String(memory.scenarioId || memory.task_id || '').toLowerCase()
  if (scenarioId !== SCOUT_SCENARIO_ID) return false
  return hasScoutReconTag(memory)
}

function applyScoutReconPolicy(memory = {}, options = {}) {
  if (!isScoutReconMemory(memory)) return memory

  const sourceScenarioId = options.sourceScenarioId || memory.scenarioId || memory.task_id || SCOUT_SCENARIO_ID
  const existingMetadata = memory.metadata && typeof memory.metadata === 'object' ? memory.metadata : {}
  const memoryPolicy = {
    producerScope: 'scout_recon',
    sourceScenarioId,
    requiresDistilledSource: true,
    consumerScopes: ['all']
  }

  return {
    ...memory,
    metadata: {
      ...existingMetadata,
      memoryPolicy
    }
  }
}

function canConsumeMemory(memory = {}, context = {}) {
  if (!memory || typeof memory !== 'object') return false

  const policy = memory.metadata && memory.metadata.memoryPolicy
  if (policy && policy.requiresDistilledSource && context.source === 'raw') {
    return false
  }

  if (isScoutReconMemory(memory) && context.source === 'raw') {
    return false
  }

  return true
}

module.exports = {
  SCOUT_SCENARIO_ID,
  isScoutReconMemory,
  applyScoutReconPolicy,
  canConsumeMemory
}
