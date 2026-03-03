const { getLeverScenarioView, getLeverLockType } = require('./leverPuzzleConfig')

const leverScenario = getLeverScenarioView()
const leverLockType = getLeverLockType(leverScenario)

const captiveRescueConfig = {
  scenarioId: 'captive_rescue_v1',
  spawnPosition: { x: 18, y: 64, z: 0 },
  observationPost: { x: 16, y: 64, z: 2 },
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
  scenarioSeed: 'lever-door'
}

module.exports = { captiveRescueConfig }
