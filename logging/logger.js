
const fs = require('fs')
const path = require('path')

const runsDir = path.join(process.cwd(), 'runs')
if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true })

function getLogFile(scenarioId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(runsDir, `run-${scenarioId}-${stamp}.log`)
}

function createLogger(scenarioId, agentId) {
  const file = getLogFile(scenarioId)

  return {
    session: { scenarioId, agentId, file },
    log: (msg, data = {}) => {
      const entry = {
        t: new Date().toISOString(),
        msg,
        data
      }
      fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
    }
  }
}

module.exports = { createLogger }
