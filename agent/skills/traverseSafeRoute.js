const { goals } = require('mineflayer-pathfinder')
const { ensureInputs, skillSuccess, skillFailure } = require('./skillUtils')
const { isCoordinate } = require('../planning/claimParsing')

async function execute(context = {}) {
  const { bot, adapters = {}, logger } = context
  const inputs = ensureInputs(context.inputs || context, ['turnSequence'])
  const instructions = Array.isArray(inputs.turnSequence) ? inputs.turnSequence : []
  if (!bot) {
    throw new Error('traverse_safe_route skill requires a bot instance')
  }

  const coordinateWaypoints = instructions.filter(isCoordinate)
  if (coordinateWaypoints.length === instructions.length && coordinateWaypoints.length > 0) {
    try {
      for (const waypoint of coordinateWaypoints) {
        const goal = new goals.GoalBlock(Math.round(waypoint.x), Math.round(waypoint.y), Math.round(waypoint.z))
        await bot.pathfinder.goto(goal)
      }
      return skillSuccess('route_traversed', { waypointCount: coordinateWaypoints.length })
    } catch (err) {
      if (logger?.log) {
        logger.log('skill_route_traverse_error', { message: err.message })
      }
      return skillFailure('route_traverse_failed', err.message)
    }
  }

  const routeExecutor = adapters.traverseSafeRoute || adapters.followRoute
  if (typeof routeExecutor !== 'function') {
    throw new Error('traverse_safe_route skill requires coordinate waypoints or adapters.traverseSafeRoute')
  }

  try {
    const result = await routeExecutor({ bot, turnSequence: instructions, metadata: inputs.metadata || {} })
    if (result && typeof result === 'object') {
      return {
        success: Boolean(result.success),
        signal: result.signal || (result.success ? 'route_traversed' : 'route_traverse_failed'),
        details: result.details || {}
      }
    }
    return skillSuccess('route_traversed', { instructionCount: instructions.length })
  } catch (err) {
    if (logger?.log) {
      logger.log('skill_route_adapter_error', { message: err.message })
    }
    return skillFailure('route_traverse_failed', err.message)
  }
}

module.exports = {
  id: 'traverse_safe_route',
  requiredInputs: ['turnSequence'],
  successSignals: ['route_traversed', 'route_traverse_failed'],
  execute
}
