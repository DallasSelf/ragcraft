const fs = require('fs')
const path = require('path')
const { embedText, cosineSimilarity } = require('../embeddings/embedder')
const { getProfileAwarePath, onMemoryProfileChange, isRawModeActive } = require('../memory/profile')

const storeDir = __dirname

function getVectorFilePath() {
  return getProfileAwarePath(storeDir, 'vectors.json')
}

function formatCoordinates(pos) {
  if (!pos || typeof pos !== 'object') return null
  const { x, y, z } = pos
  if (![x, y, z].every(v => Number.isFinite(v))) return null
  return `${x},${y},${z}`
}

function describeDoorClaim(memory) {
  const doorEntity = memory.entities?.door?.[0]
  const coordText = formatCoordinates(memory.door_location || doorEntity?.location)
  const codeEntity = memory.entities?.code?.[0]
  const sequence = Array.isArray(codeEntity?.sequence) && codeEntity.sequence.length > 0
    ? codeEntity.sequence.join('-')
    : memory.code
  if (!sequence) return null
  const doorId = memory.door_id || doorEntity?.id || 'door'
  const locationText = coordText ? ` at (${coordText})` : ''
  return `Door ${doorId}${locationText} opens when toggling levers ${sequence} in order.`
}

function deriveDistilledText(memory) {
  if (!memory || typeof memory !== 'object') return null

  const direct = typeof memory.text === 'string' ? memory.text.trim() : ''
  if (direct) return direct

  const recipe = typeof memory.action_recipe === 'string' ? memory.action_recipe.trim() : ''
  if (recipe) return recipe

  if (typeof memory.how_to_apply === 'string' && memory.how_to_apply.trim()) {
    return memory.how_to_apply.trim()
  }

  const normalizedType = typeof memory.type === 'string' ? memory.type.toLowerCase() : ''
  if (normalizedType === 'door_code_claim') {
    const doorText = describeDoorClaim(memory)
    if (doorText) return doorText
  }

  const description = typeof memory.description === 'string' ? memory.description.trim() : ''
  if (description) return description

  const summary = typeof memory.summary === 'string' ? memory.summary.trim() : ''
  if (summary) return summary

  if (Array.isArray(memory.goal_tags) && memory.goal_tags.length > 0) {
    const scenarioLabel = memory.scenarioId || memory.task_id || 'scenario'
    return `Claim for ${scenarioLabel} related to goals: ${memory.goal_tags.join(', ')}`
  }

  if (memory.scenarioId || memory.task_id) {
    return `Claim for scenario ${memory.scenarioId || memory.task_id}`
  }

  try {
    return JSON.stringify({
      id: memory.id,
      type: memory.type || memory.memory_type,
      scenarioId: memory.scenarioId || memory.task_id || null
    })
  } catch {
    return null
  }
}

/**
 * Vector store structure:
 * {
 *   distilled: [
 *     { id, scenarioId, text, embedding, confidence, timestamp, ... }
 *   ],
 *   raw: [
 *     { id, scenarioId, text, embedding, timestamp, ... }
 *   ]
 * }
 */

function loadVectorStore() {
  const file = getVectorFilePath()
  if (!fs.existsSync(file)) {
    return { distilled: [], raw: [] }
  }
  try {
    const data = fs.readFileSync(file, 'utf8')
    return JSON.parse(data)
  } catch {
    return { distilled: [], raw: [] }
  }
}

function saveVectorStore(store) {
  const file = getVectorFilePath()
  fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8')
}

let vectorStore = loadVectorStore()

onMemoryProfileChange(() => {
  vectorStore = loadVectorStore()
})

/**
 * Add distilled memory to vector store
 * @param {Object} memory - Distilled memory unit with text
 */
async function addDistilledMemory(memory) {
  const text = deriveDistilledText(memory)
  if (!text) {
    console.warn('addDistilledMemory: invalid memory', memory)
    return
  }

  const embedding = await embedText(text)

  const entry = {
    ...memory,
    text,
    embedding,
    addedAt: Date.now()
  }

  vectorStore.distilled.push(entry)
  saveVectorStore(vectorStore)

  return entry
}

/**
 * Add raw episode summary to vector store
 * @param {Object} episode - Episode summary with description
 */
async function addRawEpisode(episode) {
  if (!episode || !episode.text) {
    console.warn('addRawEpisode: invalid episode', episode)
    return
  }

  const embedding = await embedText(episode.text)

  const entry = {
    ...episode,
    embedding,
    addedAt: Date.now()
  }

  vectorStore.raw.push(entry)
  saveVectorStore(vectorStore)

  return entry
}

/**
 * Search vector store by similarity
 * @param {string} queryText - Query text
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Ranked results
 */
async function searchVectorStore(queryText, options = {}) {
  if (isRawModeActive()) {
    return []
  }
  const {
    scenarioId = null,
    topK = 5,
    includeDistilled = true,
    includeRaw = true,
    minSimilarity = 0.0
  } = options

  const queryEmbedding = await embedText(queryText)

  const results = []

  if (includeDistilled) {
    for (const item of vectorStore.distilled) {
      if (scenarioId && item.scenarioId !== scenarioId) continue

      const similarity = cosineSimilarity(queryEmbedding, item.embedding)

      if (similarity >= minSimilarity) {
        results.push({
          ...item,
          similarity,
          source: 'distilled'
        })
      }
    }
  }

  if (includeRaw) {
    for (const item of vectorStore.raw) {
      if (scenarioId && item.scenarioId !== scenarioId) continue

      const similarity = cosineSimilarity(queryEmbedding, item.embedding)

      if (similarity >= minSimilarity) {
        results.push({
          ...item,
          similarity,
          source: 'raw'
        })
      }
    }
  }

  results.sort((a, b) => b.similarity - a.similarity)

  results.forEach(r => {
    if (r.source === 'distilled' && r.confidence) {
      r.boostedScore = r.similarity * (0.7 + 0.3 * r.confidence)
    } else {
      r.boostedScore = r.similarity
    }
  })

  results.sort((a, b) => b.boostedScore - a.boostedScore)

  return results.slice(0, topK)
}

/**
 * Get store statistics
 */
function getStoreStats() {
  const file = getVectorFilePath()
  return {
    distilledCount: vectorStore.distilled.length,
    rawCount: vectorStore.raw.length,
    totalCount: vectorStore.distilled.length + vectorStore.raw.length,
    storeSizeBytes: fs.existsSync(file) ? fs.statSync(file).size : 0
  }
}

/**
 * Clear all vectors (for testing)
 */
function clearVectorStore() {
  vectorStore = { distilled: [], raw: [] }
  saveVectorStore(vectorStore)
}

module.exports = {
  addDistilledMemory,
  addRawEpisode,
  searchVectorStore,
  getStoreStats,
  clearVectorStore
}
