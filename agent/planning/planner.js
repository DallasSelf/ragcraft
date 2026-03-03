const {
  extractLocationFromClaim,
  extractSequenceFromClaim,
  extractTurnSequenceFromClaim,
  extractDoorIdFromClaim,
  extractLockTypeFromClaim,
  isCoordinate
} = require('./claimParsing')
const { createWorldModel } = require('../world_model')
const { claimTrace } = require('../../logging/debugFlags')

const STEP_DEFAULT_KIND = {
  navigate_to_landmark: 'prerequisite',
  retrieve_from_chest: 'action',
  unlock_door_with_code: 'action',
  avoid_hazard_zone: 'prerequisite',
  traverse_safe_route: 'action',
  solve_lever_panel: 'prerequisite',
  interact_entity: 'action',
  explore_bounded_region: 'prerequisite'
}

function createScenarioPlan({
  scenarioId,
  goalText = '',
  goal = {},
  worldState = {},
  inventory = [],
  claimMemories = [],
  worldModel = null
} = {}) {
  const resolvedWorldModel = ensureWorldModel(worldModel, claimMemories)
  const base = {
    scenarioId,
    goalText,
    goal,
    strategy: 'default',
    steps: [],
    metadata: {
      claimReferences: []
    }
  }

  if (!scenarioId) {
    return finalizePlan({ ...base, strategy: 'assess_goal' }, [
      makeStep('assess_goal', 'prerequisite', 'Assess available objectives and required prerequisites')
    ])
  }

  const context = {
    scenarioId,
    goalText,
    goal,
    worldState,
    inventory,
    claimMemories,
    worldModel: resolvedWorldModel
  }

  const intent = deriveGoalIntent(context)
  const planDetails = composePlan(intent, context)

  if (!planDetails.steps.length) {
    return finalizePlan({ ...base, strategy: 'assess_goal' }, [
      makeStep('assess_goal', 'prerequisite', 'Assess available objectives and required prerequisites')
    ])
  }

  return finalizePlan({ ...base, strategy: planDetails.strategy }, planDetails.steps, planDetails.metadata)
}

function deriveGoalIntent(context) {
  const goal = context.goal || {}
  const goalTags = normalizeStringSet(goal.goal_tags)
  const wantsDoor = hasAnyTag(goalTags, ['door', 'unlock', 'code', 'rescue'])
  const wantsResource = hasAnyTag(goalTags, ['key', 'resource', 'tool', 'retrieve']) || hasGoalEntity(goal, 'key')
  const wantsInteraction = hasAnyTag(goalTags, ['captive', 'rescue', 'interact']) || hasGoalEntity(goal, 'captive') || hasGoalEntity(goal, 'chest')
  const wantsNavigation = hasAnyTag(goalTags, ['maze', 'navigation', 'explore', 'travel']) || Array.isArray(goal.entities?.location)

  const resourcePlan = wantsResource ? selectResourcePlan(context) : null
  const resourceTarget = resourcePlan?.target || null
  const resourceFallback = resourcePlan?.fallback || null
  const doorTarget = wantsDoor ? selectDoorTarget(context) : null
  const finalTarget = selectFinalTarget(context, resourceTarget, doorTarget, wantsNavigation)
  const interactionTarget = wantsInteraction ? selectInteractionTarget(context) : null
  const hazards = findRelevantHazards(context.worldModel, finalTarget?.position || doorTarget?.position)
  const routeOptions = gatherRouteOptions(context.worldModel, context.claimMemories)

  return {
    resourcePlan,
    resourceTarget,
    resourceFallback,
    doorTarget,
    finalTarget,
    interactionTarget,
    hazards,
    routeOptions
  }
}

