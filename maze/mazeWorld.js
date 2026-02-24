const mcDataLoader = require('minecraft-data')
const { goals, Movements } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ensureMovements(bot) {
  const mcData = mcDataLoader(bot.version)
  const movements = new Movements(bot, mcData)
  movements.allow1by1towers = false
  movements.canDig = false
  movements.canOpenDoors = false
  movements.allowParkour = false
  movements.maxDropDown = 0
  movements.maxStepHeight = 1
  movements.scafoldingBlocks = []
  bot.pathfinder.setMovements(movements)
}

function triggerExitBlock(bot, logger, mazeConfig) {
  const block = mazeConfig.exitTriggerBlock
  if (!block) return Promise.resolve()

  const material = block.material || 'redstone_block'
  const cmd = `/setblock ${block.x} ${block.y} ${block.z} ${material}`
  bot.chat(cmd)
  logger.log('maze_exit_trigger', { cmd })
  return wait(100)
}

function snapToGrid(pos) {
  if (!pos) return null
  return {
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    z: Math.round(pos.z)
  }
}

function cellKey(pos) {
  if (!pos) return '0,0,0'
  return `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`
}

function distance2D(a, b) {
  if (!a || !b) return Infinity
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function isWithinBounds(pos, bounds) {
  if (!bounds || !pos) return true
  return (
    pos.x >= bounds.minX && pos.x <= bounds.maxX &&
    pos.z >= bounds.minZ && pos.z <= bounds.maxZ
  )
}

function normalizeWaypoint(point, enforcedY) {
  if (!point) return null
  const x = Math.round(Number(point.x ?? point[0]))
  const z = Math.round(Number(point.z ?? point[2]))
  if (Number.isNaN(x) || Number.isNaN(z)) return null
  const yValue = typeof enforcedY === 'number'
    ? enforcedY
    : Math.round(Number(point.y ?? point[1] ?? 64))
  return { x, y: yValue, z }
}

function normalizeTurnSequence(sequence, enforcedY) {
  if (!Array.isArray(sequence)) return []
  return sequence
    .map(point => normalizeWaypoint(point, enforcedY))
    .filter(Boolean)
}

function isBlockSolid(block) {
  if (!block) return false
  return block.boundingBox === 'block'
}

function isSpaceEmpty(block) {
  if (!block) return true
  return block.boundingBox === 'empty'
}

function isWalkableCell(bot, x, y, z) {
  const here = bot.blockAt(new Vec3(x, y, z))
  const below = bot.blockAt(new Vec3(x, y - 1, z))
  const above = bot.blockAt(new Vec3(x, y + 1, z))
  return isSpaceEmpty(here) && isSpaceEmpty(above) && isBlockSolid(below)
}

function getNeighborCells(cell, enforcedY) {
  const y = typeof enforcedY === 'number' ? enforcedY : cell.y
  return [
    { x: cell.x + 1, y, z: cell.z },
    { x: cell.x - 1, y, z: cell.z },
    { x: cell.x, y, z: cell.z + 1 },
    { x: cell.x, y, z: cell.z - 1 }
  ]
}

function chooseNeighbor(candidates, goalPos) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const scored = candidates.map(cell => ({
    cell,
    score: distance2D(cell, goalPos) + Math.random() * 0.25
  }))
  scored.sort((a, b) => a.score - b.score)
  return scored[0].cell
}

function buildInitialStack(sequence, fallback) {
  const stack = []
  for (const point of sequence || []) {
    if (!point) continue
    const key = cellKey(point)
    const last = stack[stack.length - 1]
    if (!last || cellKey(last) !== key) {
      stack.push(point)
    }
  }
  if (stack.length === 0 && fallback) {
    stack.push(fallback)
  }
  return stack
}

