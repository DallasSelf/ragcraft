const SAFETY_FLAG = Symbol('ragcraft.safetyRailsInstalled')

function buildBlockedDigError() {
  const err = new Error('Block destruction is disabled by safety rails')
  err.code = 'BLOCK_BREAK_DISABLED'
  return err
}

function logBlockedAttempt(logger, details) {
  if (!logger || typeof logger.log !== 'function') return
  logger.log('safety_block_break_attempt', {
    reason: 'block_break_disabled',
    ...details
  })
}

function patchMovements(movements) {
  if (!movements || movements.__safetyRailsApplied) return
  movements.canDig = false
  if (Array.isArray(movements.blocksCantBreak)) {
    // noop — list already enforced elsewhere
  }
  movements.__safetyRailsApplied = true
}

function wrapPathfinder(bot, logger, state) {
  if (!bot.pathfinder || state.setMovementsWrapped) return
  const originalSetMovements = bot.pathfinder.setMovements.bind(bot.pathfinder)
  bot.pathfinder.setMovements = function safetySetMovements(movements, ...rest) {
    patchMovements(movements)
    return originalSetMovements(movements, ...rest)
  }
  state.setMovementsWrapped = true
}

function patchDigging(bot, logger) {
  if (bot.__safetyDigPatched || typeof bot.dig !== 'function') return
  bot.dig = async function safetyDig(block, ...rest) {
    const details = {}
    if (block && typeof block === 'object') {
      if (block.name) details.block = block.name
      if (block.position) {
        details.position = {
          x: block.position.x,
          y: block.position.y,
          z: block.position.z
        }
      }
    }
    details.argsBlocked = rest.length
    logBlockedAttempt(logger, details)
    bot.emit('safety:block_break_blocked', details)
    throw buildBlockedDigError()
  }
  bot.__safetyDigPatched = true
  bot.canDigBlock = () => false
}

function applySafetyRails(bot, logger) {
  if (!bot) return null
  if (bot[SAFETY_FLAG]) return bot[SAFETY_FLAG]

  const state = {}
  patchDigging(bot, logger)
  wrapPathfinder(bot, logger, state)
  if (bot.pathfinder && bot.pathfinder.movements) {
    patchMovements(bot.pathfinder.movements)
  }

  bot[SAFETY_FLAG] = state
  return state
}

module.exports = {
  applySafetyRails
}
