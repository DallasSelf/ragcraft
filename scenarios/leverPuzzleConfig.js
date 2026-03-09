const { FACILITY_POINTS } = require('./facilityLayout')

const SECRET_CONFIG = Object.freeze({
  scenarioId: 'lever_puzzle_3',
  leverCount: 3,
  correctSequence: [2, 3, 1],
  leverBlocks: [
    { x: 15, y: 65, z: -1 },
    { x: 15, y: 65, z: 0 },
    { x: 15, y: 65, z: 1 }
  ],
  leverFace: 'wall',
  leverFacing: 'west',
  spawnPosition: { ...FACILITY_POINTS.leverRoomCenter },
  doorBlock: { ...FACILITY_POINTS.leverDoorBase },
  doorPowerBlock: { ...FACILITY_POINTS.leverDoorBase },
  doorPowerOn: 'redstone_block',
  doorPowerOff: 'stripped_warped_stem',
  doorId: 'lever_exit_door',
  maxAttempts: 6
})

const PUBLIC_FIELDS = [
  'scenarioId',
  'leverCount',
  'leverBlocks',
  'leverFace',
  'leverFacing',
  'spawnPosition',
  'doorBlock',
  'doorPowerBlock',
  'doorPowerOn',
  'doorPowerOff',
  'doorId',
  'maxAttempts'
]

function flagSecretAccess(field) {
  const err = new Error(`Denied secret access to ${field}`)
  const stack = err.stack ? err.stack.split('\n').slice(1, 3).join(' | ') : 'no-stack'
  console.warn(`[secret-guard] ${field} is restricted. Access ignored.`, { stack })
}

const publicView = extractFields(SECRET_CONFIG, PUBLIC_FIELDS)
Object.defineProperty(publicView, 'correctSequence', {
  enumerable: false,
  configurable: false,
  get() {
    flagSecretAccess('leverScenario.correctSequence')
    return undefined
  }
})

const PUBLIC_VIEW = Object.freeze(publicView)

function extractFields(source, fields) {
  return fields.reduce((acc, key) => {
    if (source[key] === undefined) return acc
    acc[key] = cloneValue(source[key])
    return acc
  }, {})
}

function cloneValue(value) {
  if (value == null) return value
  if (Array.isArray(value)) return value.map(cloneValue)
  if (typeof value === 'object') {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = cloneValue(value[key])
      return acc
    }, {})
  }
  return value
}

function getLeverScenarioView() {
  return cloneValue(PUBLIC_VIEW)
}

function getLeverLockType(view = PUBLIC_VIEW) {
  const source = view || PUBLIC_VIEW
  const leverCount = Number(source.leverCount) || 0
  const face = typeof source.leverFace === 'string' ? source.leverFace.toLowerCase() : 'unknown_face'
  const facing = typeof source.leverFacing === 'string' ? source.leverFacing.toLowerCase() : 'unknown_facing'
  return `lever_lock_${leverCount}_${face}_${facing}`
}

function verifyLeverSequence(sequence = []) {
  if (!Array.isArray(sequence)) return false
  if (sequence.length !== SECRET_CONFIG.correctSequence.length) return false
  for (let i = 0; i < sequence.length; i++) {
    if (Number(sequence[i]) !== Number(SECRET_CONFIG.correctSequence[i])) {
      return false
    }
  }
  return true
}

function getLeverSequenceLength() {
  return SECRET_CONFIG.correctSequence.length
}

module.exports = {
  getLeverScenarioView,
  verifyLeverSequence,
  getLeverSequenceLength,
  getLeverLockType
}
