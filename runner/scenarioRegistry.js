const { runLeverEpisodeEnhanced: leverEpisodeEnhanced } = require('../agent/leverEpisodeEnhanced')
const { runKeyFinderEpisodeEnhanced: keyFinderEpisodeEnhanced } = require('../agent/keyFinderEpisodeEnhanced')
const { runMazeEpisodeEnhanced: mazeEpisodeEnhanced } = require('../agent/mazeEpisodeEnhanced')
const { runCaptiveRescueEpisode } = require('../agent/captiveRescueEpisode')
const { runScoutEpisode } = require('../agent/scoutEpisode')

const scenarios = {
  scout: {
    id: 'scout_area_v1',
    displayName: 'Scout Mode',
    chatAliases: ['scout', 'survey', 'scan'],
    order: 0,
    run: async (bot, logger, options = {}) => runScoutEpisode(bot, logger, options)
  },
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
  },
  captive: {
    id: 'captive_rescue_v1',
    displayName: 'Captive Rescue',
    chatAliases: ['captive', 'rescue'],
    order: 4,
    run: async (bot, logger, options = {}) => runCaptiveRescueEpisode(bot, logger, options)
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
