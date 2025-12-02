function buildObservation(bot) {
  const pos = bot.entity.position
  return {
    position: {
      x: pos.x,
      y: pos.y,
      z: pos.z
    },
    time: Date.now()
  }
}

module.exports = { buildObservation }