function composePlan(intent, context) {
  const steps = []
  const metadata = buildMetadata()
  let dependencyChain = []
  const resourcePlan = intent.resourcePlan || null

  const pushStep = (skillId, description, options = {}) => {
    const id = options.stepId || `${skillId}_${steps.length + 1}`
    const kind = options.kind || STEP_DEFAULT_KIND[skillId] || 'prerequisite'
    const dependsOn = Array.isArray(options.dependsOn) && options.dependsOn.length > 0 ? options.dependsOn : dependencyChain
    const step = makeStep(id, kind, description, options.claimRef || null, dependsOn, skillId, options.inputs || {})
    steps.push(step)
    if (options.claimRef) {
      claimTrace('plan_step_claim', {
        scenarioId: context.scenarioId,
        claimId: options.claimRef,
        stepId: step.id,
        skill: skillId,
        description
      })
    }
    dependencyChain = options.persistDependency === false ? dependencyChain : [step.id]
    return step.id
  }

  if (intent.resourceTarget) {
    const target = intent.resourceTarget
    const resourceLabel = target.description || target.resourceType || 'resource'
    const targetPosition = target.position || target.location
    const fallbackContext = resourcePlan?.fallback || null
    const navId = pushStep(
      'navigate_to_landmark',
      `Navigate to ${resourceLabel} at ${formatLocation(targetPosition)}`,
      {
        claimRef: target.claimId,
        inputs: {
          targetPosition,
          tolerance: target.tolerance || 1.25
        }
      }
    )
    const retrieveId = pushStep(
      'retrieve_from_chest',
      `Retrieve ${resourceLabel}`,
      {
        claimRef: target.claimId,
        dependsOn: [navId],
        inputs: {
          chestPosition: targetPosition,
          expectedItem: target.expectedItem || resourceLabel,
          metadata: {
            resourceType: target.resourceType || resourcePlan?.resourceType || 'resource'
          }
        }
      }
    )
    dependencyChain = [retrieveId]
    if (isCoordinate(targetPosition)) {
      metadata.preferredLocations.push(targetPosition)
    }
    if (target.claimId) metadata.claimReferences.push(target.claimId)
    if (target.resourceType === 'key') {
      metadata.skipKeySearch = true
    }
    metadata.resourceAcquisition = buildResourceAcquisitionMetadata({
      strategy: target.source || 'claim',
      resourceType: target.resourceType || resourcePlan?.resourceType || 'resource',
      avoidedSearchActions: fallbackContext?.estimatedActions || 0,
      searchBounds: fallbackContext?.bounds || null,
      claimId: target.claimId || null,
      estimatedActions: fallbackContext?.estimatedActions || null
    })
  }

  if (!intent.resourceTarget && intent.resourceFallback && intent.resourceFallback.bounds) {
    const fallback = intent.resourceFallback
    const description = fallback.description || `Explore ${formatBounds(fallback.bounds)} for ${fallback.resourceType || 'required item'}`
    const exploreId = pushStep(
      'explore_bounded_region',
      description,
      {
        inputs: {
          bounds: cloneBounds(fallback.bounds) || fallback.bounds,
          metadata: {
            resourceType: fallback.resourceType || resourcePlan?.resourceType || 'resource',
            estimatedActions: fallback.estimatedActions || null
          }
        }
      }
    )
    dependencyChain = [exploreId]
    metadata.resourceAcquisition = buildResourceAcquisitionMetadata({
      strategy: 'explore',
      resourceType: fallback.resourceType || resourcePlan?.resourceType || 'resource',
      avoidedSearchActions: 0,
      searchBounds: fallback.bounds,
      claimId: null,
      estimatedActions: fallback.estimatedActions || null
    })
  }

  if (intent.doorTarget) {
    const door = intent.doorTarget
    const hasKnownCode = Array.isArray(door.codeSequence) && door.codeSequence.length > 0
    if (!hasKnownCode) {
      const solveId = pushStep(
        'solve_lever_panel',
        `Solve lever panel for ${door.description || 'target door'}`,
        {
          claimRef: door.claimId,
          inputs: {
            panelDescriptor: door.id || door.description || 'door_panel'
          }
        }
      )
      dependencyChain = [solveId]
      metadata.doorUnlockPlan = {
        strategy: 'fresh_solve',
        reused: false,
        doorId: door.id || null,
        lockType: door.lockType || null,
        claimId: null
      }
    } else {
      metadata.doorUnlockPlan = {
        strategy: door.codeSource || 'door_id_transfer',
        reused: door.codeSource === 'door_id_transfer' || door.codeSource === 'lock_type_transfer',
        doorId: door.id || null,
        lockType: door.lockType || null,
        claimId: door.codeClaimId || door.claimId || null
      }
    }

    const navId = pushStep(
      'navigate_to_landmark',
      `Navigate to door ${door.description || door.id || 'target door'} at ${formatLocation(door.position)}`,
      {
        claimRef: door.claimId,
        inputs: {
          targetPosition: door.position,
          tolerance: door.tolerance || 1.25
        }
      }
    )
    const codeText = Array.isArray(door.codeSequence) && door.codeSequence.length > 0
      ? door.codeSequence.join('-')
      : 'the available lever sequence'
    const unlockId = pushStep(
      'unlock_door_with_code',
      `Unlock the door using ${codeText}`,
      {
        claimRef: door.claimId,
        dependsOn: [navId],
        inputs: {
          codeSequence: Array.isArray(door.codeSequence) ? door.codeSequence : [],
          doorPosition: door.position,
          metadata: {
            doorId: door.id || null,
            lockType: door.lockType || null,
            codeSource: metadata.doorUnlockPlan?.strategy || door.codeSource || 'unknown'
          }
        }
      }
    )
    dependencyChain = [unlockId]
    if (door.claimId) metadata.claimReferences.push(door.claimId)
    if (Array.isArray(door.codeSequence) && door.codeSequence.length > 0) {
      metadata.claimSequences.push(door.codeSequence)
      metadata.skipLeverRoom = true
    }
    if (isCoordinate(door.position)) {
      metadata.preferredLocations.push(door.position)
    }
  }

  if (Array.isArray(intent.hazards) && intent.hazards.length > 0) {
    let lastHazardStepId = null
    const hazardZoneMetadata = []
    intent.hazards.forEach(hazard => {
      const safePath = selectPreferredSafePath(hazard.safePaths)
      if (safePath) {
        const entryPosition = safePath.entry || (safePath.waypoints && safePath.waypoints[0]) || hazard.position
        let navId = null
        if (isCoordinate(entryPosition)) {
          navId = pushStep(
            'navigate_to_landmark',
            `Stage at safe path entry near ${hazard.description || 'hazard'} ${formatLocation(entryPosition)}`,
            {
              inputs: {
                targetPosition: entryPosition,
                tolerance: 1.25
              }
            }
          )
        }
        const safeStepId = pushStep(
          'traverse_safe_route',
          `Follow safe path to bypass ${hazard.description || hazard.hazardType || 'hazard'}`,
          {
            claimRef: safePath.claimId || hazard.claimId,
            dependsOn: navId ? [navId] : undefined,
            inputs: {
              turnSequence: safePath.waypoints || [],
              metadata: {
                hazardLabel: hazard.description || hazard.hazardType || 'hazard',
                hazardClaimId: hazard.claimId || safePath.hazardClaimId || null
              }
            }
          }
        )
        lastHazardStepId = safeStepId
        if (safePath.claimId) metadata.claimReferences.push(safePath.claimId)
        if (Array.isArray(safePath.waypoints) && safePath.waypoints.length > 0) {
          metadata.preferredTurnSequences.push(safePath.waypoints)
        }
        hazardZoneMetadata.push({
          position: hazard.position,
          label: hazard.description || hazard.hazardType || 'hazard',
          claimId: hazard.claimId || null,
          safePathClaimId: safePath.claimId || null,
          strategy: 'safe_path'
        })
        return
      }

      const hazardId = pushStep(
        'avoid_hazard_zone',
        `Avoid hazard ${hazard.description || 'zone'} near ${formatLocation(hazard.position)}`,
        {
          claimRef: hazard.claimId,
          inputs: {
            hazardPosition: hazard.position,
            radius: hazard.radius || 4,
            label: hazard.description || 'hazard'
          }
        }
      )
      lastHazardStepId = hazardId
      if (hazard.claimId) metadata.claimReferences.push(hazard.claimId)
      hazardZoneMetadata.push({
        position: hazard.position,
        label: hazard.description || 'hazard',
        claimId: hazard.claimId || null,
        strategy: 'avoid_zone'
      })
    })
    if (lastHazardStepId) {
      dependencyChain = [lastHazardStepId]
    }
    if (hazardZoneMetadata.length > 0) {
      metadata.hazardZones = hazardZoneMetadata
    }
  }

  if (intent.routeOptions.length > 0) {
    const bestRoute = intent.routeOptions[0]
    const description = `Traverse safe route consisting of ${bestRoute.sequence.length} steps`
    const routeStepId = pushStep('traverse_safe_route', description, {
      claimRef: bestRoute.claimId,
      inputs: {
        turnSequence: bestRoute.sequence
      }
    })
    dependencyChain = [routeStepId]
    metadata.preferredTurnSequences.push(bestRoute.sequence)
    if (bestRoute.claimId) metadata.claimReferences.push(bestRoute.claimId)

    intent.routeOptions.slice(1).forEach(option => {
      metadata.preferredTurnSequences.push(option.sequence)
      if (option.claimId) metadata.claimReferences.push(option.claimId)
    })
  }

  if (intent.finalTarget) {
    const finalNavDescription = intent.routeOptions.length > 0
      ? `Navigate to goal location at ${formatLocation(intent.finalTarget.position)} after traversing safe route`
      : `Navigate to goal location at ${formatLocation(intent.finalTarget.position)}`
    const goalNavId = pushStep('navigate_to_landmark', finalNavDescription, {
      inputs: {
        targetPosition: intent.finalTarget.position,
        tolerance: intent.finalTarget.tolerance || 1.25
      }
    })
    dependencyChain = [goalNavId]
    metadata.preferredLocations.push(intent.finalTarget.position)
  }

  if (intent.interactionTarget) {
    const interaction = intent.interactionTarget
    pushStep(
      'interact_entity',
      `Interact with ${interaction.description || 'target entity'}`,
      { claimRef: interaction.claimId }
    )
  }

  metadata.claimReferences = Array.from(new Set(metadata.claimReferences.filter(Boolean)))
  metadata.claimSequences = dedupeSequences(metadata.claimSequences)
  metadata.preferredLocations = dedupePositions(metadata.preferredLocations)
  metadata.preferredTurnSequences = dedupeSequences(metadata.preferredTurnSequences)

  const strategy = steps.length > 0
    ? steps.map(step => step.skill || step.id).join('->')
    : 'assess_goal'

  return { steps, metadata, strategy }
}

