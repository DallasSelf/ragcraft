const fs = require('fs')
const path = require('path')

const distilledDir = path.join(process.cwd(), 'rag', 'distilledMemory')
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

function ingestDistilledMemory(units) {
  if (!Array.isArray(units) || units.length === 0) return
  distilledCache.push(...units)
  saveDistilled(distilledCache)
}

function retrieveDistilledMemories(scenarioId) {
  return distilledCache.filter(m => m.scenarioId === scenarioId)
}

module.exports = {
  ingestDistilledMemory,
  retrieveDistilledMemories
}