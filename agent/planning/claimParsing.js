function isCoordinate(value) {
  if (!value || typeof value !== 'object') return false
  return ['x', 'y', 'z'].every(key => Number.isFinite(value[key]))
}

function normalizeNumberArray(sequence) {
  return sequence
    .map(value => Number(value))
    .filter(Number.isFinite)
}

function parseNumbersFromFragment(fragment) {
  if (typeof fragment !== 'string') return null
  const numbers = fragment
    .split(/[^0-9]+/)
    .map(n => Number(n))
    .filter(Number.isFinite)
  return numbers.length ? numbers : null
}

function extractSequenceFromClaim(claim) {
  if (!claim) return null
  if (Array.isArray(claim.sequence)) {
    return normalizeNumberArray(claim.sequence)
  }
  if (Array.isArray(claim.entities?.code)) {
    const codeEntity = claim.entities.code.find(entry => Array.isArray(entry.sequence) || typeof entry.value === 'string')
    if (codeEntity) {
      if (Array.isArray(codeEntity.sequence)) {
        return normalizeNumberArray(codeEntity.sequence)
      }
      if (typeof codeEntity.value === 'string') {
        return parseNumbersFromFragment(codeEntity.value)
      }
    }
  }
  if (typeof claim.code === 'string') {
    return parseNumbersFromFragment(claim.code)
  }
  return null
}

function extractTurnSequenceFromClaim(claim) {
  if (!claim) return null
  if (Array.isArray(claim.turnSequence)) {
    return claim.turnSequence
  }
  if (typeof claim.action_recipe === 'string' && claim.action_recipe.includes('turn sequence')) {
    try {
      const jsonMatch = claim.action_recipe.match(/\[[^\]]+\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) return parsed
      }
    } catch (err) {
      return null
    }
  }
  return null
}

function extractLocationFromClaim(claim) {
  if (!claim || typeof claim !== 'object') return null
  if (isCoordinate(claim.door_location)) return claim.door_location

  const entityLocations = Array.isArray(claim.entities?.location) ? claim.entities.location : []
  for (const loc of entityLocations) {
    if (isCoordinate(loc)) return loc
  }

  const doorEntities = Array.isArray(claim.entities?.door) ? claim.entities.door : []
  for (const entry of doorEntities) {
    if (isCoordinate(entry?.location)) return entry.location
  }

  return null
}

function extractDoorIdFromClaim(claim) {
  if (!claim || typeof claim !== 'object') return null
  if (typeof claim.door_id === 'string' && claim.door_id.trim()) return claim.door_id.trim()
  const entities = Array.isArray(claim.entities?.door) ? claim.entities.door : []
  for (const entry of entities) {
    if (entry && typeof entry.id === 'string' && entry.id.trim()) {
      return entry.id.trim()
    }
  }
  if (typeof claim.metadata?.doorId === 'string' && claim.metadata.doorId.trim()) {
    return claim.metadata.doorId.trim()
  }
  return null
}

function extractLockTypeFromClaim(claim) {
  if (!claim || typeof claim !== 'object') return null
  const candidates = [claim.lock_type, claim.lockType, claim.metadata?.lock_type, claim.metadata?.lockType]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const entities = Array.isArray(claim.entities?.door) ? claim.entities.door : []
  for (const entry of entities) {
    if (typeof entry?.lock_type === 'string' && entry.lock_type.trim()) return entry.lock_type.trim()
    if (typeof entry?.lockType === 'string' && entry.lockType.trim()) return entry.lockType.trim()
  }
  return null
}

module.exports = {
  extractLocationFromClaim,
  extractSequenceFromClaim,
  extractTurnSequenceFromClaim,
  extractDoorIdFromClaim,
  extractLockTypeFromClaim,
  isCoordinate
}