function ensureWorldModel(model, claims) {
  if (model && typeof model === 'object') {
    return model
  }
  const safeClaims = Array.isArray(claims) ? claims : []
  return createWorldModel(safeClaims)
}

function selectResourcePlan(context) {
  const resourceHints = resolveResourceHints(context)
  const fallback = resolveResourceFallback(context, resourceHints[0])
  const claimTarget = findResourceClaimTarget(context.claimMemories, resourceHints)
  if (claimTarget) {
    return {
      resourceType: claimTarget.resourceType,
      target: claimTarget,
      fallback
    }
  }

  const insightTarget = findResourceInsightTarget(context.worldModel, resourceHints)
  if (insightTarget) {
    return {
      resourceType: insightTarget.resourceType,
      target: insightTarget,
      fallback
    }
  }

  return {
    resourceType: resourceHints[0],
    target: null,
    fallback
  }
}

function resolveResourceHints(context) {
  const goal = context.goal || {}
  const goalTags = normalizeStringSet(goal.goal_tags)
  const hints = []
  if (goalTags.has('key') || hasGoalEntity(goal, 'key')) hints.push('key')
  if (goalTags.has('tool') || hasGoalEntity(goal, 'tool')) hints.push('tool')
  if (hints.length === 0) hints.push('resource')
  return hints
}

