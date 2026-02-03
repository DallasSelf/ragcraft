const fs = require('fs')
const path = require('path')
const { addDistilledMemory } = require('./store/vectorStore')

const distilledDir = path.join(__dirname, 'distilledMemory')
if (!fs.existsSync(distilledDir)) fs.mkdirSync(distilledDir, { recursive: true })

const distilledFile = path.join(distilledDir, 'memory.json')

function loadDistilled() {
  if (!fs.existsSync(distilledFile)) return []
  try {
    const raw = fs.readFileSync(distilledFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveDistilled(units) {
  fs.writeFileSync(distilledFile, JSON.stringify(units, null, 2), 'utf8')
}

let distilledCache = loadDistilled()

async function ingestDistilledMemory(units) {
  if (!Array.isArray(units) || units.length === 0) return

  distilledCache.push(...units)
  saveDistilled(distilledCache)

  for (const unit of units) {
    try {
      await addDistilledMemory(unit)
    } catch (err) {
      console.error('Failed to embed distilled memory:', err.message)
    }
  }
}

function retrieveDistilledMemories(scenarioId) {
  return distilledCache.filter(m => m.scenarioId === scenarioId)
}

function exportDistilledMemories(scenarioId, outFilePath) {
  if (!scenarioId || !outFilePath) return
  const subset = retrieveDistilledMemories(scenarioId)
  fs.writeFileSync(outFilePath, JSON.stringify(subset, null, 2), 'utf8')
}

function preloadDistilledMemories(inFilePath) {
  if (!inFilePath) return
  if (!fs.existsSync(inFilePath)) return
  try {
    const raw = fs.readFileSync(inFilePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      ingestDistilledMemory(parsed)
    }
  } catch {
    return
  }
}

module.exports = {
  ingestDistilledMemory,
  retrieveDistilledMemories,
  exportDistilledMemories,
  preloadDistilledMemories
}