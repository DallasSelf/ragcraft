const lockedChestPos = { x: 5, y: 64, z: 5 }
const keyItemPos = { x: 11, y: 64, z: 13 }
const searchBounds = {
  minX: -24,
  maxX: 21,
  minZ: -9,
  maxZ: 18,
  y: 63
}

const SECRET_CONFIG = Object.freeze({
  scenarioId: 'key_finder_v1',
  spawnPos: { x: 7, y: 64, z: 10 },
  keyItemPos,
  lockedChest: {
    ...lockedChestPos,
    facing: 'west'
  },
  keyItem: {
    id: 'tripwire_hook',
    customName: 'Chest Key'
  },
  search: {
    bounds: searchBounds,
    step: 4,
    stepsPerAttempt: 14,
    detectionRadius: 3,
    memoryBiasRadius: 6,
    minStepsBeforeKey: 3,
    moveTimeoutMs: 8000,
    entitySpotRadius: 12,
    entityApproachRadius: 1.4,
    forceKeyStep: 6
  },
  commands: {
    clearLockedChest: `/setblock ${lockedChestPos.x} ${lockedChestPos.y} ${lockedChestPos.z} air`,
    rebuildLockedChest: `/setblock ${lockedChestPos.x} ${lockedChestPos.y} ${lockedChestPos.z} chest[facing=west]{lock:{items:"tripwire_hook",count:1,components:{"minecraft:item_name":"Chest Key"}}}`,
    clearLooseKeys: `/kill @e[type=item,x=${keyItemPos.x},y=${keyItemPos.y},z=${keyItemPos.z},distance=..4]`,
    summonKeyItem: `/summon item ${keyItemPos.x} ${keyItemPos.y} ${keyItemPos.z} {Item:{id:"minecraft:tripwire_hook",Count:1b,components:{"minecraft:item_name":"Chest Key"}}}`,
    clearKeyTemplate: '/clear __PLAYER__ tripwire_hook'
  },
  maxAttempts: 6
})

const PUBLIC_FIELDS = [
  'scenarioId',
  'spawnPos',
  'lockedChest',
  'keyItem',
  'search',
  'commands',
  'maxAttempts'
]

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

function extractFields(source, fields) {
  return fields.reduce((acc, key) => {
    if (source[key] === undefined) return acc
    acc[key] = cloneValue(source[key])
    return acc
  }, {})
}

function flagSecretAccess(field) {
  const err = new Error(`Denied secret access to ${field}`)
  const stack = err.stack ? err.stack.split('\n').slice(1, 3).join(' | ') : 'no-stack'
  console.warn(`[secret-guard] ${field} is restricted. Access ignored.`, { stack })
}

const publicConfig = extractFields(SECRET_CONFIG, PUBLIC_FIELDS)
Object.defineProperty(publicConfig, 'keyItemPos', {
  enumerable: false,
  configurable: false,
  get() {
    flagSecretAccess('keyFinderConfig.keyItemPos')
    return undefined
  }
})

const keyFinderConfig = Object.freeze(publicConfig)

module.exports = { keyFinderConfig }

