const fs = require('fs')
const path = require('path')

const EVENT_LOG_PATH = path.join(__dirname, '../logs/keyFinderEvents.json')
const MEMORY_DB_PATH = path.join(__dirname, '../logs/keyFinderMemory.json')

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return []
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim()
    if (!content) return []
    return JSON.parse(content)
  } catch (error) {
    // If file is corrupted or invalid JSON, return empty array
    console.warn(`Warning: Failed to parse JSON file ${filePath}:`, error.message)
    return []
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

async function saveEvent(event) {
  const events = loadJson(EVENT_LOG_PATH)
  events.push(event)
  writeJson(EVENT_LOG_PATH, events)
}

async function summarizeEvent(event) {
  const actions = event.actions.map(a => a.type).join(', ')
  return `Key search attempt: actions = ${actions}, result = ${event.result}`
}

async function embedEvent(summary) {
  const hash = summary.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return [hash % 1000, (hash % 100) / 10, (hash % 10) / 10]
}

async function storeMemory(memoryEntry) {
  const db = loadJson(MEMORY_DB_PATH)
  db.push({
    ...memoryEntry,
    id: Date.now()
  })
  writeJson(MEMORY_DB_PATH, db)
}

async function getRelevantMemories(scenarioId, memoryType) {
  const db = loadJson(MEMORY_DB_PATH)
  return db.filter(m => m.scenarioId === scenarioId && m.memoryType === memoryType)
}

module.exports = {
  saveEvent,
  summarizeEvent,
  embedEvent,
  storeMemory,
  getRelevantMemories
}
