const { FACILITY_POINTS } = require('./facilityLayout')

const mazeConfig = {
  scenarioId: 'maze_v1',
  spawnPosition: { ...FACILITY_POINTS.mazeEntranceDoor },
  startPos: { ...FACILITY_POINTS.mazeEntranceDoor },
  goalPos: { ...FACILITY_POINTS.mazeExit },
  exitTriggerBlock: { x: FACILITY_POINTS.mazeExit.x, y: FACILITY_POINTS.mazeExit.y, z: FACILITY_POINTS.mazeExit.z, material: 'redstone_block' },
  enforcedY: 64,
  maxSteps: 160,
  gridSize: 20,
  bounds: {
    minX: -20,
    maxX: 20,
    minZ: -15,
    maxZ: 20
  }
}

module.exports = { mazeConfig }

