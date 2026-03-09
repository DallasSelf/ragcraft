const CORNER_A = Object.freeze({ x: 18, y: 63, z: 17 })
const CORNER_B = Object.freeze({ x: -18, y: 64, z: -9 })

function midpoint(a, b) {
  return {
    x: Math.round((a.x + b.x) / 2),
    y: Math.round((a.y + b.y) / 2),
    z: Math.round((a.z + b.z) / 2)
  }
}

function computeCoverRadius(center, corners) {
  if (!center || !corners) return 16
  const distances = corners.map(corner => {
    const dx = Math.abs(corner.x - center.x)
    const dz = Math.abs(corner.z - center.z)
    return Math.max(dx, dz)
  })
  const max = Math.max(...distances)
  return Math.max(16, Math.ceil(max))
}

const FACILITY_CENTER = Object.freeze(midpoint(CORNER_A, CORNER_B))
const FACILITY_RADIUS = computeCoverRadius(FACILITY_CENTER, [CORNER_A, CORNER_B])

const FACILITY_POINTS = Object.freeze({
  leverRoomCenter: { x: 13, y: 63, z: 0 },
  leverDoorBase: { x: 13, y: 63, z: 2 },
  captiveDoorBase: { x: 18, y: 64, z: 4 },
  captiveChest: { x: 18, y: 65, z: 2 },
  mazeEntranceDoor: { x: 0, y: 64, z: 14 },
  mazeExit: { x: -11, y: 63, z: -5 },
  supplyRoomDoor: { x: 11, y: 64, z: 14 }
})

const FACILITY_BOUNDS = Object.freeze({
  cornerA: { ...CORNER_A },
  cornerB: { ...CORNER_B }
})

module.exports = {
  FACILITY_POINTS,
  FACILITY_BOUNDS,
  FACILITY_CENTER,
  FACILITY_RADIUS
}
