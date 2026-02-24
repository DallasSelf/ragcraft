const leverPuzzleConfig = {
  scenarioId: 'lever_puzzle_3',
  leverCount: 3,
  correctSequence: [2, 3, 1],
  leverBlocks: [
    { x: 15, y: 65, z: -1 },
    { x: 15, y: 65, z: 0 },
    { x: 15, y: 65, z: 1 }
  ],
  leverFace: "wall",
  leverFacing: "west",
  spawnPosition: { x: 13, y: 64, z: 0 },
  doorBlock: { x: 13, y: 63, z: 2 },
  doorPowerBlock: { x: 13, y: 63, z: 2 },
  doorPowerOn: 'redstone_block',
  doorPowerOff: 'stripped_warped_stem'
}

module.exports = { leverPuzzleConfig }
