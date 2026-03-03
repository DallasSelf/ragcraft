const { ensureInputs, skillSuccess, skillFailure } = require('./skillUtils')
const { isCoordinate } = require('../planning/claimParsing')

async function execute(context = {}) {
  const inputs = ensureInputs(context.inputs || context, ['hazardPosition'])
  if (!isCoordinate(inputs.hazardPosition)) {
    return skillFailure('hazard_invalid', 'Hazard position is not a coordinate')
  }

  const radius = Number.isFinite(inputs.radius) ? inputs.radius : 4
  const record = {
    position: {
      x: Math.round(inputs.hazardPosition.x),
      y: Math.round(inputs.hazardPosition.y),
      z: Math.round(inputs.hazardPosition.z)
    },
    radius,
    label: inputs.label || 'hazard'
  }

  if (context.blackboard) {
    context.blackboard.avoidZones = context.blackboard.avoidZones || []
    context.blackboard.avoidZones.push(record)
  }

  if (context.adapters?.avoidHazardZone) {
    await context.adapters.avoidHazardZone({ hazard: record, bot: context.bot })
  }

  return skillSuccess('hazard_registered', { radius })
}

module.exports = {
  id: 'avoid_hazard_zone',
  requiredInputs: ['hazardPosition'],
  successSignals: ['hazard_registered', 'hazard_invalid'],
  execute
}
