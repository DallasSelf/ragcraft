function snapshotInventory(bot) {
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') {
    return []
  }

  return bot.inventory.items().map(item => {
    if (!item) return null
    return {
      name: item.name,
      displayName: item.displayName,
      count: item.count || 1
    }
  }).filter(Boolean)
}

module.exports = {
  snapshotInventory
}
