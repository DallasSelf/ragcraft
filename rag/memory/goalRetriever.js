const { searchVectorStore } = require('../store/vectorStore')
const { MemoryTypes } = require('./schema')
const { isRawModeActive } = require('./profile')

const SYMBOLIC_KEYWORDS = ['door', 'captive', 'chest', 'key', 'code', 'lever', 'landmark', 'route', 'tool', 'hazard', 'interactable', 'scout', 'survey']
const CLAIM_TYPE_SUFFIX = '_claim'

function toWords(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(w => w.trim())
    .filter(Boolean)
}

function coerceArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  return [value]
}

function collectGoalKeywords(goalText, goal = {}) {
  const keywords = new Set()
  toWords(goalText).forEach(w => keywords.add(w))
  coerceArray(goal.goal_tags).forEach(tag => toWords(String(tag)).forEach(w => keywords.add(w)))

  const entities = goal.entities || {}
  Object.keys(entities).forEach(key => {
    keywords.add(key.toLowerCase())
    const items = coerceArray(entities[key])
    for (const item of items) {
      if (!item) continue
      if (typeof item === 'string') {
        toWords(item).forEach(w => keywords.add(w))
      } else if (typeof item === 'object') {
        Object.values(item).forEach(v => toWords(String(v)).forEach(w => keywords.add(w)))
      }
    }
  })

  if (Array.isArray(goal.symbolic_entities)) {
    goal.symbolic_entities.forEach(sym => toWords(String(sym)).forEach(w => keywords.add(w)))
  }

  return keywords
}

function collectMemoryKeywords(memory = {}) {
  const keywords = new Set()
  toWords(memory.text || '').forEach(w => keywords.add(w))
  coerceArray(memory.goal_tags).forEach(tag => toWords(String(tag)).forEach(w => keywords.add(w)))
  if (memory.type) toWords(String(memory.type)).forEach(w => keywords.add(w))

  const entities = memory.entities || {}
  Object.keys(entities).forEach(key => {
    keywords.add(key.toLowerCase())
    const items = coerceArray(entities[key])
    for (const item of items) {
      if (!item) continue
      if (typeof item === 'string') {
        toWords(item).forEach(w => keywords.add(w))
      } else if (typeof item === 'object') {
        Object.values(item).forEach(v => toWords(String(v)).forEach(w => keywords.add(w)))
      }
    }
  })

  return keywords
}

function computeSymbolicMatches(goalKeywords, memoryKeywords) {
  const matches = []
  for (const keyword of SYMBOLIC_KEYWORDS) {
    if (goalKeywords.has(keyword) && memoryKeywords.has(keyword)) {
      matches.push(keyword)
    }
  }
  return matches
}

function buildExplanation(memory, matches, boost) {
  const parts = []
  if (matches.length > 0) {
    parts.push(`shares ${matches.join('/')}`)
  }
  const similarity = typeof memory.similarity === 'number' ? memory.similarity : 0
  parts.push(`similarity ${similarity.toFixed(2)}`)
  if (boost > 0) {
    parts.push(`symbolic boost +${boost.toFixed(2)}`)
  }
  return parts.join('; ')
}

function isClaimMemory(memory) {
  if (!memory || typeof memory !== 'object') return false
  if (memory.memory_type === MemoryTypes.CLAIM) return true
  if (typeof memory.memory_type === 'string' && memory.memory_type.toLowerCase() === 'claim') return true
  if (typeof memory.type === 'string' && memory.type.endsWith(CLAIM_TYPE_SUFFIX)) return true
  return false
}

function buildGoalQuery(goalText, goal) {
  const segments = []
  if (goalText) segments.push(goalText)
  if (goal?.description) segments.push(goal.description)
  if (Array.isArray(goal?.goal_tags)) segments.push(goal.goal_tags.join(' '))
  const entities = goal?.entities || {}
  Object.keys(entities).forEach(key => {
    const items = coerceArray(entities[key])
    if (items.length === 0) return
    const serialized = items
      .map(item => {
        if (!item) return ''
        if (typeof item === 'string') return item
        if (typeof item === 'object') {
          const props = Object.entries(item)
            .map(([k, v]) => `${k}:${v}`)
            .join(' ')
          return `${key} ${props}`
        }
        return String(item)
      })
      .filter(Boolean)
      .join(' ')
    if (serialized) segments.push(serialized)
  })
  return segments.join(' ').trim()
}

function resolveAllowedSources(input) {
  const value = (input || process.env.GOAL_CLAIM_ALLOWED_SOURCES || 'claims_only').toLowerCase()
  if (['claims_only', 'claims_and_raw', 'raw_only'].includes(value)) return value
  return 'claims_only'
}

async function retrieveGoalAlignedClaims({ goalText = '', goal = {}, topK = 5, scenarioId = null, scope, allowedSources } = {}) {
  if (isRawModeActive()) {
    return []
  }
  const queryText = buildGoalQuery(goalText, goal) || goalText || 'goal memory retrieval'
  const searchLimit = Math.max(topK * 3, topK + 5)
  const scopeMode = scope || process.env.GOAL_CLAIM_SCOPE || 'global'
  const scopedScenarioId = scopeMode === 'local' ? scenarioId : null
  const sourceMode = resolveAllowedSources(allowedSources)
  const includeRaw = sourceMode === 'claims_and_raw' || sourceMode === 'raw_only'
  const includeDistilled = sourceMode !== 'raw_only'

  const vectorResults = await searchVectorStore(queryText, {
    scenarioId: scopedScenarioId,
    topK: searchLimit,
    includeDistilled,
    includeRaw
  })

  const goalKeywords = collectGoalKeywords(goalText, goal)
  let filteredResults = vectorResults

  if (sourceMode === 'claims_only') {
    filteredResults = vectorResults.filter(isClaimMemory)
  } else if (sourceMode === 'raw_only') {
    filteredResults = vectorResults.filter(mem => !isClaimMemory(mem))
  }

  if (filteredResults.length === 0) return []

  const scored = filteredResults.map(memory => {
    const memoryKeywords = collectMemoryKeywords(memory)
    const matches = computeSymbolicMatches(goalKeywords, memoryKeywords)
    const baseScore = typeof memory.boostedScore === 'number'
      ? memory.boostedScore
      : typeof memory.similarity === 'number'
        ? memory.similarity
        : 0
    const boost = matches.length * 0.12
    const goalScore = baseScore + boost
    return {
      ...memory,
      goalScore,
      explanation: buildExplanation(memory, matches, boost)
    }
  })

  scored.sort((a, b) => b.goalScore - a.goalScore)
  return scored.slice(0, topK)
}

module.exports = {
  retrieveGoalAlignedClaims
}
