require('dotenv').config()

const mineflayer = require('mineflayer')
const { scenarios } = require('./runner/scenarioRegistry')
const { createLogger } = require('./logging/logger')

const HOST = process.env.MC_HOST || 'localhost'
const PORT = Number(process.env.MC_PORT || 25565)
const USERNAME = process.env.MC_USERNAME || 'ragcraft_agent'
const VERSION = process.env.MC_VERSION || false

function getArg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback
  return process.argv[i + 1] || fallback
}

async function main() {
  const scenarioName = getArg('--scenario', 'lever')
  const repeats = Number(getArg('--repeats', '1'))
  const delayMs = Number(getArg('--delay', '1500'))
  const { pathfinder } = require('mineflayer-pathfinder')
  const scenario = scenarios[scenarioName]
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioName}`)
    process.exit(1)
  }

  const bot = mineflayer.createBot({
    host: HOST,
    port: PORT,
    username: USERNAME,
    version: VERSION || undefined
  })
  bot.loadPlugin(pathfinder)

  const logger = createLogger({ scenarioId: scenario.id })

  await new Promise(resolve => bot.once('spawn', resolve))

  for (let i = 0; i < repeats; i++) {
    try {
      await scenario.run(bot, logger, { mode: 'terminal' })
    } catch (e) {
      console.error(e)
    }
    await new Promise(r => setTimeout(r, delayMs))
  }

  bot.quit()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})