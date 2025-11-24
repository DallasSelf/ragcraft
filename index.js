const mineflayer = require('mineflayer')
const { pathfinder } = require('mineflayer-pathfinder')
const { runLeverEpisode } = require('./agent/leverEpisode')
const { createLogger } = require('./logging/logger')
const { runMazeEpisode } = require('./agent/mazeEpisode')

const logger = createLogger('lever_puzzle_3', process.env.MC_USERNAME || 'agent_1')

const bot = mineflayer.createBot({
  host: process.env.MC_HOST,
  port: Number(process.env.MC_PORT),
  username: process.env.MC_USERNAME,
  version: process.env.MC_VERSION || false
})

bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
  console.log('Bot spawned at', bot.entity.position)
  setTimeout(async () => {
    const solved = await runLeverEpisode(bot, logger)
    console.log('Episode complete, solved:', solved)
  }, 5000)
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  if (message === '!lever') {
    runLeverEpisode(bot, logger)
  }
  if (message === '!maze') {
  runMazeEpisode(bot, logger)
}

})
