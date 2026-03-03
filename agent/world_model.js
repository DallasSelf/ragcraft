const {
  extractLocationFromClaim,
  extractSequenceFromClaim,
  extractTurnSequenceFromClaim,
  extractDoorIdFromClaim,
  extractLockTypeFromClaim
} = require('./planning/claimParsing')

const DEFAULT_NEAR_DISTANCE = 6

class WorldModel {
  constructor() {
    this.nodes = new Map()
    this.edges = []
    this.edgeIndex = new Map()
    this.claimIds = new Set()
    this.claimLookup = new Map()
    this.claimCounter = 0
    this.safePathIndex = new Map()
  }

  rebuildFromClaims(claims = []) {
    this.nodes.clear()
    this.edges = []
    this.edgeIndex.clear()
    this.claimIds.clear()
    this.claimLookup.clear()
    this.claimCounter = 0
    this.safePathIndex.clear()
    this.ingestClaims(claims)
  }

  ingestClaims(claims = []) {
    if (!Array.isArray(claims)) return
    for (const claim of claims) {
      this._ingestClaim(claim)
    }
  }

  ingestClaim(claim) {
    this._ingestClaim(claim)
  }

  getSafePathsForHazard(hazardNodeId) {
    if (!hazardNodeId) return []
    return this.safePathIndex.get(hazardNodeId) || []
  }

  getDoorInsights() {
    return Array.from(this.nodes.values())
      .filter(node => node.type === 'interactable' && (node.tags.has('door') || node.metadata.doorId))
      .map(node => {
        const claimId = node.metadata.primaryClaimId || firstItem(node.claimIds)
        return {
          node,
          claimId,
          claim: this.claimLookup.get(claimId),
          codeSequence: node.metadata.codeSequence || null,
          confidence: node.confidence || 0
        }
      })
      .sort(compareByConfidence)
  }

  getLocationInsights(options = {}) {
    const allowedTypes = Array.isArray(options.preferredTypes) && options.preferredTypes.length > 0
      ? new Set(options.preferredTypes)
      : null

    return Array.from(this.nodes.values())
      .filter(node => node.position)
      .filter(node => !allowedTypes || allowedTypes.has(node.type))
      .map(node => {
        const claimId = node.metadata.primaryClaimId || firstItem(node.claimIds)
        return {
          nodeId: node.id,
          type: node.type,
          position: node.position,
          tags: Array.from(node.tags),
          claimId,
          claim: this.claimLookup.get(claimId),
          confidence: node.confidence || 0
        }
      })
      .sort(compareByConfidence)
  }

  getMazeRouteOptions() {
    return this.edges
      .filter(edge => edge.type === 'path' && Array.isArray(edge.metadata.turnSequence) && edge.metadata.turnSequence.length > 0)
      .map(edge => {
        const claimId = edge.metadata.claimId || firstItem(edge.claimIds)
        return {
          edgeId: edge.id,
          sequence: edge.metadata.turnSequence,
          claimId,
          claim: this.claimLookup.get(claimId),
          confidence: edge.confidence || 0
        }
      })
      .sort(compareByConfidence)
  }

  getNodesByType(type) {
    return Array.from(this.nodes.values()).filter(node => node.type === type)
  }

  getClaim(claimId) {
    return this.claimLookup.get(claimId) || null
  }

  _ingestClaim(claim) {
    if (!claim || typeof claim !== 'object') return
    const claimId = this._registerClaim(claim)
    if (!claimId) return

    const normalizedType = typeof claim.type === 'string' ? claim.type.toLowerCase() : ''

    switch (normalizedType) {
      case 'door_code_claim':
        this._ingestDoorCodeClaim(claim, claimId)
        break
      case 'landmarkclaim':
        this._ingestSpatialClaim('landmark', claim, claimId, { tags: ['landmark'] })
        break
      case 'interactableclaim':
        this._ingestSpatialClaim('interactable', claim, claimId, { tags: ['interactable'] })
        break
      case 'toollocationclaim':
        this._ingestSpatialClaim('resource', claim, claimId, { tags: ['tool', 'resource'] })
        break
      case 'keylocationclaim':
        this._ingestSpatialClaim('resource', claim, claimId, { tags: ['key', 'resource'] })
        break
      case 'doorlocationclaim':
        this._ingestSpatialClaim('interactable', claim, claimId, { tags: ['door'] })
        break
      case 'hazardzoneclaim':
        this._ingestSpatialClaim('hazard', claim, claimId, {
          tags: ['hazard'],
          metadata: {
            hazardType: claim.metadata?.hazard || claim.metadata?.hazardType || null,
            radius: claim.metadata?.radius || null
          }
        })
        break
      case 'safepathclaim':
        this._ingestSafePathClaim(claim, claimId)
        break
      case 'routeclaim':
        this._ingestRouteClaim(claim, claimId)
        break
      default:
        this._ingestGenericClaim(claim, claimId)
        break
    }
  }

