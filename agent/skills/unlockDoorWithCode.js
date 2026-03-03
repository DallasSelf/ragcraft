const { ensureInputs, skillSuccess, skillFailure } = require('./skillUtils')

async function execute(context = {}) {
  const { adapters = {}, bot, logger } = context
  const inputs = ensureInputs(context.inputs || context, ['codeSequence'])
  const executor = adapters.unlockDoorWithCode || adapters.applyLeverSequence

  if (typeof executor !== 'function') {
    throw new Error('unlock_door_with_code skill requires adapters.unlockDoorWithCode (or applyLeverSequence)')
  }

  try {
    if (logger?.log) {
      logger.log('skill_unlock_strategy', {
        doorId: inputs.metadata?.doorId || null,
        lockType: inputs.metadata?.lockType || null,
        codeSource: inputs.metadata?.codeSource || 'unknown'
      })
    }

    const result = await executor({
      bot,
      codeSequence: inputs.codeSequence,
      doorPosition: inputs.doorPosition,
      metadata: inputs.metadata || {}
    })

    if (result && typeof result === 'object') {
      return {
        success: Boolean(result.success),
        signal: result.signal || (result.success ? 'door_unlocked' : 'unlock_failed'),
        details: result.details || {}
      }
    }

    return skillSuccess('door_unlocked', { sequenceLength: inputs.codeSequence.length })
  } catch (err) {
    if (logger?.log) {
      logger.log('skill_unlock_error', { message: err.message })
    }
    return skillFailure('unlock_failed', err.message)
  }
}

module.exports = {
  id: 'unlock_door_with_code',
  requiredInputs: ['codeSequence'],
  successSignals: ['door_unlocked', 'unlock_failed'],
  execute
}
