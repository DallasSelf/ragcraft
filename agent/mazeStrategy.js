const { retrieveMazeAttempts } = require('../rag/kb')

function chooseMazePlan(scenarioId, mazeConfig, distilledMemories = []) {
  const attempts = retrieveMazeAttempts(scenarioId)
  const successes = attempts.filter(a => a.success)
  
  const plan = {
    type: 'direct_path',
    target: mazeConfig.goalPos,
    source: successes.length > 0 ? 'kb_success' : 'naive_exploration'
  }
  
  return plan
}

module.exports = { chooseMazePlan }