function resolveResourceFallback(context, resourceType) {
  const search = context.worldState?.resourceSearch || {}
  const bounds = cloneBounds(search.bounds || context.worldState?.searchBounds)
  if (!bounds) return null
  return {
    resourceType,
    bounds,
    estimatedActions: Number.isFinite(search.maxActions)
      ? search.maxActions
      : Number.isFinite(search.estimatedActions)
        ? search.estimatedActions
        : null,
    description: search.description || `Explore ${formatBounds(bounds)} for ${resourceType || 'resource'}`,
    source: search.source || 'world_state'
  }
}

function findResourceClaimTarget(claims = [], resourceHints = []) {
  if (!Array.isArray(claims) || claims.length === 0) return null
  for (const hint of resourceHints) {
    const match = claims.find(claim => matchesResourceClaimType(claim, hint))
    if (!match) continue
    const target = buildResourceTargetFromClaim(match, hint)
    if (target) return target
  }
  return null
}

function matchesResourceClaimType(claim, resourceType) {
  const normalized = String(claim?.type || '').toLowerCase()
  if (resourceType === 'key') return normalized === 'keylocationclaim'
  if (resourceType === 'tool') return normalized === 'toollocationclaim'
  return normalized === 'toollocationclaim' || normalized === 'keylocationclaim'
}

function buildResourceTargetFromClaim(claim, resourceType) {
  const position = extractLocationFromClaim(claim)
  if (!isCoordinate(position)) return null
  return {
    id: claim.id || claim.memory_id || `${resourceType}_claim`,
    position: clonePosition(position),
    claimId: claim.id || claim.memory_id,
    description: claim.description || `${resourceType || 'resource'} location`,
    expectedItem: resolveResourceNameFromClaim(claim, resourceType),
    resourceType,
    source: 'claim'
  }
}

function resolveResourceNameFromClaim(claim, resourceType) {
  const key = resourceType === 'key' ? 'key' : 'tool'
  const bucket = Array.isArray(claim?.entities?.[key]) ? claim.entities[key] : []
  const entry = bucket.find(Boolean)
  if (!entry) return resourceType || 'resource'
  if (typeof entry === 'string') return entry
  if (entry && typeof entry.id === 'string') return entry.id
  return resourceType || 'resource'
}

