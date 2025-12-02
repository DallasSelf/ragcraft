const fs = require('fs')
const path = require('path')
const { embedText, cosineSimilarity } = require('../embeddings/embedder')

const storeDir = __dirname
const vectorFile = path.join(storeDir, 'vectors.json')

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
  if (!fs.existsSync(vectorFile)) {
    return { distilled: [], raw: [] }
  }
  try {
    const data = fs.readFileSync(vectorFile, 'utf8')
    return JSON.parse(data)
  } catch {
    return { distilled: [], raw: [] }
  }
}

function saveVectorStore(store) {
  fs.writeFileSync(vectorFile, JSON.stringify(store, null, 2), 'utf8')
}

let vectorStore = loadVectorStore()

/**
 * Add distilled memory to vector store
 * @param {Object} memory - Distilled memory unit with text
 */
async function addDistilledMemory(memory) {
  if (!memory || !memory.text) {
    console.warn('addDistilledMemory: invalid memory', memory)
    return
  }

  const embedding = await embedText(memory.text)

  const entry = {
    ...memory,
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
  return {
    distilledCount: vectorStore.distilled.length,
    rawCount: vectorStore.raw.length,
    totalCount: vectorStore.distilled.length + vectorStore.raw.length,
    storeSizeBytes: fs.existsSync(vectorFile) ? fs.statSync(vectorFile).size : 0
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
