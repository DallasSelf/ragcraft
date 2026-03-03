const fs = require('fs')
const path = require('path')
const { addDistilledMemory, addRawEpisode } = require('./store/vectorStore')
const {
  MemoryTypes,
  createClaimMemory,
  createEpisodeMemory,
  validateMemoryRecord
} = require('./memory/schema')

const distilledDir = path.join(__dirname, 'distilledMemory')
if (!fs.existsSync(distilledDir)) fs.mkdirSync(distilledDir, { recursive: true })

const distilledFile = path.join(distilledDir, 'memory.json')

function normalizeCollection(records, type) {
  if (!Array.isArray(records)) return []
  const normalized = []
  for (const record of records) {
    if (!record) continue
    try {
      if (type === MemoryTypes.EPISODE) {
        normalized.push(record.memory_type === MemoryTypes.EPISODE ? record : createEpisodeMemory(record))
      } else {
        normalized.push(record.memory_type === MemoryTypes.CLAIM ? record : createClaimMemory(record))
      }
    } catch (err) {
      console.warn('Skipping malformed memory while normalizing store:', err.message)
    }
  }
  return normalized
}

function normalizeStore(raw) {
  if (Array.isArray(raw)) {
    return { claims: normalizeCollection(raw, MemoryTypes.CLAIM), episodes: [] }
  }
  if (!raw || typeof raw !== 'object') {
    return { claims: [], episodes: [] }
  }
  return {
    claims: normalizeCollection(raw.claims, MemoryTypes.CLAIM),
    episodes: normalizeCollection(raw.episodes, MemoryTypes.EPISODE)
  }
}

function loadStore() {
  if (!fs.existsSync(distilledFile)) return { claims: [], episodes: [] }
  try {
    const raw = fs.readFileSync(distilledFile, 'utf8')
    const parsed = JSON.parse(raw)
    return normalizeStore(parsed)
  } catch {
    return { claims: [], episodes: [] }
  }
}

function saveStore(store) {
  fs.writeFileSync(distilledFile, JSON.stringify(store, null, 2), 'utf8')
}

let memoryStore = loadStore()

function addToStore(record) {
  if (record.memory_type === MemoryTypes.EPISODE) {
    memoryStore.episodes.push(record)
  } else {
    memoryStore.claims.push(record)
  }
}

async function persistVectorStore(record) {
  try {
    if (record.memory_type === MemoryTypes.EPISODE) {
      await addRawEpisode(record)
    } else {
      await addDistilledMemory(record)
    }
  } catch (err) {
    console.error('Failed to embed memory:', err.message)
  }
}

async function ingestMemoryRecords(records, options = {}) {
  if (!Array.isArray(records) || records.length === 0) return { claims: 0, episodes: 0 }

  const defaultType = options.defaultType || MemoryTypes.CLAIM
  const ingested = { claims: 0, episodes: 0 }

  for (const rawRecord of records) {
    if (!rawRecord || typeof rawRecord !== 'object') continue

    const targetType = rawRecord.memory_type || rawRecord.memoryType || defaultType
    let record
    try {
      record = targetType === MemoryTypes.EPISODE
        ? createEpisodeMemory(rawRecord)
        : createClaimMemory(rawRecord)
    } catch (err) {
      console.warn('Skipping invalid memory record:', err.message)
      continue
    }

    const { valid, errors } = validateMemoryRecord(record)
    if (!valid) {
      console.warn('Skipping memory record due to validation errors:', errors.join('; '))
      continue
    }

    addToStore(record)
    ingested[record.memory_type === MemoryTypes.EPISODE ? 'episodes' : 'claims'] += 1
    await persistVectorStore(record)
  }

  saveStore(memoryStore)
  return ingested
}

async function ingestDistilledMemory(units) {
  return ingestMemoryRecords(units, { defaultType: MemoryTypes.CLAIM })
}

async function ingestEpisodeMemory(units) {
  return ingestMemoryRecords(units, { defaultType: MemoryTypes.EPISODE })
}

function retrieveMemoryByType(type, scenarioId) {
  const source = type === MemoryTypes.EPISODE ? memoryStore.episodes : memoryStore.claims
  if (!scenarioId) return source
  return source.filter(m => m.scenarioId === scenarioId)
}

function retrieveDistilledMemories(scenarioId) {
  return retrieveMemoryByType(MemoryTypes.CLAIM, scenarioId)
}

function retrieveEpisodeMemories(scenarioId) {
  return retrieveMemoryByType(MemoryTypes.EPISODE, scenarioId)
}

function exportDistilledMemories(scenarioId, outFilePath) {
  if (!scenarioId || !outFilePath) return
  const subset = retrieveDistilledMemories(scenarioId)
  fs.writeFileSync(outFilePath, JSON.stringify(subset, null, 2), 'utf8')
}

async function preloadDistilledMemories(inFilePath) {
  if (!inFilePath) return
  if (!fs.existsSync(inFilePath)) return
  try {
    const raw = fs.readFileSync(inFilePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      await ingestDistilledMemory(parsed)
    } else if (parsed && (Array.isArray(parsed.claims) || Array.isArray(parsed.episodes))) {
      const batch = []
      if (Array.isArray(parsed.claims)) batch.push(...parsed.claims)
      if (Array.isArray(parsed.episodes)) batch.push(...parsed.episodes)
      if (batch.length > 0) {
        await ingestMemoryRecords(batch)
      }
    }
  } catch (err) {
    console.warn('Failed to preload memories:', err.message)
  }
}

function resetDistilledMemoryStore() {
  memoryStore = { claims: [], episodes: [] }
  saveStore(memoryStore)
}

module.exports = {
  ingestDistilledMemory,
  ingestEpisodeMemory,
  ingestMemoryRecords,
  retrieveDistilledMemories,
  retrieveEpisodeMemories,
  exportDistilledMemories,
  preloadDistilledMemories,
  resetDistilledMemoryStore
}