const { searchVectorStore } = require('./store/vectorStore')
const { retrieveDistilledMemories } = require('./distilledMemory')
const { canConsumeMemory } = require('./memory/policy')

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

  if (scenarioId.startsWith('scout_area')) {
    return 'environment scouting landmarks hazards interactables routes'
  }

  return `task ${scenarioId} successful strategy`
}

function isSuccessfulDistilledMemory(scenarioId, memory) {
  if (!memory) return false
  if (memory.outcome === 'success') return true
  if (typeof memory.text !== 'string') return false
  if (scenarioId && (scenarioId.startsWith('key_finder') || scenarioId.startsWith('key_unlock'))) {
    if (memory.text.startsWith('Key found')) return true
  }
  if (memory.text.includes('Successful')) return true

  if (scenarioId && scenarioId.startsWith('maze')) {
    try {
      const parsed = JSON.parse(memory.text)
      return parsed && parsed.outcome === 'success'
    } catch {
      return false
    }
  }

  return false
}

function isFailureGuidanceMemory(scenarioId, memory) {
  if (!memory) return false
  if (memory.outcome === 'failed') return true
  if (typeof memory.text !== 'string') return false
  if (scenarioId && (scenarioId.startsWith('key_finder') || scenarioId.startsWith('key_unlock'))) {
    if (memory.text.startsWith('Key not found')) return true
  }
  if (memory.text.toLowerCase().includes('failed') || memory.text.toLowerCase().includes('avoid')) return true
  if (scenarioId && scenarioId.startsWith('maze')) {
    try {
      const parsed = JSON.parse(memory.text)
      return parsed && parsed.outcome === 'failed'
    } catch {
      return false
    }
  }
  return false
}

/**
 * Retrieve relevant memories using vector search
 * @param {Object} params - Search parameters
 * @returns {Promise<Array>} - Ranked memories
 */
async function ragRetrieveVector(params) {
  const {
    scenarioId,
    consumerScenarioId = scenarioId,
    observation = {},
    topK = 5,
    includeDistilled = true,
    includeRaw = false,
    minSimilarity = 0.3
  } = params

  const queryText = buildQueryText(observation, scenarioId)

  const results = await searchVectorStore(queryText, {
    scenarioId,
    consumerScenarioId,
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
    consumerScenarioId = scenarioId,
    topK = 5,
    includeDistilled = true,
    includeRaw = false
  } = params

  try {
    let vectorResults = await ragRetrieveVector({
      scenarioId,
      consumerScenarioId,
      observation: params.observation,
      topK,
      includeDistilled,
      includeRaw,
      minSimilarity: params.minSimilarity
    })

    if (vectorResults.length > 0) {
      if (includeDistilled) {
        const hasSuccessful = vectorResults.some(r => isSuccessfulDistilledMemory(scenarioId, r))

        if (!hasSuccessful) {
          const distilledPool = retrieveDistilledMemories(scenarioId)
            .filter(m => canConsumeMemory(m, { source: 'distilled', consumerScenarioId }))

          const distilledSuccess = distilledPool
            .filter(m => isSuccessfulDistilledMemory(scenarioId, m))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, topK)
            .map(m => ({
              ...m,
              similarity: 1.0,
              source: 'distilled_refresh',
            }))

          const distilledFailures = distilledPool
            .filter(m => isFailureGuidanceMemory(scenarioId, m))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, Math.max(1, Math.floor(topK / 2)))
            .map(m => ({
              ...m,
              similarity: 0.82,
              source: 'distilled_avoid_refresh'
            }))

          const distilled = distilledSuccess.concat(distilledFailures)

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
      .filter(m => canConsumeMemory(m, { source: 'distilled', consumerScenarioId }))

    const successful = distilled
      .filter(m => isSuccessfulDistilledMemory(scenarioId, m))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, topK)

    const avoidGuidance = distilled
      .filter(m => isFailureGuidanceMemory(scenarioId, m))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, Math.max(1, Math.floor(topK / 2)))

    const mixed = successful.concat(avoidGuidance)
    const unique = []
    const seen = new Set()
    for (const item of mixed) {
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      unique.push(item)
      if (unique.length >= topK) break
    }

    return unique.map(m => ({
      ...m,
      similarity: isSuccessfulDistilledMemory(scenarioId, m) ? 0.5 : 0.42,
      source: 'distilled',
      boostedScore: isSuccessfulDistilledMemory(scenarioId, m) ? 0.5 : 0.42
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
    consumerScenarioId: scenarioId,
    topK,
    includeDistilled: true,
    includeRaw: false,
    minSimilarity: 0.0
  })

  const rawResults = await searchVectorStore(queryText, {
    scenarioId,
    consumerScenarioId: scenarioId,
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
