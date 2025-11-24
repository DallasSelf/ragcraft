const mazeConfig = {
  scenarioId: 'maze_v1',
  startPos: { x: 0, y: 64, z: 0 },
  goalPos: { x: 10, y: 64, z: 10 },
  maxSteps: 100,
  gridSize: 20,
  bounds: {
    minX: -10,
    maxX: 10,
    minZ: -10,
    maxZ: 10
  }
}

module.exports = { mazeConfig }

