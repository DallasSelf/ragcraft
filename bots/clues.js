export function parseClue(text) {
  const parts = Object.fromEntries(text.split(/\s+/).map(kv => kv.split(":")))
  const type = parts.TYPE
  const w = parseFloat(parts.w || "0.7")
  return { type, parts, w }
}
export function applyClue(belief, clue, landmarks) {
  const p = clue.parts
  const w = clue.w
  if (clue.type === "REGION") {
    const r = landmarks.region[p.name]
    if (r) applyRegion(belief, r.x1, r.z1, r.x2, r.z2, w)
  } else if (clue.type === "X_BETWEEN") {
    applyBandX(belief, parseInt(p.min), parseInt(p.max), w)
  } else if (clue.type === "NORTH_OF" || clue.type === "SOUTH_OF" || clue.type === "EAST_OF" || clue.type === "WEST_OF") {
    const lm = landmarks.point[p.landmark]
    if (lm) applyHalfspace(belief, clue.type, clue.type === "NORTH_OF" || clue.type === "SOUTH_OF" ? lm.z : lm.x, w)
  } else if (clue.type === "NEAR") {
    const lm = landmarks.point[p.landmark]
    if (lm) applyNear(belief, lm.x, lm.z, parseInt(p.r || "8"), w)
  } else if (clue.type === "NOT_REGION") {
    const r = landmarks.region[p.name]
    if (r) applyRegion(belief, r.x1, r.z1, r.x2, r.z2, 1 / Math.max(w, 0.01))
  }
}
import { applyRegion, applyBandX, applyHalfspace, applyNear } from "./belief.js"
