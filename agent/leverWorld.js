
const { Vec3 } = require('vec3')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function ensureScenarioConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Lever scenario configuration is required')
  }
}

async function flipLever(bot, leverIndex, config, logger) {
  ensureScenarioConfig(config)

  const idx = leverIndex - 1
  const pos = config.leverBlocks[idx]
  const blockPos = new Vec3(pos.x, pos.y, pos.z)
  const block = bot.blockAt(blockPos)

  if (!block) {
    logger.log('lever_block_missing', {
      leverIndex,
      expectedPosition: pos,
      botPosition: {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z
      }
    })
    return false
  }

  logger.log('lever_block_found', {
    leverIndex,
    blockPosition: block.position,
    blockName: block.name
  })

  const target = block.position.offset(0.5, 0.5, 0.5)

  await bot.lookAt(target, true)
  await wait(200)
  try {
    await bot.activateBlock(block)
  } catch (err) {
    logger.log('lever_flip_failed', {
      leverIndex,
      message: err.message
    })
    return false
  }
  await wait(300)
  return true
}

async function trySequenceInWorld(bot, sequence, config, logger) {
  ensureScenarioConfig(config)
  for (const leverIndex of sequence) {
    const ok = await flipLever(bot, leverIndex, config, logger)
    if (!ok) return false
  }
  return true
}

async function closeDoor(bot, logger, config) {
  ensureScenarioConfig(config)
  const pos = config.doorPowerBlock
  if (!pos) return
  const material = config.doorPowerOff
  const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} ${material}`
  bot.chat(cmd)
  logger.log('lever_door_close', { cmd })
  await wait(300)
}

async function openDoor(bot, logger, config) {
  ensureScenarioConfig(config)
  const pos = config.doorPowerBlock
  if (!pos) return
  const material = config.doorPowerOn
  const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} ${material}`
  bot.chat(cmd)
  logger.log('lever_door_open', { cmd })
  await wait(300)
}

async function resetLevers(bot, logger, config) {
  ensureScenarioConfig(config)
  const face = config.leverFace || 'wall'
  const facing = config.leverFacing || 'north'
  for (const pos of config.leverBlocks || []) {
    const cmd = `/setblock ${pos.x} ${pos.y} ${pos.z} lever[face=${face},facing=${facing},powered=false]`
    bot.chat(cmd)
    logger.log('lever_reset_block', { cmd, pos })
    await wait(150)
  }
  await wait(250)
}

function isDoorPowerOn(bot, config) {
  ensureScenarioConfig(config)
  const pos = config.doorPowerBlock
  if (!pos) return false
  const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
  if (!block) return false
  return block.name === config.doorPowerOn
}

function getLeverPoweredState(block) {
  if (!block) return null
  if (typeof block.getProperties === 'function') {
    const props = block.getProperties()
    if (props && typeof props.powered === 'boolean') return props.powered
  }
  if (block._properties && typeof block._properties.powered === 'boolean') {
    return block._properties.powered
  }
  return null
}

function areLeversReset(bot, config) {
  ensureScenarioConfig(config)
  for (const pos of config.leverBlocks || []) {
    const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
    if (!block || block.name !== 'lever') {
      return false
    }
    const powered = getLeverPoweredState(block)
    if (powered !== false) {
      return false
    }
  }
  return true
}

async function teleportToLeverStart(bot, logger, config) {
  ensureScenarioConfig(config)
  const pos = config.spawnPosition
  if (!pos) return
  const cmd = `/tp ${bot.username} ${pos.x} ${pos.y} ${pos.z}`
  bot.chat(cmd)
  logger.log('lever_teleport_start', { cmd })
  await wait(300)
}

function createLeverScenarioController(config) {
  ensureScenarioConfig(config)
  return {
    teleportToStart: (bot, logger) => teleportToLeverStart(bot, logger, config),
    closeDoor: (bot, logger) => closeDoor(bot, logger, config),
    openDoor: (bot, logger) => openDoor(bot, logger, config),
    resetLevers: (bot, logger) => resetLevers(bot, logger, config),
    verifyDoorOpen: bot => isDoorPowerOn(bot, config),
    verifyReset: bot => areLeversReset(bot, config)
  }
}

module.exports = {
  trySequenceInWorld,
  createLeverScenarioController
}
