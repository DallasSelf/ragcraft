const { getLeverScenarioView, getLeverLockType } = require('./leverPuzzleConfig')
const { FACILITY_POINTS } = require('./facilityLayout')

const leverScenario = getLeverScenarioView()
const leverLockType = getLeverLockType(leverScenario)

const captiveRescueConfig = {
  scenarioId: 'captive_rescue_v1',
  spawnPosition: {
    x: FACILITY_POINTS.captiveChest.x,
    y: FACILITY_POINTS.captiveDoorBase.y,
    z: FACILITY_POINTS.captiveChest.z
  },
  observationPost: { ...FACILITY_POINTS.captiveChest },
  lockType: leverLockType,
  doorId: leverScenario.doorId || 'lever_exit_door',
  doorBlock: leverScenario.doorBlock ? { ...leverScenario.doorBlock } : null,
  doorPowerBlock: leverScenario.doorPowerBlock ? { ...leverScenario.doorPowerBlock } : null,
  doorPowerOn: leverScenario.doorPowerOn,
  doorPowerOff: leverScenario.doorPowerOff,
  captiveCell: leverScenario.doorBlock
    ? { x: leverScenario.doorBlock.x, y: leverScenario.doorBlock.y, z: leverScenario.doorBlock.z + 2 }
    : null,
  timeoutMs: 22000,
  maxAttempts: 3,
  resetDelayMs: 400,
  scenarioSeed: 'lever-door',
  entranceDoor: { ...FACILITY_POINTS.captiveDoorBase },
  nearbyChest: { ...FACILITY_POINTS.captiveChest }
}

module.exports = { captiveRescueConfig }
