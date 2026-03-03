
const { Vec3 } = require('vec3')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let scannedOnce = false

async function debugScanLevers(bot, logger) {
  if (scannedOnce) return
  scannedOnce = true

  const levers = bot.findBlocks({
    matching: block => block && block.name === 'lever',
    maxDistance: 10,
    count: 50
  })

  logger.log('debug_lever_scan', {
    botPosition: {
      x: bot.entity.position.x,
      y: bot.entity.position.y,
      z: bot.entity.position.z
    },
    foundLevers: levers
  })
}

function ensureScenarioConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Lever scenario configuration is required')
  }
}

async function flipLever(bot, leverIndex, config, logger) {
  ensureScenarioConfig(config)
  await debugScanLevers(bot, logger)

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
    return
  }

  logger.log('lever_block_found', {
    leverIndex,
    blockPosition: block.position,
    blockName: block.name
  })

  const target = block.position.offset(0.5, 0.5, 0.5)

  await bot.lookAt(target, true)
  await wait(200)
  await bot.activateBlock(block)
  await wait(300)
}

async function trySequenceInWorld(bot, sequence, config, logger) {
  ensureScenarioConfig(config)
  for (const leverIndex of sequence) {
    await flipLever(bot, leverIndex, config, logger)
  }
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
    resetLevers: (bot, logger) => resetLevers(bot, logger, config)
  }
}

module.exports = {
  trySequenceInWorld,
  createLeverScenarioController
}
