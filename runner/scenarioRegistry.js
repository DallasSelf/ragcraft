const { runLeverEpisodeEnhanced: leverEpisodeEnhanced } = require('../agent/leverEpisodeEnhanced')
const { runKeyFinderEpisodeEnhanced: keyFinderEpisodeEnhanced } = require('../agent/keyFinderEpisodeEnhanced')
const { runMazeEpisodeEnhanced: mazeEpisodeEnhanced } = require('../agent/mazeEpisodeEnhanced')

const scenarios = {
  lever: {
    id: 'lever',
    displayName: 'Lever Puzzle',
    chatAliases: ['lever'],
    order: 1,
    run: async (bot, logger, options = {}) => leverEpisodeEnhanced(bot, logger, options)
  },
  key: {
    id: 'key',
    displayName: 'Key Finder',
    chatAliases: ['key'],
    order: 2,
    run: async (bot, logger, options = {}) => keyFinderEpisodeEnhanced(bot, logger, options)
  },
  maze: {
    id: 'maze',
    displayName: 'Maze',
    chatAliases: ['maze'],
    order: 3,
    run: async (bot, logger, options = {}) => mazeEpisodeEnhanced(bot, logger, options)
  }
}

function getScenarioByName(name) {
  if (!name) return null
  const key = String(name).trim().toLowerCase()
  if (scenarios[key]) return scenarios[key]
  for (const id of Object.keys(scenarios)) {
    const s = scenarios[id]
    if ((s.chatAliases || []).includes(key)) return s
  }
  return null
}

function listScenarios() {
  return Object.values(scenarios)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
}

module.exports = { scenarios, getScenarioByName, listScenarios }