  _ingestDoorCodeClaim(claim, claimId) {
    const doorLocation = normalizePosition(claim.door_location || claim.entities?.door?.[0]?.location)
    const doorId = extractDoorIdFromClaim(claim) || (doorLocation ? `door:${locationKey(doorLocation)}` : `door:${claimId}`)
    const codeSequence = extractSequenceFromClaim(claim)
    const lockType = extractLockTypeFromClaim(claim)

    const doorNode = this._upsertNode({
      id: doorId,
      type: 'interactable',
      label: doorId,
      position: doorLocation,
      tags: ['door', 'interactable'],
      goalTags: claim.goal_tags || [],
      metadata: {
        doorId,
        primaryClaimId: claimId,
        codeSequence,
        lockType: lockType || null
      },
      confidence: claim.confidence || 0.5,
      claimId
    })

    if (Array.isArray(codeSequence) && codeSequence.length > 0) {
      const codeNode = this._upsertNode({
        id: `${doorNode.id}:code`,
        type: 'resource',
        label: `lever_code_${codeSequence.join('-')}`,
        position: null,
        tags: ['code', 'resource'],
        goalTags: ['lever_code'],
        metadata: {
          sequence: codeSequence,
          primaryClaimId: claimId
        },
        confidence: claim.confidence || 0.5,
        claimId
      })

      this._addEdge({
        type: 'requires',
        from: doorNode.id,
        to: codeNode.id,
        metadata: {
          requirement: 'lever_code',
          sequenceLength: codeSequence.length,
          claimId
        },
        confidence: claim.confidence || 0.5,
        claimId
      })

      this._addEdge({
        type: 'unlocks',
        from: codeNode.id,
        to: doorNode.id,
        metadata: {
          effect: 'door_unlock',
          claimId
        },
        confidence: claim.confidence || 0.5,
        claimId
      })
    }
  }

  _ingestRouteClaim(claim, claimId) {
    const start = normalizePosition(claim.metadata?.start || extractLocationFromClaim(claim))
    const end = normalizePosition(claim.metadata?.end)
    if (!start || !end) return

    const startNode = this._upsertNode({
      id: `waypoint:${locationKey(start)}`,
      type: 'landmark',
      label: 'waypoint_start',
      position: start,
      tags: ['waypoint', 'landmark'],
      goalTags: claim.goal_tags || [],
      metadata: { primaryClaimId: claimId },
      confidence: claim.confidence || 0.5,
      claimId
    })

    const endNode = this._upsertNode({
      id: `waypoint:${locationKey(end)}`,
      type: 'landmark',
      label: 'waypoint_end',
      position: end,
      tags: ['waypoint', 'landmark'],
      goalTags: claim.goal_tags || [],
      metadata: { primaryClaimId: claimId },
      confidence: claim.confidence || 0.5,
      claimId
    })

    this._addEdge({
      type: 'path',
      from: startNode.id,
      to: endNode.id,
      metadata: {
        distance: distance2D(start, end),
        stepIndex: claim.metadata?.stepIndex,
        claimId
      },
      confidence: claim.confidence || 0.5,
      claimId
    })
  }

