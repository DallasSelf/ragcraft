require('dotenv').config()

const { applyMemoryProfile } = require('./rag/memory/profile')

const parsedArgs = parseArgs(process.argv)
applyMemoryProfile({ mode: parsedArgs.mode, profile: parsedArgs.memoryProfile })

const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { runScenario } = require('./runner/runScenario')
const { listScenarios } = require('./runner/scenarioRegistry')

function parseArgs(argv) {
  const out = { scenario: null, mode: 'distilled', runLabel: '', memoryProfile: null }

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!out.scenario && !a.startsWith('--')) {
      out.scenario = a
      continue
    }

    if (a === '--mode' && argv[i + 1]) {
      out.mode = argv[++i]
      continue
    }

    if (a === '--label' && argv[i + 1]) {
      out.runLabel = argv[++i]
      continue
    }

    if (a === '--memory-profile' && argv[i + 1]) {
      out.memoryProfile = argv[++i]
      continue
    }
  }

  return out
}

function createScenarioBot() {
  const bot = mineflayer.createBot({
    host: process.env.MC_HOST || 'localhost',
    port: Number(process.env.MC_PORT || 25565),
    username: process.env.MC_USERNAME || 'ragcraft_agent',
    version: process.env.MC_VERSION || false
  })

  bot.loadPlugin(pathfinder)
  return bot
}

function enableDoorNavigation(movements, mcData) {
  if (!movements || !mcData || !mcData.blocksByName) return
  movements.canOpenDoors = true

  Object.values(mcData.blocksByName).forEach(block => {
    if (!block || typeof block.name !== 'string') return
    const name = block.name.toLowerCase()
    if (!name.includes('door')) return
    if (name.includes('trapdoor')) return
    if (name.includes('iron_door')) return
    movements.openable.add(block.id)
  })
}

async function main(args) {
  const { scenario, mode, runLabel } = args

  if (!scenario) {
    const available = listScenarios().map(s => s.id).join(', ')
    console.log(`Usage: node run.js <scenario> [--mode raw|rag|distilled|distilled-ollama|hybrid] [--label text] [--memory-profile raw|distilled]`)
    console.log('Modes: raw=baseline raw retrieval, distilled=distilled retrieval condition')
    console.log(`Scenarios: ${available}`)
    process.exit(1)
  }

  const bot = createScenarioBot()

  bot.once('spawn', async () => {
    const mcData = mcDataLoader(bot.version)
    const movements = new Movements(bot, mcData)
    enableDoorNavigation(movements, mcData)
    bot.pathfinder.setMovements(movements)

    try {
      const out = await runScenario(bot, scenario, { mode, runLabel })
      console.log(JSON.stringify(out, null, 2))
    } catch (e) {
      console.error(e)
      process.exitCode = 1
    } finally {
      bot.quit()
    }
  })
}

main(parsedArgs)
