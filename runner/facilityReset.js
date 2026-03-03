require('dotenv').config()

const { once } = require('events')
const mineflayer = require('mineflayer')
const { createLeverScenarioController } = require('../agent/leverWorld')
const { getLeverScenarioView } = require('../scenarios/leverPuzzleConfig')
const { resetKeyFinderWorld } = require('../agent/keyFinderEpisodeEnhanced')
const { setCaptiveDoorState } = require('../agent/captiveRescueEpisode')
const { captiveRescueConfig } = require('../scenarios/captiveRescueConfig')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createConsoleLogger({ quiet } = {}) {
  return {
    log(event, payload) {
      if (quiet) return
      if (payload !== undefined) {
        console.log(`[facility_reset] ${event}`, payload)
      } else {
        console.log(`[facility_reset] ${event}`)
      }
    }
  }
}

async function resetLeverPuzzle(bot, logger) {
  const scenario = getLeverScenarioView()
  const controller = createLeverScenarioController(scenario)
  await controller.closeDoor(bot, logger)
  await controller.resetLevers(bot, logger)
  return { doorClosed: true, leversReset: true }
}

async function resetKeyFinderScenario(bot, logger) {
  await resetKeyFinderWorld(bot, logger)
  return { chestPrimed: true, looseKeysCleared: true }
}

async function resetCaptiveDoor(bot, logger) {
  if (!captiveRescueConfig?.doorPowerBlock) {
    return { doorReset: false, reason: 'missing_door_power_block' }
  }
  await setCaptiveDoorState(bot, logger, false)
  return { doorReset: true }
}

async function performFacilityResets(bot, logger) {
  const summary = {}

  try {
    summary.lever = await resetLeverPuzzle(bot, logger)
  } catch (err) {
    summary.lever = { doorClosed: false, leversReset: false, error: err.message }
    logger.log('facility_reset_error', { domain: 'lever', message: err.message })
  }

  try {
    summary.keyFinder = await resetKeyFinderScenario(bot, logger)
  } catch (err) {
    summary.keyFinder = { chestPrimed: false, looseKeysCleared: false, error: err.message }
    logger.log('facility_reset_error', { domain: 'keyFinder', message: err.message })
  }

  try {
    summary.captive = await resetCaptiveDoor(bot, logger)
  } catch (err) {
    summary.captive = { doorReset: false, error: err.message }
    logger.log('facility_reset_error', { domain: 'captive', message: err.message })
  }

  return summary
}

function createBot(username = 'facility_reset') {
  return mineflayer.createBot({
    host: process.env.MC_HOST || 'localhost',
    port: Number(process.env.MC_PORT || 25565),
    username,
    version: process.env.MC_VERSION || false
  })
}

async function awaitBotReady(bot) {
  await Promise.race([
    once(bot, 'spawn'),
    once(bot, 'error').then(([err]) => {
      throw err
    }),
    once(bot, 'kicked').then(([reason]) => {
      throw new Error(`Bot kicked: ${reason}`)
    })
  ])
  // small delay to ensure chunks load
  await wait(250)
}

async function resetFacility(options = {}) {
  const logger = options.logger || createConsoleLogger({ quiet: options.quiet })
  const startedAt = Date.now()

  if (options.bot) {
    const summary = await performFacilityResets(options.bot, logger)
    return { ...summary, durationMs: Date.now() - startedAt }
  }

  const bot = createBot(options.username)
  try {
    await awaitBotReady(bot)
    const summary = await performFacilityResets(bot, logger)
    return { ...summary, durationMs: Date.now() - startedAt }
  } finally {
    bot.quit()
  }
}

module.exports = {
  resetFacility
}
