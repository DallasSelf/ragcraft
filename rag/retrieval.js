const { searchVectorStore } = require('./store/vectorStore')
const { retrieveDistilledMemories } = require('./distilledMemory')

/**
 * Enhanced RAG retrieval using hybrid search
 * Combines vector similarity search with fallback strategies
 */

/**
 * Generate query text from observation
 * @param {Object} observation - Current bot observation
 * @param {string} scenarioId - Scenario identifier
 * @returns {string} - Query text for embedding
 */
function buildQueryText(observation, scenarioId) {
  if (scenarioId.startsWith('lever_puzzle')) {
    return 'successful lever sequence puzzle solution'
  }

  if (scenarioId.startsWith('key_finder') || scenarioId.startsWith('key_unlock')) {
    const pos = observation?.position
    if (pos) {
      return `key search near position ${pos.x} ${pos.y} ${pos.z}`
    }
    return 'successful key finding strategy'
  }

  if (scenarioId.startsWith('maze')) {
    return 'successful maze navigation turn sequence'
  }

  return `task ${scenarioId} successful strategy`
}

/**
 * Retrieve relevant memories using vector search
 * @param {Object} params - Search parameters
 * @returns {Promise<Array>} - Ranked memories
 */
async function ragRetrieveVector(params) {
  const {
    scenarioId,
    observation = {},
    topK = 5,
    includeDistilled = true,
    includeRaw = false,
    minSimilarity = 0.3
  } = params

  const queryText = buildQueryText(observation, scenarioId)

  const results = await searchVectorStore(queryText, {
    scenarioId,
    topK,
    includeDistilled,
    includeRaw,
    minSimilarity
  })

  return results
}

/**
 * Hybrid retrieval: tries vector search, falls back to rule-based
 * @param {Object} params - Search parameters
 * @returns {Promise<Array>} - Retrieved memories
 */
async function ragRetrieveHybrid(params) {
  const {
    scenarioId,
    topK = 5,
    includeDistilled = true,
    includeRaw = false
  } = params

  try {
    let vectorResults = await ragRetrieveVector({
      scenarioId,
      observation: params.observation,
      topK,
      includeDistilled,
      includeRaw,
      minSimilarity: params.minSimilarity
    })

    if (vectorResults.length > 0) {
      if (includeDistilled) {
        const hasSuccessful = vectorResults.some(r =>
          typeof r?.text === 'string' && r.text.includes('Successful')
        )

        if (!hasSuccessful) {
          const distilled = retrieveDistilledMemories(scenarioId)
            .filter(m => m.text && m.text.includes('Successful'))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, topK)
            .map(m => ({
              ...m,
              similarity: 1.0,
              source: 'distilled_refresh',
              boostedScore: 1.0
            }))

          if (distilled.length > 0) {
            const existingIds = new Set(vectorResults.map(r => r.id))
            const merged = vectorResults.concat(
              distilled.filter(m => !existingIds.has(m.id))
            )

            merged.sort((a, b) => (b.boostedScore || 0) - (a.boostedScore || 0))
            vectorResults = merged.slice(0, topK)
          }
        }
      }

      return vectorResults
    }

    if (!includeDistilled) {
      return []
    }

    console.log('Vector search returned no results, using fallback')
    const distilled = retrieveDistilledMemories(scenarioId)

    const successful = distilled
      .filter(m => m.text && m.text.includes('Successful'))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, topK)

    return successful.map(m => ({
      ...m,
      similarity: 0.5,  // Default similarity
      source: 'distilled',
      boostedScore: 0.5
    }))

  } catch (err) {
    console.error('ragRetrieveHybrid error:', err.message)

    return []
  }
}

/**
 * Comparison mode: retrieve using both distilled and raw
 * Used for evaluation/metrics
 */
async function ragRetrieveComparison(params) {
  const { scenarioId, observation = {}, topK = 5 } = params

  const queryText = buildQueryText(observation, scenarioId)

  const distilledResults = await searchVectorStore(queryText, {
    scenarioId,
    topK,
    includeDistilled: true,
    includeRaw: false,
    minSimilarity: 0.0
  })

  const rawResults = await searchVectorStore(queryText, {
    scenarioId,
    topK,
    includeDistilled: false,
    includeRaw: true,
    minSimilarity: 0.0
  })

  return {
    distilled: distilledResults,
    raw: rawResults,
    queryText
  }
}

module.exports = {
  ragRetrieveVector,
  ragRetrieveHybrid,
  ragRetrieveComparison,
  buildQueryText
}
