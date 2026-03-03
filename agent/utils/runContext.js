const GOAL_TYPE_MAP = {
  lever: 'unlock',
  key: 'artifact',
  maze: 'maze',
  captive_rescue_v1: 'captive',
  scout_area_v1: 'scout'
}

function buildRunContext({ scenarioId, mode }) {
  const normalizedScenario = scenarioId || 'unknown'
  const goalType = process.env.COMPOSITE_GOAL
    || GOAL_TYPE_MAP[normalizedScenario]
    || normalizedScenario

  const conditionName = process.env.COMPOSITE_CONDITION
    || process.env.EXPERIMENT_CONDITION
    || null

  const scoutFlag = String(process.env.SCOUT_ENABLED || '').toLowerCase()
  const scoutPhase = (process.env.COMPOSITE_PHASE || '').toLowerCase() === 'scout'
  const scoutEnabled = scoutPhase || scoutFlag === 'true' || normalizedScenario === 'scout_area_v1'

  const scope = (process.env.GOAL_CLAIM_SCOPE || 'local').toLowerCase()
  const sources = (process.env.GOAL_CLAIM_ALLOWED_SOURCES || 'claims_only').toLowerCase()
  const transferMode = `${scope}:${sources}`

  const transferFlags = new Set()
  if (scope === 'global') transferFlags.add('global_scope')
  if (sources.includes('claims')) transferFlags.add('claims_transfer')
  if (sources.includes('raw')) transferFlags.add('raw_transfer')

  const normalizedMode = (mode || '').toLowerCase()
  if (normalizedMode) transferFlags.add(`${normalizedMode}_mode`)
  if (scoutEnabled) transferFlags.add('scout_enabled')

  return {
    scenarioType: normalizedScenario,
    goalType,
    conditionName,
    scoutEnabled,
    transferMode,
    transferFlags: Array.from(transferFlags)
  }
}

module.exports = {
  buildRunContext
}