function findResourceInsightTarget(worldModel, resourceHints = []) {
  if (!worldModel || typeof worldModel.getLocationInsights !== 'function') return null
  const insights = worldModel.getLocationInsights({ preferredTypes: ['resource', 'interactable'] }) || []
  for (const hint of resourceHints) {
    const match = insights.find(insight => matchesResourceInsight(insight, hint))
    if (!match) continue
    const target = buildResourceTargetFromInsight(match, hint)
    if (target) return target
  }
  return null
}

function matchesResourceInsight(insight, resourceType) {
  if (!insight || !Array.isArray(insight.tags)) return false
  const tags = insight.tags.map(tag => String(tag).toLowerCase())
  if (resourceType === 'key') return tags.includes('key')
  if (resourceType === 'tool') return tags.includes('tool')
  return tags.includes('resource') || tags.includes('tool') || tags.includes('key')
}

function buildResourceTargetFromInsight(insight, resourceType) {
  const position = insight.position || insight.node?.position || extractLocationFromClaim(insight.claim)
  if (!isCoordinate(position)) return null
  return {
    id: insight.nodeId || insight.node?.id || `resource_${resourceType || 'claim'}`,
    position: clonePosition(position),
    claimId: insight.claimId || insight.claim?.id || insight.claim?.memory_id || null,
    description: insight.node?.label || insight.node?.type || `${resourceType || 'resource'} node`,
    expectedItem: resolveResourceNameFromClaim(insight.claim, resourceType),
    resourceType,
    source: 'world_model'
  }
}

function selectDoorTarget(context) {
  const profile = resolveDoorProfile(context)

  const insights = Array.isArray(context.worldModel?.getDoorInsights?.())
    ? context.worldModel.getDoorInsights()
    : []
  const insightMatch = findDoorInsightMatch(insights, profile)
  if (insightMatch) {
    const target = buildDoorTargetFromInsight(insightMatch, profile)
    if (target) return target
  }

  const claimMatch = findDoorClaimMatch(context.claimMemories, profile)
  if (claimMatch) {
    const target = buildDoorTargetFromClaim(claimMatch, profile)
    if (target) return target
  }

  if (profile.position || profile.doorId) {
    return {
      id: profile.doorId || 'goal_door',
      position: clonePosition(profile.position),
      claimId: null,
      description: profile.doorId || 'door',
      codeSequence: null,
      lockType: profile.lockType || null,
      codeSource: 'fresh_solve'
    }
  }

  if (isCoordinate(context.worldState?.doorLocation)) {
    return {
      id: profile.doorId || 'world_door',
      position: clonePosition(context.worldState.doorLocation),
      claimId: null,
      description: 'world door',
      codeSequence: null,
      lockType: profile.lockType || null,
      codeSource: 'fresh_solve'
    }
  }

  return null
}

function selectFinalTarget(context, resourceTarget, doorTarget, needsNavigation) {
  const goal = context.goal || {}
  const locationFromGoal = firstCoordinate(goal.entities?.location)
  if (locationFromGoal) {
    return { position: clonePosition(locationFromGoal), description: 'goal location' }
  }

  const captiveLocation = firstCoordinate(goal.entities?.captive?.map(entry => entry.location))
  if (captiveLocation) {
    return { position: clonePosition(captiveLocation), description: 'captive location' }
  }

  if (isCoordinate(context.worldState?.goalLocation)) {
    return { position: clonePosition(context.worldState.goalLocation), description: 'world goal location' }
  }

  if (needsNavigation && doorTarget && isCoordinate(doorTarget.position)) {
    return { position: clonePosition(doorTarget.position), description: 'door staging area' }
  }

  if (resourceTarget && isCoordinate(resourceTarget.position)) {
    return { position: clonePosition(resourceTarget.position), description: resourceTarget.description }
  }

  return null
}

function selectInteractionTarget(context) {
  const goal = context.goal || {}
  const captive = Array.isArray(goal.entities?.captive) ? goal.entities.captive[0] : null
  if (captive) {
    return {
      description: 'captive',
      claimId: null
    }
  }

  const chest = Array.isArray(goal.entities?.chest) ? goal.entities.chest[0] : null
  if (chest) {
    return {
      description: 'locked chest',
      claimId: null
    }
  }

  if (Array.isArray(goal.entities?.entity) && goal.entities.entity[0]) {
    return {
      description: goal.entities.entity[0].id || 'goal entity',
      claimId: null
    }
  }

  return null
}

