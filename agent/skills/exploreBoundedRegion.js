const { ensureInputs, skillSuccess, skillFailure } = require('./skillUtils')

async function execute(context = {}) {
  const { adapters = {}, bot, logger } = context
  const inputs = ensureInputs(context.inputs || context, ['bounds'])
  const executor = adapters.exploreBoundedRegion || adapters.scoutArea || adapters.searchBounds

  if (typeof executor !== 'function') {
    throw new Error('explore_bounded_region skill requires adapters.exploreBoundedRegion (or scoutArea/searchBounds)')
  }

  try {
    const result = await executor({
      bot,
      bounds: inputs.bounds,
      metadata: inputs.metadata || {},
      goal: inputs.goal || {}
    })

    if (result && typeof result === 'object') {
      return {
        success: Boolean(result.success),
        signal: result.signal || (result.success ? 'explore_completed' : 'explore_failed'),
        details: result.details || {}
      }
    }

    return skillSuccess('explore_completed', {})
  } catch (err) {
    if (logger?.log) {
      logger.log('skill_explore_error', { message: err.message })
    }
    return skillFailure('explore_failed', err.message)
  }
}

module.exports = {
  id: 'explore_bounded_region',
  requiredInputs: ['bounds'],
  successSignals: ['explore_completed', 'explore_failed'],
  execute
}
