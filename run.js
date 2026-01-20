require('dotenv').config()

const { createBot } = require('./bots/bot')
const { runScenario } = require('./runner/runScenario')
const { listScenarios } = require('./runner/scenarioRegistry')

function parseArgs(argv) {
  const out = { scenario: null, mode: 'distilled', runLabel: '' }

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
  }

  return out
}

async function main() {
  const { scenario, mode, runLabel } = parseArgs(process.argv)

  if (!scenario) {
    const available = listScenarios().map(s => s.id).join(', ')
    console.log(`Usage: node run.js <scenario> [--mode raw|distilled] [--label text]`)
    console.log(`Scenarios: ${available}`)
    process.exit(1)
  }

  const bot = createBot()

  bot.once('spawn', async () => {
    try {
      const out = await runScenario(bot, { scenario, mode, runLabel })
      console.log(JSON.stringify(out, null, 2))
    } catch (e) {
      console.error(e)
      process.exitCode = 1
    } finally {
      bot.quit()
    }
  })
}

main()