function findRelevantHazards(worldModel, targetPosition) {
  if (!worldModel || typeof worldModel.getNodesByType !== 'function') return []
  const hazardNodes = worldModel.getNodesByType('hazard') || []
  return hazardNodes
    .filter(node => isCoordinate(node.position))
    .filter(node => !targetPosition || distance3D(node.position, targetPosition) <= 16)
    .map(node => {
      const hazardNodeId = node.id
      const safePaths = typeof worldModel.getSafePathsForHazard === 'function'
        ? worldModel.getSafePathsForHazard(hazardNodeId)
        : []
      return {
        nodeId: hazardNodeId,
        position: clonePosition(node.position),
        description: node.label || 'hazard',
        claimId: node.metadata?.primaryClaimId || null,
        radius: node.metadata?.radius || 4,
        hazardType: node.metadata?.hazardType || null,
        safePaths: safePaths.map(path => ({
          claimId: path.claimId || null,
          hazardClaimId: path.hazardClaimId || null,
          waypoints: Array.isArray(path.waypoints) ? path.waypoints.map(clonePosition).filter(Boolean) : [],
          entry: clonePosition(path.entry),
          exit: clonePosition(path.exit),
          pathLength: path.pathLength || null
        }))
      }
    })
}

function gatherRouteOptions(worldModel, claims = []) {
  const fromWorldModel = Array.isArray(worldModel?.getMazeRouteOptions?.())
    ? worldModel.getMazeRouteOptions()
    : []
  const routeOptions = fromWorldModel.map(option => ({
    sequence: option.sequence,
    claimId: option.claimId || option.claim?.id || null,
    confidence: option.confidence || 0
  }))

  const claimRoutes = claims
    .map(claim => {
      const sequence = extractTurnSequenceFromClaim(claim)
      if (!Array.isArray(sequence) || sequence.length === 0) return null
      const routeLength = claim.route_metadata?.pathLength ?? Math.max(0, sequence.length - 1)
      const isRouteClaim = typeof claim.type === 'string' && claim.type.toLowerCase().includes('route')
      return {
        sequence,
        claimId: claim.id || claim.memory_id || null,
        confidence: claim.confidence || 0,
        routeLength,
        priority: isRouteClaim ? 1 : 0
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if ((b.priority || 0) !== (a.priority || 0)) {
        return (b.priority || 0) - (a.priority || 0)
      }
      const aLength = Number.isFinite(a.routeLength) ? a.routeLength : Infinity
      const bLength = Number.isFinite(b.routeLength) ? b.routeLength : Infinity
      if (aLength !== bLength) {
        return aLength - bLength
      }
      return (b.confidence || 0) - (a.confidence || 0)
    })

  if (claimRoutes.length > 0) {
    return [...claimRoutes, ...routeOptions]
  }

  return routeOptions
}

function hasAnyTag(tagSet, tags = []) {
  return tags.some(tag => tagSet.has(tag))
}

function hasGoalEntity(goal, name) {
  const entities = goal?.entities || {}
  if (!entities) return false
  const bucket = entities[name]
  if (!bucket) return false
  if (Array.isArray(bucket)) {
    return bucket.length > 0
  }
  return Boolean(bucket)
}

function normalizeStringSet(values) {
  if (!Array.isArray(values)) return new Set()
  return new Set(values.map(value => String(value || '').toLowerCase()))
}

function buildMetadata() {
  return {
    claimReferences: [],
    claimSequences: [],
    preferredLocations: [],
    preferredTurnSequences: [],
    hazardZones: [],
    skipLeverRoom: false,
    skipKeySearch: false,
    doorUnlockPlan: null
  }
}

function findClaimByType(claims = [], keywords = []) {
  const lowered = keywords.map(keyword => String(keyword).toLowerCase())
  return claims.find(claim => {
    const type = String(claim?.type || '').toLowerCase()
    return lowered.some(keyword => type.includes(keyword))
  }) || null
}

function resolveDoorProfile(context = {}) {
  const goal = context.goal || {}
  const goalDoor = (Array.isArray(goal.entities?.door) ? goal.entities.door : []).find(Boolean)
  const doorId = normalizeDoorId(goalDoor?.id) || normalizeDoorId(context.worldState?.doorId) || normalizeDoorId(context.worldState?.door?.id)
  const lockType = normalizeLockType(
    goalDoor?.lockType || goalDoor?.lock_type || goal.lockType || context.worldState?.lockType || context.worldState?.door?.lockType || deriveLockTypeFromWorldState(context.worldState)
  )
  const goalDoorLocation = goalDoor && goalDoor.location ? firstCoordinate(goalDoor.location) : firstCoordinate(goalDoor)
  const position = clonePosition(goalDoorLocation) || clonePosition(context.worldState?.doorLocation) || clonePosition(context.worldState?.door?.location)
  return { doorId, lockType, position }
}

function deriveLockTypeFromWorldState(state) {
  if (!state || typeof state !== 'object') return null
  if (typeof state.lockType === 'string' && state.lockType.trim()) return state.lockType.trim()
  if (typeof state?.door?.lockType === 'string' && state.door.lockType.trim()) return state.door.lockType.trim()
  if (Number.isFinite(state.leverCount)) {
    return `lever_lock_len_${state.leverCount}`
  }
  return null
}

function normalizeDoorId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  return null
}

