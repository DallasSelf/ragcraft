function decideAction(observation, memories) {
  if (memories.length > 0) {
    const mem = memories[0]
    if (mem.lastPosition) {
      return {
        type: 'move_to',
        target: mem.lastPosition,
        source: 'memory'
      }
    }
  }

  const pos = observation.position
  const dx = Math.floor(Math.random() * 11) - 5
  const dz = Math.floor(Math.random() * 11) - 5

  return {
    type: 'move_to',
    target: {
      x: pos.x + dx,
      y: pos.y,
      z: pos.z + dz
    },
    source: 'random'
  }
}

module.exports = { decideAction }
