const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')
const { runLeverEpisodeEnhanced } = require('./agent/leverEpisodeEnhanced')
const { runMazeEpisodeEnhanced } = require('./agent/mazeEpisodeEnhanced')
const { runKeyFinderEpisodeEnhanced } = require('./agent/keyFinderEpisodeEnhanced')
const { createLogger } = require('./logging/logger')
const { leverPuzzleConfig } = require('./scenarios/leverPuzzleConfig')
const { mazeConfig } = require('./scenarios/mazeConfig')
const { keyFinderConfig } = require('./scenarios/keyFinderConfig')
const { printComparisonReport, printStoreStats, generateMarkdownReport } = require('./rag/eval/comparison')
const { clearVectorStore } = require('./rag/store/vectorStore')
const path = require('path')

require('dotenv').config()

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runEvaluation() {
  console.log('='.repeat(60))
  console.log('FULL RAG SYSTEM EVALUATION')
  console.log('='.repeat(60))

  const bot = mineflayer.createBot({
    host: process.env.MC_HOST,
    port: Number(process.env.MC_PORT || 25565),
    username: 'ragcraft_eval_full',
    version: process.env.MC_VERSION || false
  })

  bot.loadPlugin(pathfinder)

  await new Promise((resolve) => {
    bot.once('spawn', resolve)
  })

  console.log('Bot spawned and ready')

  const mcData = mcDataLoader(bot.version)
  const movements = new Movements(bot, mcData)
  bot.pathfinder.setMovements(movements)

  await wait(2000)

  const shouldClear = process.env.CLEAR_STORE === 'true'
  if (shouldClear) {
    console.log('\nClearing vector store...')
    clearVectorStore()
  }

  console.log('\n' + '='.repeat(60))
  console.log('LEVER PUZZLE - DISTILLED MODE')
  console.log('='.repeat(60) + '\n')
  await runLeverEpisodeEnhanced(bot, createLogger('lever_distilled', bot.username), { mode: 'distilled' })
  await wait(3000)

  console.log('\n' + '='.repeat(60))
  console.log('LEVER PUZZLE - RAW MODE')
  console.log('='.repeat(60) + '\n')
  await runLeverEpisodeEnhanced(bot, createLogger('lever_raw', bot.username), { mode: 'raw' })
  await wait(3000)

  console.log('\n' + '='.repeat(60))
  console.log('MAZE - DISTILLED MODE')
  console.log('='.repeat(60) + '\n')
  await runMazeEpisodeEnhanced(bot, createLogger('maze_distilled', bot.username), { mode: 'distilled' })
  await wait(3000)

  console.log('\n' + '='.repeat(60))
  console.log('MAZE - RAW MODE')
  console.log('='.repeat(60) + '\n')
  await runMazeEpisodeEnhanced(bot, createLogger('maze_raw', bot.username), { mode: 'raw' })
  await wait(3000)

  console.log('\n' + '='.repeat(60))
  console.log('KEY FINDER - DISTILLED MODE')
  console.log('='.repeat(60) + '\n')
  await runKeyFinderEpisodeEnhanced(bot, createLogger('key_distilled', bot.username), { mode: 'distilled' })
  await wait(3000)

  console.log('\n' + '='.repeat(60))
  console.log('KEY FINDER - RAW MODE')
  console.log('='.repeat(60) + '\n')
  await runKeyFinderEpisodeEnhanced(bot, createLogger('key_raw', bot.username), { mode: 'raw' })
  await wait(3000)

  console.log('\n')
  printStoreStats()

  printComparisonReport(leverPuzzleConfig.scenarioId)
  printComparisonReport(mazeConfig.scenarioId)
  printComparisonReport(keyFinderConfig.scenarioId)

  generateMarkdownReport(leverPuzzleConfig.scenarioId, path.join(__dirname, 'rag', 'eval', 'REPORT_LEVER.md'))
  generateMarkdownReport(mazeConfig.scenarioId, path.join(__dirname, 'rag', 'eval', 'REPORT_MAZE.md'))
  generateMarkdownReport(keyFinderConfig.scenarioId, path.join(__dirname, 'rag', 'eval', 'REPORT_KEY.md'))

  console.log('\nEvaluation complete\n')

  bot.quit()
  process.exit(0)
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err)
  process.exit(1)
})

runEvaluation().catch(err => {
  console.error('Evaluation failed:', err)
  process.exit(1)
})