function normalizeLockType(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  return null
}

function findDoorInsightMatch(insights = [], profile = {}) {
  let best = null
  for (const insight of insights) {
    if (!insight || !insight.node) continue
    const nodeDoorId = normalizeDoorId(insight.node?.metadata?.doorId)
    const nodeLockType = normalizeLockType(insight.node?.metadata?.lockType)
    let matchType = null
    if (profile.doorId && nodeDoorId && profile.doorId === nodeDoorId) {
      matchType = 'door_id_transfer'
    } else if (profile.lockType && nodeLockType && profile.lockType === nodeLockType) {
      matchType = 'lock_type_transfer'
    }
    if (!matchType) continue
    const score = matchType === 'door_id_transfer' ? 2 : 1
    if (!best || score > best.score || (score === best.score && (insight.confidence || 0) > (best.insight?.confidence || 0))) {
      best = { insight, matchType, score }
    }
  }
  return best
}

function findDoorClaimMatch(claims = [], profile = {}) {
  if (!Array.isArray(claims) || claims.length === 0) return null
  const matches = []
  for (const claim of claims) {
    if (!claim) continue
    const sequence = extractSequenceFromClaim(claim)
    if (!Array.isArray(sequence) || sequence.length === 0) continue
    const claimDoorId = normalizeDoorId(extractDoorIdFromClaim(claim))
    const claimLockType = normalizeLockType(extractLockTypeFromClaim(claim))
    let matchType = null
    if (profile.doorId && claimDoorId && profile.doorId === claimDoorId) {
      matchType = 'door_id_transfer'
    } else if (profile.lockType && claimLockType && profile.lockType === claimLockType) {
      matchType = 'lock_type_transfer'
    }
    if (!matchType) continue
    const score = matchType === 'door_id_transfer' ? 2 : 1
    matches.push({ claim, matchType, score })
  }
  if (matches.length === 0) return null
  matches.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return (b.claim.confidence || 0) - (a.claim.confidence || 0)
  })
  return matches[0]
}

function buildDoorTargetFromInsight(match, profile) {
  if (!match || !match.insight) return null
  const { insight } = match
  const claim = insight.claim
  const codeSequence = Array.isArray(insight.codeSequence) && insight.codeSequence.length > 0
    ? insight.codeSequence
    : extractSequenceFromClaim(claim)
  if (!Array.isArray(codeSequence) || codeSequence.length === 0) return null
  const position = clonePosition(insight.node?.position) || clonePosition(profile.position) || clonePosition(extractLocationFromClaim(claim))
  return {
    id: normalizeDoorId(profile.doorId || insight.node?.metadata?.doorId || insight.node?.id) || 'door_claim',
    position,
    claimId: insight.claimId || claim?.id || claim?.memory_id || null,
    description: insight.node?.label || 'door',
    codeSequence,
    lockType: normalizeLockType(profile.lockType || insight.node?.metadata?.lockType || extractLockTypeFromClaim(claim)),
    codeSource: match.matchType,
    codeClaimId: insight.claimId || claim?.id || claim?.memory_id || null
  }
}

function buildDoorTargetFromClaim(match, profile) {
  if (!match || !match.claim) return null
  const { claim } = match
  const codeSequence = extractSequenceFromClaim(claim)
  if (!Array.isArray(codeSequence) || codeSequence.length === 0) return null
  const position = clonePosition(extractLocationFromClaim(claim)) || clonePosition(profile.position)
  return {
    id: normalizeDoorId(profile.doorId || extractDoorIdFromClaim(claim) || claim.id || 'door_claim'),
    position,
    claimId: claim.id || claim.memory_id,
    description: claim.type || 'door claim',
    codeSequence,
    lockType: normalizeLockType(profile.lockType || extractLockTypeFromClaim(claim)),
    codeSource: match.matchType,
    codeClaimId: claim.id || claim.memory_id
  }
}

