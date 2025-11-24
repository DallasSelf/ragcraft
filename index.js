const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { runLeverEpisode } = require('./agent/leverEpisode')
const { runMazeEpisode } = require('./agent/mazeEpisode')
const { runKeyFinderEpisode } = require('./key_finder/keyFinder')
const { createLogger } = require('./logging/logger')
const { leverPuzzleConfig } = require('./scenarios/leverPuzzleConfig')
const { keyFinderConfig } = require('./scenarios/keyFinderConfig')
const { mazeConfig } = require('./scenarios/mazeConfig')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const bot = mineflayer.createBot({
  host: process.env.MC_HOST,
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.MC_USERNAME || 'ragcraft_agent',
  version: process.env.MC_VERSION || false
})

bot.loadPlugin(pathfinder)

let running = false

async function runScenario(scenarioId, runner) {
  if (running) {
    console.log('Scenario already running, ignoring new request.')
    return
  }
  running = true
  const logger = createLogger(scenarioId, bot.username)
  try {
    console.log(`Starting scenario ${scenarioId}`)
    await runner(bot, logger)
    console.log(`Finished scenario ${scenarioId}`)
  } catch (err) {
    console.error(`Scenario ${scenarioId} failed`, err)
  } finally {
    running = false
  }
}

async function runAllScenarios() {
  await runScenario(leverPuzzleConfig.scenarioId, runLeverEpisode)
  await wait(500)
  await runScenario(keyFinderConfig.scenarioId, runKeyFinderEpisode)
  await wait(500)
  await runScenario(mazeConfig.scenarioId, runMazeEpisode)
}

bot.once('spawn', () => {
  console.log('Bot ready. Awaiting chat commands (!lever, !key, !maze, !all).')
  const mcData = mcDataLoader(bot.version)
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)
})

bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  if (message === '!lever') {
    await runScenario(leverPuzzleConfig.scenarioId, runLeverEpisode)
  } else if (message === '!key') {
    await runScenario(keyFinderConfig.scenarioId, runKeyFinderEpisode)
  } else if (message === '!maze') {
    await runScenario(mazeConfig.scenarioId, runMazeEpisode)
  } else if (message === '!all') {
    await runAllScenarios()
  }
})
