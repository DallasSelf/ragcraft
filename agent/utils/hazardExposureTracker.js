const { Vec3 } = require('vec3')
const { HAZARD_BLOCK_TAGS } = require('../constants/hazards')

function attachHazardExposureLogger(bot, logger, context = {}) {
  if (!bot || typeof bot.on !== 'function' || !logger || typeof logger.log !== 'function') {
    return { dispose() {} }
  }

  let lastHealth = typeof bot.health === 'number' ? bot.health : null

  const handleHealth = () => {
    if (typeof bot.health !== 'number') return
    if (lastHealth == null) {
      lastHealth = bot.health
      return
    }
    const damage = Number((lastHealth - bot.health).toFixed(2))
    lastHealth = bot.health
    if (damage <= 0) return

    const hazardType = detectNearbyHazard(bot)
    const event = {
      runId: context.runId || null,
      scenarioId: context.scenarioId || null,
      hazardType: hazardType || 'unknown',
      damage,
      health: Number(bot.health.toFixed(2)),
      position: quantizePosition(bot.entity?.position),
      source: hazardType ? 'environment' : 'unknown'
    }

    logger.log('hazard_exposure', event)
    if (typeof context.onExposure === 'function') {
      context.onExposure(event)
    }
  }

  bot.on('health', handleHealth)

  return {
    dispose() {
      bot.removeListener('health', handleHealth)
    }
  }
}

function detectNearbyHazard(bot) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null
  const px = Math.floor(bot.entity.position.x)
  const py = Math.floor(bot.entity.position.y)
  const pz = Math.floor(bot.entity.position.z)
  const samples = [
    new Vec3(px, py - 1, pz),
    new Vec3(px, py, pz),
    new Vec3(px, py + 1, pz)
  ]
  for (const sample of samples) {
    const block = bot.blockAt(sample)
    if (isHazardBlock(block)) {
      return block.name
    }
  }
  return null
}

function isHazardBlock(block) {
  if (!block || typeof block.name !== 'string') return false
  return HAZARD_BLOCK_TAGS.some(tag => block.name.includes(tag))
}

function quantizePosition(pos) {
  if (!pos) return null
  return {
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    z: Math.round(pos.z)
  }
}

module.exports = {
  attachHazardExposureLogger
}