function firstCoordinate(entries) {
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (isCoordinate(entry)) return clonePosition(entry)
      if (entry && isCoordinate(entry.location)) return clonePosition(entry.location)
    }
  }
  if (isCoordinate(entries)) return clonePosition(entries)
  return null
}

function dedupePositions(positions = []) {
  const seen = new Set()
  const result = []
  positions.forEach(pos => {
    if (!isCoordinate(pos)) return
    const key = `${pos.x}:${pos.y}:${pos.z}`
    if (seen.has(key)) return
    seen.add(key)
    result.push(pos)
  })
  return result
}

function dedupeSequences(sequences = []) {
  const seen = new Set()
  const result = []
  sequences.forEach(seq => {
    if (!Array.isArray(seq) || seq.length === 0) return
    const key = JSON.stringify(seq)
    if (seen.has(key)) return
    seen.add(key)
    result.push(seq)
  })
  return result
}

function clonePosition(pos) {
  if (!isCoordinate(pos)) return null
  return {
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    z: Math.round(pos.z)
  }
}

function cloneBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null
  const result = {}
  const keys = ['minX', 'maxX', 'minZ', 'maxZ', 'y', 'radius']
  keys.forEach(key => {
    if (bounds[key] == null) return
    const value = Number(bounds[key])
    if (Number.isFinite(value)) {
      result[key] = value
    }
  })
  if (bounds.center && isCoordinate(bounds.center)) {
    result.center = clonePosition(bounds.center)
  }
  return Object.keys(result).length > 0 ? result : null
}

function distance3D(a, b) {
  if (!isCoordinate(a) || !isCoordinate(b)) return Infinity
  const dx = (a.x || 0) - (b.x || 0)
  const dy = (a.y || 0) - (b.y || 0)
  const dz = (a.z || 0) - (b.z || 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function selectPreferredSafePath(paths = []) {
  if (!Array.isArray(paths) || paths.length === 0) return null
  const candidates = paths
    .map(path => ({
      ...path,
      waypoints: Array.isArray(path.waypoints) ? path.waypoints.filter(isCoordinate) : []
    }))
    .filter(path => path.waypoints.length > 0)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    const aLength = Number.isFinite(a.pathLength) ? a.pathLength : a.waypoints.length
    const bLength = Number.isFinite(b.pathLength) ? b.pathLength : b.waypoints.length
    return aLength - bLength
  })
  return candidates[0]
}

function makeStep(id, kind, description, claimRef = null, dependsOn = [], skill = null) {
  const step = {
    id,
    kind,
    description,
    claimRef,
    dependsOn
  }
  if (skill) {
    step.skill = skill
  }
  return step
}

function finalizePlan(base, steps, extraMetadata = {}) {
  const orderedSteps = steps.map((step, index) => ({
    order: index + 1,
    ...step
  }))
  return {
    ...base,
    steps: orderedSteps,
    metadata: {
      ...(base.metadata || {}),
      ...extraMetadata
    }
  }
}

function formatLocation(pos) {
  if (!isCoordinate(pos)) return '(unknown location)'
  return `(${pos.x},${pos.y},${pos.z})`
}

function formatBounds(bounds) {
  if (!bounds) return 'the target bounds'
  if (Number.isFinite(bounds.radius) && isCoordinate(bounds.center)) {
    return `radius ${bounds.radius} around ${formatLocation(bounds.center)}`
  }
  const hasRect = Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.minZ) && Number.isFinite(bounds.maxZ)
  const rectText = hasRect ? `[${bounds.minX},${bounds.minZ}] to [${bounds.maxX},${bounds.maxZ}]` : null
  const yText = Number.isFinite(bounds.y) ? `y=${bounds.y}` : null
  return [rectText, yText].filter(Boolean).join(' ') || 'the target bounds'
}

function buildResourceAcquisitionMetadata({ strategy, resourceType, avoidedSearchActions, searchBounds, claimId, estimatedActions }) {
  return {
    strategy,
    resourceType: resourceType || 'resource',
    avoidedSearchActions: Number.isFinite(avoidedSearchActions) ? avoidedSearchActions : 0,
    searchBounds: cloneBounds(searchBounds),
    claimId: claimId || null,
    estimatedActions: Number.isFinite(estimatedActions) ? estimatedActions : null
  }
}

module.exports = {
  createScenarioPlan,
  extractSequenceFromClaim,
  extractTurnSequenceFromClaim
}