  _ingestSafePathClaim(claim, claimId) {
    const waypoints = normalizeWaypointList(claim.metadata?.waypoints || claim.waypoints)
    if (!Array.isArray(waypoints) || waypoints.length < 2) return

    const start = waypoints[0]
    const end = waypoints[waypoints.length - 1]
    const hazardCenter = normalizePosition(claim.metadata?.hazardCenter)
    const hazardClaimId = claim.metadata?.hazardClaimId || null
    const hazardNodeId = hazardCenter ? `hazard:${locationKey(hazardCenter)}` : null
    const hazardType = claim.metadata?.hazardType || claim.metadata?.hazard || null
    const radius = claim.metadata?.radius || null
    const pathLength = Number.isFinite(claim.metadata?.pathLength)
      ? claim.metadata.pathLength
      : computePolylineLength(waypoints)

    const entryNode = this._upsertNode({
      id: `safe_path_entry:${locationKey(start)}`,
      type: 'landmark',
      label: 'safe_path_entry',
      position: start,
      tags: ['safe_path', 'entry', 'landmark'],
      goalTags: claim.goal_tags || [],
      metadata: { primaryClaimId: claimId },
      confidence: claim.confidence || 0.5,
      claimId
    })

    const exitNode = this._upsertNode({
      id: `safe_path_exit:${locationKey(end)}`,
      type: 'landmark',
      label: 'safe_path_exit',
      position: end,
      tags: ['safe_path', 'exit', 'landmark'],
      goalTags: claim.goal_tags || [],
      metadata: { primaryClaimId: claimId },
      confidence: claim.confidence || 0.5,
      claimId
    })

    this._addEdge({
      type: 'safe_path',
      from: entryNode.id,
      to: exitNode.id,
      metadata: {
        waypoints,
        hazardCenter,
        hazardClaimId,
        hazardType,
        radius,
        pathLength,
        claimId
      },
      confidence: claim.confidence || 0.5,
      claimId
    })

    if (hazardNodeId) {
      const bucket = this.safePathIndex.get(hazardNodeId) || []
      bucket.push({
        claimId,
        hazardClaimId,
        hazardNodeId,
        hazardType,
        waypoints,
        entry: start,
        exit: end,
        radius,
        pathLength
      })
      this.safePathIndex.set(hazardNodeId, bucket)
    }
  }

  _ingestGenericClaim(claim, claimId) {
    const inferredType = inferCategoryFromClaim(claim)
    this._ingestSpatialClaim(inferredType, claim, claimId)

    const turnSequence = extractTurnSequenceFromClaim(claim)
    if (Array.isArray(turnSequence) && turnSequence.length > 0) {
      const scenarioBase = claim.task_id || claim.scenarioId || 'scenario'
      const startNode = this._upsertNode({
        id: `${scenarioBase}:start`,
        type: 'landmark',
        label: `${scenarioBase}_start`,
        position: null,
        tags: ['route', 'start'],
        metadata: { primaryClaimId: claimId },
        confidence: claim.confidence || 0.5,
        claimId
      })

      const endNode = this._upsertNode({
        id: `${scenarioBase}:goal`,
        type: 'landmark',
        label: `${scenarioBase}_goal`,
        position: null,
        tags: ['route', 'goal'],
        metadata: { primaryClaimId: claimId },
        confidence: claim.confidence || 0.5,
        claimId
      })

      this._addEdge({
        type: 'path',
        from: startNode.id,
        to: endNode.id,
        metadata: {
          turnSequence,
          claimId
        },
        confidence: claim.confidence || 0.5,
        claimId
      })
    }
  }

  _ingestSpatialClaim(nodeType, claim, claimId, options = {}) {
    const location = normalizePosition(extractLocationFromClaim(claim))
    if (!location) return

    this._upsertNode({
      id: `${nodeType}:${locationKey(location)}`,
      type: nodeType,
      label: options.label || `${nodeType}_${location.x}_${location.z}`,
      position: location,
      tags: options.tags || [],
      goalTags: claim.goal_tags || [],
      metadata: { primaryClaimId: claimId, ...(options.metadata || {}) },
      confidence: claim.confidence || 0.5,
      claimId
    })
  }

  _upsertNode({ id, type, label, position, tags = [], goalTags = [], metadata = {}, confidence = 0, claimId }) {
    if (!id || !type) return null
    const existing = this.nodes.get(id)
    if (existing) {
      existing.confidence = Math.max(existing.confidence || 0, confidence || 0)
      if (position && !existing.position) {
        existing.position = position
      }
      for (const tag of tags) existing.tags.add(tag)
      for (const tag of goalTags) existing.goalTags.add(tag)
      existing.metadata = { ...existing.metadata, ...metadata }
      if (claimId) existing.claimIds.add(claimId)
      this._linkNearbyNodes(existing)
      return existing
    }

    const node = {
      id,
      type,
      label: label || id,
      position: position || null,
      tags: new Set(Array.isArray(tags) ? tags : Array.from(tags)),
      goalTags: new Set(goalTags || []),
      metadata: { ...metadata },
      confidence: confidence || 0,
      claimIds: new Set(claimId ? [claimId] : [])
    }
    this.nodes.set(id, node)
    this._linkNearbyNodes(node)
    return node
  }

