const { goals } = require('mineflayer-pathfinder')
const { ensureInputs, skillSuccess, skillFailure } = require('./skillUtils')

async function execute(context = {}) {
  const { bot, logger } = context
  if (!bot || !bot.pathfinder) {
    throw new Error('navigate_to_landmark skill requires a bot with pathfinder loaded')
  }

  const inputs = ensureInputs(context.inputs || context, ['targetPosition'])
  const tolerance = Number.isFinite(inputs.tolerance) ? inputs.tolerance : 1.25
  const timeoutMs = Number.isFinite(inputs.timeoutMs) ? inputs.timeoutMs : 15000
  const target = inputs.targetPosition
  const goal = new goals.GoalNear(Math.round(target.x), Math.round(target.y), Math.round(target.z), Math.max(1, Math.round(tolerance)))

  let timedOut = false
  const timeoutHandle = setTimeout(() => {
    timedOut = true
    try {
      bot.pathfinder.stop()
    } catch (err) {
      if (logger?.log) {
        logger.log('skill_navigate_stop_error', { message: err.message })
      }
    }
  }, timeoutMs)

  try {
    await bot.pathfinder.goto(goal)
    if (timedOut) {
      return skillFailure('navigation_timeout', 'Navigation timed out before arrival')
    }
    return skillSuccess('arrived_at_target', {
      finalPosition: bot.entity?.position ? {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z
      } : null
    })
  } catch (err) {
    if (logger?.log) {
      logger.log('skill_navigate_error', { message: err.message })
    }
    return skillFailure('navigation_error', err.message)
  } finally {
    clearTimeout(timeoutHandle)
  }
}

module.exports = {
  id: 'navigate_to_landmark',
  requiredInputs: ['targetPosition'],
  successSignals: ['arrived_at_target', 'navigation_timeout'],
  execute
}
