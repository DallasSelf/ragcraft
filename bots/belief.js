export function makeBelief(minX, minZ, size) {
  const grid = new Float32Array(size * size).fill(1)
  return { minX, minZ, size, grid }
}
export function idx(b, x, z) {
  const gx = x - b.minX
  const gz = z - b.minZ
  if (gx < 0 || gz < 0 || gx >= b.size || gz >= b.size) return -1
  return gz * b.size + gx
}
export function applyRegion(b, x1, z1, x2, z2, w) {
  const minx = Math.max(0, Math.min(x1 - b.minX, x2 - b.minX))
  const maxx = Math.min(b.size - 1, Math.max(x1 - b.minX, x2 - b.minX))
  const minz = Math.max(0, Math.min(z1 - b.minZ, z2 - b.minZ))
  const maxz = Math.min(b.size - 1, Math.max(z1 - b.minZ, z2 - b.minZ))
  for (let z = minz; z <= maxz; z++) for (let x = minx; x <= maxx; x++) b.grid[z * b.size + x] *= w
}
export function applyBandX(b, min, max, w) {
  const minx = Math.max(0, min - b.minX)
  const maxx = Math.min(b.size - 1, max - b.minX)
  for (let z = 0; z < b.size; z++) for (let x = 0; x < b.size; x++) {
    const inside = x >= minx && x <= maxx
    b.grid[z * b.size + x] *= inside ? w : 1
  }
}
export function applyHalfspace(b, dir, pivot, w) {
  for (let z = 0; z < b.size; z++) for (let x = 0; x < b.size; x++) {
    const wx = b.minX + x
    const wz = b.minZ + z
    let keep = true
    if (dir === "NORTH_OF") keep = wz < pivot
    if (dir === "SOUTH_OF") keep = wz > pivot
    if (dir === "EAST_OF") keep = wx > pivot
    if (dir === "WEST_OF") keep = wx < pivot
    b.grid[z * b.size + x] *= keep ? w : 1
  }
}
export function applyNear(b, cx, cz, r, w) {
  const r2 = r * r
  for (let z = 0; z < b.size; z++) for (let x = 0; x < b.size; x++) {
    const dx = b.minX + x - cx
    const dz = b.minZ + z - cz
    const d2 = dx * dx + dz * dz
    if (d2 <= r2) b.grid[z * b.size + x] *= w
  }
}
export function normalize(b) {
  let s = 0
  for (let i = 0; i < b.grid.length; i++) s += b.grid[i]
  const k = s > 0 ? 1 / s : 1
  for (let i = 0; i < b.grid.length; i++) b.grid[i] *= k
}
export function bestCell(b) {
  let bi = 0, bv = -1
  for (let i = 0; i < b.grid.length; i++) if (b.grid[i] > bv) { bv = b.grid[i]; bi = i }
  const z = Math.floor(bi / b.size)
  const x = bi - z * b.size
  return { x: b.minX + x, z: b.minZ + z, score: bv }
}
export function merge(bA, bB, wa = 0.5) {
  const wb = 1 - wa
  const g = bA.grid
  const h = bB.grid
  for (let i = 0; i < g.length; i++) g[i] = g[i] * wa + h[i] * wb
  normalize(bA)
}