function createRunState(bot, mazeConfig) {
  const enforcedY = typeof mazeConfig.enforcedY === 'number'
    ? mazeConfig.enforcedY
    : Math.round((mazeConfig.startPos && mazeConfig.startPos.y) || bot.entity.position.y)

  const currentCell = snapToGrid({ ...bot.entity.position, y: enforcedY })
  return {
    startPos: snapToGrid(mazeConfig.startPos || currentCell),
    goalPos: snapToGrid(mazeConfig.goalPos || currentCell),
    bounds: mazeConfig.bounds || null,
    enforcedY,
    maxSteps: mazeConfig.maxSteps || 120,
    moveTimeoutMs: mazeConfig.moveTimeoutMs || 10000,
    stepCount: 0,
    actions: [],
    turnSequence: [currentCell],
    currentCell,
    recordStep(target) {
      if (!target) return
      if (this.stepCount >= this.maxSteps) {
        throw new Error('step_limit')
      }
      const snapped = snapToGrid(target)
      snapped.y = this.enforcedY
      if (!isWithinBounds(snapped, this.bounds)) {
        throw new Error('out_of_bounds')
      }
      this.stepCount += 1
      this.actions.push({ type: 'move', target: snapped, step: this.stepCount })
      this.turnSequence.push(snapped)
      this.currentCell = snapped
    }
  }
}

function hasReachedGoal(cell, goalPos) {
  return distance2D(cell, goalPos) < 1.2
}

async function moveToCell(bot, target, logger, timeoutMs = 8000) {
  if (!target) return { success: false, reason: 'invalid_target' }
  return new Promise(resolve => {
    let finished = false
    const goal = new goals.GoalBlock(target.x, target.y, target.z)
    const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs)

    function cleanup(result) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      bot.removeListener('goal_reached', onGoal)
      bot.removeListener('path_reset', onReset)
      bot.removeListener('path_stop', onStop)
      resolve(result)
    }

    function finish(success, reason) {
      cleanup({ success, reason })
    }

    function onGoal() {
      finish(true, 'goal_reached')
    }

    function onReset(reason) {
      finish(false, reason || 'path_reset')
    }

    function onStop() {
      const pos = bot.entity.position
      const dist = Math.hypot(pos.x - target.x, pos.z - target.z)
      finish(dist < 1.2, 'path_stop')
    }

    bot.on('goal_reached', onGoal)
    bot.on('path_reset', onReset)
    bot.on('path_stop', onStop)
    bot.pathfinder.setGoal(goal)
  })
}

async function moveToStart(bot, state, logger) {
  const start = { ...state.startPos, y: state.enforcedY }
  const distance = distance2D(state.currentCell, start)
  if (distance <= 1.5) {
    state.currentCell = start
    state.turnSequence[0] = start
    return true
  }

  logger.log('maze_move_to_start', { target: start, distance })
  const result = await moveToCell(bot, start, logger, state.moveTimeoutMs)
  if (!result.success) {
    logger.log('maze_move_to_start_fail', { reason: result.reason })
    return false
  }

  try {
    state.recordStep(start)
  } catch (error) {
    logger.log('maze_move_to_start_constraint', { reason: error.message })
    return false
  }

  await wait(250)
  return true
}

async function followTurnPlan(bot, logger, planSequence, state) {
  if (!Array.isArray(planSequence) || planSequence.length === 0) {
    return { completed: false }
  }

  logger.log('maze_plan_follow_start', { waypoints: planSequence.length })
  for (const waypoint of planSequence) {
    if (!isWithinBounds(waypoint, state.bounds)) {
      logger.log('maze_plan_waypoint_oob', { waypoint })
      continue
    }

    const move = await moveToCell(bot, waypoint, logger, state.moveTimeoutMs)
    if (!move.success) {
      logger.log('maze_plan_waypoint_fail', { waypoint, reason: move.reason })
      return { completed: false, reason: move.reason }
    }

    try {
      state.recordStep(waypoint)
    } catch (error) {
      logger.log('maze_plan_constraint', { reason: error.message })
      return { completed: false, reason: error.message }
    }

    if (hasReachedGoal(state.currentCell, state.goalPos)) {
      logger.log('maze_plan_goal_reached')
      return { completed: true }
    }
  }

  return { completed: false }
}

