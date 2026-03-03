const { Vec3 } = require('vec3')
const { ensureInputs, skillSuccess, skillFailure } = require('./skillUtils')

async function execute(context = {}) {
  const { bot, logger } = context
  if (!bot) {
    throw new Error('retrieve_from_chest skill requires a bot instance')
  }

  const inputs = ensureInputs(context.inputs || context, ['chestPosition'])
  const chestVec = new Vec3(Math.round(inputs.chestPosition.x), Math.round(inputs.chestPosition.y), Math.round(inputs.chestPosition.z))
  const block = bot.blockAt(chestVec)

  if (!block) {
    return skillFailure('chest_not_found', 'Unable to locate chest block at provided coordinates')
  }

  let chest
  try {
    chest = await bot.openChest(block)
  } catch (err) {
    if (logger?.log) {
      logger.log('skill_retrieve_chest_error', { message: err.message })
    }
    return skillFailure('chest_open_failed', err.message)
  }

  try {
    const items = typeof chest.containerItems === 'function' ? chest.containerItems() : []
    const expected = inputs.expectedItem ? String(inputs.expectedItem).toLowerCase() : null
    const matchedItem = expected
      ? items.find(item => item && (item.name?.toLowerCase() === expected || item.displayName?.toLowerCase() === expected))
      : items[0]

    if (expected && !matchedItem) {
      return skillFailure('item_not_found', `Expected item ${inputs.expectedItem} not found in chest`)
    }

    return skillSuccess('item_retrieved', {
      item: matchedItem || null,
      snapshot: items.map(item => ({
        name: item?.name,
        displayName: item?.displayName,
        count: item?.count
      }))
    })
  } finally {
    try {
      chest.close()
    } catch (err) {
      if (logger?.log) {
        logger.log('skill_retrieve_chest_close_error', { message: err.message })
      }
    }
  }
}

module.exports = {
  id: 'retrieve_from_chest',
  requiredInputs: ['chestPosition'],
  successSignals: ['item_retrieved', 'item_not_found', 'chest_open_failed'],
  execute
}
