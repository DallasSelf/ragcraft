const { ensureInputs, skillSuccess, skillFailure } = require('./skillUtils')

async function execute(context = {}) {
  const { adapters = {}, bot, logger } = context
  const inputs = ensureInputs(context.inputs || context, ['panelDescriptor'])
  const solver = adapters.solveLeverPanel || adapters.deriveLeverCode

  if (typeof solver !== 'function') {
    throw new Error('solve_lever_panel skill requires adapters.solveLeverPanel (or deriveLeverCode)')
  }

  try {
    const result = await solver({
      bot,
      panelDescriptor: inputs.panelDescriptor,
      metadata: inputs.metadata || {}
    })

    if (result && typeof result === 'object') {
      return {
        success: Boolean(result.success),
        signal: result.signal || (result.success ? 'lever_code_solved' : 'lever_code_failed'),
        details: result.details || {}
      }
    }

    return skillSuccess('lever_code_solved', {})
  } catch (err) {
    if (logger?.log) {
      logger.log('skill_solve_panel_error', { message: err.message })
    }
    return skillFailure('lever_code_failed', err.message)
  }
}

module.exports = {
  id: 'solve_lever_panel',
  requiredInputs: ['panelDescriptor'],
  successSignals: ['lever_code_solved', 'lever_code_failed'],
  execute
}
