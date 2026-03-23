require('dotenv').config()

const readline = require('readline')
const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { interpretNaturalLanguageTask, getSupportedCommandHints } = require('../llm/taskInterpreter')
const { executeTask } = require('../runner/nlTaskRouter')

function parseArgs(argv) {
  const out = { mode: 'distilled' }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--mode' && argv[i + 1]) {
      out.mode = String(argv[i + 1]).trim().toLowerCase()
      i += 1
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

function printHelp() {
  const hints = getSupportedCommandHints()
  console.log('Supported command examples:')
  hints.forEach(h => console.log(`- ${h}`))
}

async function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve))
}

async function runLoop(bot, defaultMemoryMode) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log('Natural-language command loop ready. Type "help" for examples, "exit" to quit.')

  try {
    while (true) {
      const input = String(await question(rl, 'nl> ')).trim()
      if (!input) continue

      const lowered = input.toLowerCase()
      if (lowered === 'exit' || lowered === 'quit') break
      if (lowered === 'help') {
        printHelp()
        continue
      }

      let interpreted
      try {
        interpreted = await interpretNaturalLanguageTask(input, { defaultMemoryMode })
      } catch (err) {
        console.error(`Interpreter error: ${err.message}`)
        continue
      }

      if (!interpreted.ok) {
        console.error(`Invalid command JSON: ${interpreted.error}`)
        printHelp()
        continue
      }

      console.log('Task JSON:')
      console.log(JSON.stringify(interpreted.task, null, 2))

      const task = interpreted.task
      if (!task || !task.taskType) {
        console.error('Unsupported command. Missing taskType.')
        printHelp()
        continue
      }

      try {
        const routed = await executeTask({
          bot,
          task,
          commandText: input
        })

        if (!routed.ok) {
          console.error(`Routing failed: ${routed.error}`)
          printHelp()
          continue
        }

        console.log('Route result:')
        console.log(JSON.stringify({
          route: routed.route,
          chosenPath: routed.route && Array.isArray(routed.route.chosenPath) ? routed.route.chosenPath : [],
          evidence: routed.evidence || null,
          checks: routed.checks || [],
          run: routed.runResult
            ? {
                scenarioId: routed.runResult.scenarioId,
                runId: routed.runResult.runId,
                runLabel: routed.runResult.runLabel
              }
            : null
        }, null, 2))

        const genericTasks = new Set(['find_object', 'find_location', 'acquire_object'])
        if (routed.route && genericTasks.has(routed.route.taskType)) {
          const chosenPath = Array.isArray(routed.route.chosenPath) ? routed.route.chosenPath : []
          const evidence = routed.evidence || {}
          console.log('Verification summary:')
          console.log(`- chosen path: ${chosenPath.length > 0 ? chosenPath.join(' -> ') : 'none'}`)
          console.log(`- source used: ${evidence.sourceUsed || 'unavailable'}`)
          console.log(`- candidate memory/location hints: ${JSON.stringify(evidence.candidateHints || {}, null, 0)}`)
          console.log(`- verification state: ${evidence.verificationState || 'unverified'}`)
          console.log(`- note: ${evidence.verificationNote || 'No verification details available.'}`)
        }
      } catch (err) {
        console.error(`Execution error: ${err.message}`)
      }
    }
  } finally {
    rl.close()
  }
}

async function main() {
  const args = parseArgs(process.argv)

  if (!process.env.LLM_ENABLED || process.env.LLM_ENABLED === 'false') {
    console.warn('LLM_ENABLED is false. Command interpretation will fail until LLM is enabled.')
  }

  const bot = createScenarioBot()

  bot.once('spawn', async () => {
    const mcData = mcDataLoader(bot.version)
    const movements = new Movements(bot, mcData)
    enableDoorNavigation(movements, mcData)
    bot.pathfinder.setMovements(movements)

    try {
      await runLoop(bot, args.mode)
    } catch (err) {
      console.error(err)
      process.exitCode = 1
    } finally {
      bot.quit()
    }
  })

  bot.on('error', err => {
    console.error(`Bot connection error: ${err.message}`)
    process.exitCode = 1
  })
}

main()