  _addEdge({ type, from, to, metadata = {}, confidence = 0, claimId }) {
    if (!type || !from || !to) return null
    const edgeKey = `${type}:${from}->${to}`
    const existing = this.edgeIndex.get(edgeKey)
    if (existing) {
      existing.confidence = Math.max(existing.confidence || 0, confidence || 0)
      existing.metadata = { ...existing.metadata, ...metadata }
      if (claimId) existing.claimIds.add(claimId)
      return existing
    }

    const edge = {
      id: edgeKey,
      type,
      from,
      to,
      metadata: { ...metadata },
      confidence: confidence || 0,
      claimIds: new Set(claimId ? [claimId] : [])
    }
    this.edgeIndex.set(edgeKey, edge)
    this.edges.push(edge)
    return edge
  }

  _linkNearbyNodes(node) {
    if (!node.position) return
    for (const other of this.nodes.values()) {
      if (other.id === node.id || !other.position) continue
      const distance = distance3D(node.position, other.position)
      if (distance <= DEFAULT_NEAR_DISTANCE) {
        this._addEdge({
          type: 'near',
          from: node.id,
          to: other.id,
          metadata: { distance },
          confidence: Math.min(node.confidence || 0, other.confidence || 0)
        })
        this._addEdge({
          type: 'near',
          from: other.id,
          to: node.id,
          metadata: { distance },
          confidence: Math.min(node.confidence || 0, other.confidence || 0)
        })
      }
    }
  }

  _registerClaim(claim) {
    const rawId = claim?.id || claim?.memory_id || claim?.memoryId || claim?.memoryID || claim?.claim_id || claim?.guid || claim?.uuid
    const claimId = rawId || `anon_claim_${++this.claimCounter}`
    if (this.claimIds.has(claimId)) return null
    this.claimIds.add(claimId)
    this.claimLookup.set(claimId, claim)
    return claimId
  }
}

function createWorldModel(initialClaims = []) {
  const model = new WorldModel()
  if (Array.isArray(initialClaims) && initialClaims.length > 0) {
    model.rebuildFromClaims(initialClaims)
  }
  return model
}

function inferCategoryFromClaim(claim) {
  const type = typeof claim.type === 'string' ? claim.type.toLowerCase() : ''
  if (type.includes('hazard')) return 'hazard'
  if (type.includes('door')) return 'interactable'
  if (type.includes('tool')) return 'resource'
  if (type.includes('interact')) return 'interactable'
  if (type.includes('route')) return 'landmark'
  return 'landmark'
}

function normalizePosition(pos) {
  if (!pos || typeof pos !== 'object') return null
  const x = Number(pos.x)
  const y = Number(pos.y)
  const z = Number(pos.z)
  if ([x, y, z].some(value => !Number.isFinite(value))) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z)
  }
}

function normalizeWaypointList(raw = []) {
  if (!Array.isArray(raw)) return []
  return raw.map(entry => normalizePosition(entry)).filter(Boolean)
}

function locationKey(pos) {
  return `${pos.x}:${pos.y}:${pos.z}`
}

function distance2D(a, b) {
  if (!a || !b) return 0
  const dx = (a.x || 0) - (b.x || 0)
  const dz = (a.z || 0) - (b.z || 0)
  return Math.sqrt(dx * dx + dz * dz)
}

function distance3D(a, b) {
  if (!a || !b) return 0
  const dx = (a.x || 0) - (b.x || 0)
  const dy = (a.y || 0) - (b.y || 0)
  const dz = (a.z || 0) - (b.z || 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function compareByConfidence(a, b) {
  return (b?.confidence || 0) - (a?.confidence || 0)
}

function computePolylineLength(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += distance2D(points[i - 1], points[i])
  }
  return Number(total.toFixed(2))
}

function firstItem(iterable) {
  if (!iterable) return null
  if (Array.isArray(iterable)) return iterable[0] || null
  if (iterable instanceof Set) {
    for (const entry of iterable.values()) {
      return entry
    }
    return null
  }
  return null
}

module.exports = {
  WorldModel,
  createWorldModel
}
