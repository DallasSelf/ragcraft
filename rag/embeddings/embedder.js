const { pipeline } = require('@xenova/transformers')

let embeddingPipeline = null

/**
 * Initialize the embedding model
 * Uses all-MiniLM-L6-v2 - fast, lightweight, good for semantic similarity
 */
async function initEmbedder() {
  if (!embeddingPipeline) {
    console.log('Loading embedding model (first run may download ~23MB)...')
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    console.log('Embedding model ready')
  }
  return embeddingPipeline
}

/**
 * Generate embedding vector for text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - 384-dimensional vector
 */
async function embedText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('embedText requires non-empty string')
  }

  const pipe = await initEmbedder()

  const output = await pipe(text, { pooling: 'mean', normalize: true })

  const embedding = Array.from(output.data)

  return embedding
}

/**
 * Batch embed multiple texts
 * @param {string[]} texts - Array of texts
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function embedBatch(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return []
  }

  const embeddings = []
  for (const text of texts) {
    const emb = await embedText(text)
    embeddings.push(emb)
  }

  return embeddings
}

/**
 * Compute cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} - Similarity score (0-1)
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (normA * normB)
}

module.exports = {
  initEmbedder,
  embedText,
  embedBatch,
  cosineSimilarity
}
