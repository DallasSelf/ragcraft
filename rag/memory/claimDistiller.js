const { MemoryTypes } = require('./schema')

/**
 * Entry point for claim distillation across scenarios.
 * Returns plain claim payloads ready to be ingested with ingestDistilledMemory.
 */
async function distillClaimsFromEpisode(context = {}) {
  const builders = [buildDoorCodeClaim, buildScoutClaims]
  const claims = []

  for (const builder of builders) {
    try {
      const output = await builder(context)
      if (!output) continue
      if (Array.isArray(output)) {
        claims.push(...output)
      } else {
        claims.push(output)
      }
    } catch (err) {
      if (context.logger && typeof context.logger.log === 'function') {
        context.logger.log('claim_distill_error', {
          scenarioId: context.scenarioId,
          runId: context.runId,
          builder: builder.name,
          message: err.message
        })
      }
    }
  }

  return claims
}

function buildDoorCodeClaim(context = {}) {
  const { scenarioId, result, runId } = context
  if (!scenarioId || !scenarioId.startsWith('lever')) return null
  if (!result || !result.solved) return null

  const evidence = result.successEvidence || {}
  if (!evidence.doorUnlocked && !evidence.verification) return null

  const sequence = Array.isArray(evidence.sequence)
    ? evidence.sequence
    : []

  if (sequence.length === 0) return null

  const doorLocation = evidence.doorLocation
  if (!doorLocation) return null

  const doorId = evidence.doorId || `${scenarioId}_door`
  const lockType = typeof evidence.lockType === 'string'
    ? evidence.lockType
    : `lever_lock_len_${sequence.length}`
  const codeText = sequence.join('-')
  const howTo = evidence.howToApply || `Toggle levers in order ${codeText} to open the door at (${doorLocation.x},${doorLocation.y},${doorLocation.z}).`
  const sourceEpisodes = new Set()
  if (runId) sourceEpisodes.add(runId)
  if (evidence.sourceEpisodeId) sourceEpisodes.add(evidence.sourceEpisodeId)

  const baseClaim = {
    memory_type: MemoryTypes.CLAIM,
    task_id: scenarioId,
    scenarioId,
    goal_tags: ['door_unlock', 'lever_sequence'],
    entities: {
      door: [{ id: doorId, location: doorLocation, lockType }],
      code: [{ value: codeText, sequence }],
      location: [doorLocation],
      tool: []
    },
    prerequisites: evidence.prerequisites || [],
    action_recipe: howTo,
    confidence: typeof evidence.confidence === 'number' ? evidence.confidence : 0.96,
    timestamp: evidence.timestamp || Date.now(),
    source_episode_ids: Array.from(sourceEpisodes),
    type: 'door_code_claim',
    door_id: doorId,
    code: codeText,
    door_location: doorLocation,
    how_to_apply: howTo,
    lock_type: lockType
  }

  return baseClaim
}

module.exports = {
  distillClaimsFromEpisode
}

function buildScoutClaims(context = {}) {
  const { scenarioId, result, runId } = context
  if (scenarioId !== 'scout_area_v1') return null
  if (!result || !Array.isArray(result.claims) || result.claims.length === 0) return null

  return result.claims.map(raw => normalizeScoutClaim(raw, scenarioId, runId))
}

function normalizeScoutClaim(claim = {}, scenarioId, runId) {
  const baseEntities = {
    door: [],
    code: [],
    location: [],
    tool: []
  }

  const entities = { ...baseEntities, ...(claim.entities || {}) }
  const sourceEpisodes = new Set()
  ;[(claim.source_episode_ids || []), (claim.sourceEpisodeIds || [])].flat().forEach(id => {
    if (id) sourceEpisodes.add(String(id))
  })
  if (runId) sourceEpisodes.add(String(runId))

  return {
    memory_type: MemoryTypes.CLAIM,
    ...claim,
    task_id: claim.task_id || scenarioId,
    scenarioId: claim.scenarioId || scenarioId,
    goal_tags: Array.isArray(claim.goal_tags) && claim.goal_tags.length > 0 ? claim.goal_tags : ['scouting'],
    entities,
    prerequisites: Array.isArray(claim.prerequisites) ? claim.prerequisites : [],
    confidence: Number.isFinite(claim.confidence) ? claim.confidence : 0.72,
    timestamp: claim.timestamp || Date.now(),
    source_episode_ids: Array.from(sourceEpisodes)
  }
}
