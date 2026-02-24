const mazeConfig = {
  scenarioId: 'maze_v1',
  spawnPosition: { x: -1, y: 64, z: 14 },
  startPos: { x: -1, y: 64, z: 14 },
  goalPos: { x: -11, y: 64, z: -5 },
  exitTriggerBlock: { x: -11, y: 63, z: -5, material: 'redstone_block' },
  enforcedY: 64,
  maxSteps: 100,
  gridSize: 20,
  bounds: {
    minX: -20,
    maxX: 20,
    minZ: -15,
    maxZ: 20
  }
}

module.exports = { mazeConfig }

