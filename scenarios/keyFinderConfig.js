const keyFinderConfig = {
  scenarioId: 'key_finder_v1',
  defaultChestPos: { x: 5, y: 4, z: 5 },
  chestBlock: { x: 5, y: 4, z: 5 },
  resetBlockState: 'chest[facing=north]',
  maxAttempts: 6
}

module.exports = { keyFinderConfig }

