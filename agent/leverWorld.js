
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

async function flipLever(bot, leverIndex, config, logger) {
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
  for (const leverIndex of sequence) {
    await flipLever(bot, leverIndex, config, logger)
  }
}

module.exports = { trySequenceInWorld }