async function exploreMaze(bot, logger, state) {
  const stack = buildInitialStack(state.turnSequence, state.currentCell)
  const visited = new Set(stack.map(cellKey))
  const blocked = new Set()

  logger.log('maze_explore_start', {
    stackDepth: stack.length,
    visitedCount: visited.size
  })

  while (state.stepCount < state.maxSteps && stack.length > 0) {
    const current = stack[stack.length - 1]

    if (hasReachedGoal(current, state.goalPos)) {
      logger.log('maze_explore_goal_reached', { steps: state.stepCount })
      return { success: true, reason: 'goal' }
    }

    const neighbors = getNeighborCells(current, state.enforcedY)
      .filter(cell => isWithinBounds(cell, state.bounds))
      .filter(cell => !blocked.has(cellKey(cell)))
      .filter(cell => isWalkableCell(bot, cell.x, cell.y, cell.z))

    const unvisited = neighbors.filter(cell => !visited.has(cellKey(cell)))

    let target = null
    let exploringForward = false

    if (unvisited.length > 0) {
      target = chooseNeighbor(unvisited, state.goalPos)
      exploringForward = true
    } else if (stack.length > 1) {
      stack.pop()
      target = stack[stack.length - 1]
    }

    if (!target) {
      logger.log('maze_explore_dead_end', { stackDepth: stack.length })
      break
    }

    const move = await moveToCell(bot, target, logger, state.moveTimeoutMs)
    if (!move.success) {
      logger.log('maze_explore_move_failed', { target, reason: move.reason })
      blocked.add(cellKey(target))
      if (!exploringForward && stack.length <= 1) {
        break
      }
      continue
    }

    try {
      state.recordStep(target)
    } catch (error) {
      logger.log('maze_constraint_violation', { reason: error.message, target })
      return { success: false, reason: error.message }
    }

    if (exploringForward) {
      visited.add(cellKey(target))
      stack.push(target)
    }

    if (hasReachedGoal(state.currentCell, state.goalPos)) {
      logger.log('maze_explore_goal_reached', { steps: state.stepCount })
      return { success: true, reason: 'goal' }
    }
  }

  const reason = state.stepCount >= state.maxSteps ? 'step_limit' : 'no_moves'
  logger.log('maze_explore_end', { reason, steps: state.stepCount })
  return { success: false, reason }
}

async function trySolveMazeInWorld(bot, plan, mazeConfig, logger) {
  await ensureMovements(bot)

  if (typeof bot.waitForChunksToLoad === 'function') {
    try {
      await bot.waitForChunksToLoad()
    } catch (err) {
      logger.log('maze_chunk_wait_failed', { message: err.message })
    }
  }

  logger.log('maze_attempt_start', {
    startPos: mazeConfig.startPos,
    goalPos: mazeConfig.goalPos,
    plan
  })

  const state = createRunState(bot, mazeConfig)

  const movedToStart = await moveToStart(bot, state, logger)
  if (!movedToStart) {
    return {
      success: false,
      actions: state.actions,
      stepCount: state.stepCount,
      turnSequence: state.turnSequence,
      reason: 'start_unreachable'
    }
  }

  const planSequence = normalizeTurnSequence(plan.turnSequence, state.enforcedY)
  const planResult = await followTurnPlan(bot, logger, planSequence, state)
  if (planResult.completed) {
    await triggerExitBlock(bot, logger, mazeConfig).catch(err => {
      logger.log('maze_exit_trigger_error', { message: err.message })
    })

    logger.log('maze_attempt_end', {
      success: true,
      reason: 'plan_completion',
      stepCount: state.stepCount,
      finalPos: state.currentCell,
      distanceToGoal: distance2D(state.currentCell, state.goalPos)
    })

    return {
      success: true,
      actions: state.actions,
      stepCount: state.stepCount,
      turnSequence: state.turnSequence,
      reason: 'plan_completion'
    }
  }

  const exploreResult = await exploreMaze(bot, logger, state)

  if (exploreResult.success) {
    await triggerExitBlock(bot, logger, mazeConfig).catch(err => {
      logger.log('maze_exit_trigger_error', { message: err.message })
    })
  }

  logger.log('maze_attempt_end', {
    success: exploreResult.success,
    reason: exploreResult.reason,
    stepCount: state.stepCount,
    finalPos: state.currentCell,
    distanceToGoal: distance2D(state.currentCell, state.goalPos)
  })

  return {
    success: exploreResult.success,
    actions: state.actions,
    stepCount: state.stepCount,
    turnSequence: state.turnSequence,
    reason: exploreResult.reason
  }
}

module.exports = { trySolveMazeInWorld }
