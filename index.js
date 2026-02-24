const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { runScenario, runAll } = require('./runner/runScenario')

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

async function runWithLock(fn) {
  if (running) {
    console.log('Scenario already running, ignoring new request.')
    return
  }
  running = true
  try {
    await fn()
  } finally {
    running = false
  }
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
    await runWithLock(() => runScenario(bot, 'lever'))
  } else if (message === '!key') {
    await runWithLock(() => runScenario(bot, 'key'))
  } else if (message === '!maze') {
    await runWithLock(() => runScenario(bot, 'maze'))
  } else if (message === '!all') {
    await runWithLock(async () => {
      await runAll(bot)
      await wait(250)
    })
  }
})
