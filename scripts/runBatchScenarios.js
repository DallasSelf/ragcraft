require('dotenv').config()

const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { applyMemoryProfile } = require('../rag/memory/profile')
const { runScenario } = require('../runner/runScenario')

const DEFAULT_SCENARIOS = ['lever', 'maze', 'key']
const DEFAULT_MODES = ['raw', 'distilled']

function parseArgs(argv) {
  const out = {
    count: 10,
    delayMs: 1500,
    scenarios: DEFAULT_SCENARIOS,
    modes: DEFAULT_MODES,
    label: 'eval_batch'
  }

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]

    if (a === '--count' && argv[i + 1]) {
      out.count = Math.max(1, Number(argv[++i]) || out.count)
      continue
    }

    if (a === '--delay' && argv[i + 1]) {
      out.delayMs = Math.max(0, Number(argv[++i]) || out.delayMs)
      continue
    }

    if (a === '--scenarios' && argv[i + 1]) {
      out.scenarios = String(argv[++i])
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
      continue
    }

    if (a === '--modes' && argv[i + 1]) {
      out.modes = String(argv[++i])
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
      continue
    }

    if (a === '--label' && argv[i + 1]) {
      out.label = String(argv[++i]).trim() || out.label
    }
  }

  return out
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createScenarioBot() {
  const bot = mineflayer.createBot({
    host: process.env.MC_HOST || 'localhost',
    port: Number(process.env.MC_PORT || 25565),
    username: process.env.MC_USERNAME || 'ragcraft_eval',
    version: process.env.MC_VERSION || false
  })
  bot.loadPlugin(pathfinder)
  return bot
}

async function prepareBot(bot) {
  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Bot spawn timeout after 45s')), 45_000)

    bot.once('spawn', () => {
      clearTimeout(timeoutId)
      resolve()
    })
    bot.once('error', err => {
      clearTimeout(timeoutId)
      reject(err)
    })
    bot.once('kicked', reason => {
      clearTimeout(timeoutId)
      reject(new Error(`Bot kicked while connecting: ${String(reason)}`))
    })
  })

  const mcData = mcDataLoader(bot.version)
  const movements = new Movements(bot, mcData)
  movements.canOpenDoors = true
  bot.pathfinder.setMovements(movements)
}

function isSupportedScenario(scenario) {
  return DEFAULT_SCENARIOS.includes(scenario)
}

function isSupportedMode(mode) {
  return DEFAULT_MODES.includes(mode)
}

async function runOne({ scenario, mode, runIndex, runCount, label }) {
  applyMemoryProfile({ mode })

  const bot = createScenarioBot()
  try {
    await prepareBot(bot)

    console.log(`[START] ${scenario} ${mode} run ${runIndex}/${runCount}`)
    const out = await runScenario(bot, scenario, {
      mode,
      runLabel: `${label}_${scenario}_${mode}`
    })

    const runPath = `runs/${scenario}/${mode}/${out.runId}/`
    console.log(`[DONE ] ${scenario} ${mode} run ${runIndex}/${runCount} -> ${runPath}`)
    return { ok: true, scenario, mode, runId: out.runId, runPath }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    console.error(`[FAIL ] ${scenario} ${mode} run ${runIndex}/${runCount} -> ${message}`)
    return { ok: false, scenario, mode, error: message }
  } finally {
    try {
      bot.quit()
    } catch (e) {
      // no-op
    }
  }
}

async function main() {
  const args = parseArgs(process.argv)

  const scenarios = args.scenarios.filter(isSupportedScenario)
  const modes = args.modes.filter(isSupportedMode)
  if (scenarios.length === 0) {
    throw new Error('No valid scenarios selected. Use lever, maze, key.')
  }
  if (modes.length === 0) {
    throw new Error('No valid modes selected. Use raw, distilled.')
  }

  const totalRuns = scenarios.length * modes.length * args.count
  let completed = 0
  const results = []

  console.log('='.repeat(72))
  console.log('RAGCraft batch scenario evaluation')
  console.log('Comparison: baseline raw retrieval vs distilled retrieval')
  console.log(`Scenarios: ${scenarios.join(', ')}`)
  console.log(`Modes: ${modes.join(', ')}`)
  console.log(`Runs per scenario/mode: ${args.count}`)
  console.log(`Planned total runs: ${totalRuns}`)
  console.log('='.repeat(72))

  for (const scenario of scenarios) {
    for (const mode of modes) {
      for (let i = 1; i <= args.count; i++) {
        completed += 1
        console.log(`\n[${completed}/${totalRuns}] Preparing ${scenario} ${mode}`)

        const result = await runOne({
          scenario,
          mode,
          runIndex: i,
          runCount: args.count,
          label: args.label
        })
        results.push(result)

        if (args.delayMs > 0 && completed < totalRuns) {
          await wait(args.delayMs)
        }
      }
    }
  }

  const failures = results.filter(r => !r.ok)
  const successes = results.length - failures.length

  console.log('\n' + '='.repeat(72))
  console.log(`Batch complete. Success: ${successes}, Failures: ${failures.length}`)
  console.log('Run artifacts are under: runs/<scenario>/<memory_mode>/<run_id>/')
  console.log('Generate summaries with: npm run report:scenarios')

  if (failures.length > 0) {
    console.log('\nFailed runs:')
    failures.forEach(f => {
      console.log(`- ${f.scenario} ${f.mode}: ${f.error}`)
    })
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error('Batch runner failed:', err)
  process.exit(1)
})