const mcDataLoader = require('minecraft-data')
const { goals, Movements } = require('mineflayer-pathfinder')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ensureMovements(bot) {
  const mcData = mcDataLoader(bot.version)
  const movements = new Movements(bot, mcData)
  movements.allow1by1towers = false
  movements.canDig = false
  movements.scafoldingBlocks = []
  bot.pathfinder.setMovements(movements)
}

async function trySolveMazeInWorld(bot, plan, mazeConfig, logger) {
  await ensureMovements(bot)

  const actions = []
  let stepCount = 0
  const maxSeconds = mazeConfig.maxSteps || 120

  logger.log('maze_attempt_start', {
    startPos: mazeConfig.startPos,
    goalPos: mazeConfig.goalPos,
    plan
  })

  const startPos = mazeConfig.startPos
  const goalPos = mazeConfig.goalPos

  const currentPos = bot.entity.position
  const startDistance = Math.hypot(currentPos.x - startPos.x, currentPos.z - startPos.z)

  if (startDistance > 2) {
    logger.log('maze_move_to_start', { target: startPos, currentDistance: startDistance })
    const startGoal = new goals.GoalBlock(startPos.x, startPos.y, startPos.z)
    
    
    await new Promise((resolve) => {
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          logger.log('maze_move_to_start_timeout', { target: startPos })
          resolve()
        }
      }, 10000) // 10 second timeout to reach start
      
      function onStartGoalReached() {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        bot.removeListener('goal_reached', onStartGoalReached)
        logger.log('maze_start_reached')
        resolve()
      }
      
      bot.on('goal_reached', onStartGoalReached)
      bot.pathfinder.setGoal(startGoal)
    })
    
    stepCount += 1
    actions.push({ type: 'move', target: startPos, step: stepCount })
    await wait(500) // Brief pause before starting maze navigation
  }

  logger.log('maze_move_to_goal', { target: goalPos })
  const goal = new goals.GoalBlock(goalPos.x, goalPos.y, goalPos.z)

  return new Promise(resolve => {
    let finished = false
    let positionCheckInterval = null
    let lastPositionCheck = Date.now()
    let lastPosition = null

    function finish(success, reason) {
      if (finished) return
      finished = true
      
      // Clean up event listeners
      bot.removeListener('goal_reached', onGoalReached)
      bot.removeListener('path_update', onPathUpdate)
      bot.removeListener('path_reset', onPathReset)
      bot.removeListener('path_stop', onPathStop)
      
      // Clear position check interval
      if (positionCheckInterval) {
        clearInterval(positionCheckInterval)
        positionCheckInterval = null
      }

      const pos = bot.entity.position
      const distanceToGoal = Math.hypot(pos.x - goalPos.x, pos.z - goalPos.z)

      logger.log('maze_attempt_end', {
        success,
        reason,
        stepCount,
        finalPos: { x: pos.x, y: pos.y, z: pos.z },
        distanceToGoal
      })

      resolve({ success, actions, stepCount, reason })
    }

    function checkPosition() {
      if (finished) return
      
      const pos = bot.entity.position
      const distanceToGoal = Math.hypot(pos.x - goalPos.x, pos.z - goalPos.z)
      
      // Check if we're close enough to the goal
      if (distanceToGoal < 2) {
        logger.log('maze_position_check_goal_reached', { 
          stepCount, 
          distanceToGoal,
          position: { x: pos.x, y: pos.y, z: pos.z }
        })
        finish(true, 'position_check_goal_reached')
        return
      }
      
      // Check if we're stuck (not moving)
      if (lastPosition) {
        const distanceMoved = Math.hypot(
          pos.x - lastPosition.x,
          pos.z - lastPosition.z
        )
        const timeSinceLastCheck = Date.now() - lastPositionCheck
        
        // If we haven't moved much in 5 seconds, we might be stuck
        if (distanceMoved < 0.5 && timeSinceLastCheck > 5000) {
          logger.log('maze_position_check_stuck', {
            stepCount,
            distanceToGoal,
            distanceMoved,
            timeSinceLastCheck
          })
          finish(false, 'stuck')
          return
        }
      }
      
      lastPosition = { x: pos.x, y: pos.y, z: pos.z }
      lastPositionCheck = Date.now()
    }

    function onGoalReached() {
      if (finished) return
      actions.push({
        type: 'move',
        target: { x: goalPos.x, y: goalPos.y, z: goalPos.z },
        step: stepCount
      })
      logger.log('maze_goal_reached', { stepCount })
      finish(true, 'goal_reached')
    }

    function onPathUpdate(r) {
      if (finished) return
      stepCount += 1
      const pos = bot.entity.position
      actions.push({
        type: 'move',
        target: { x: pos.x, y: pos.y, z: pos.z },
        step: stepCount
      })
      logger.log('maze_path_update', {
        step: stepCount,
        status: r.status,
        nodes: r.path ? r.path.length : 0,
        position: { x: pos.x, y: pos.y, z: pos.z }
      })
    }

    function onPathReset(reason) {
      if (finished) return
      logger.log('maze_path_reset', { reason })
      finish(false, 'path_reset')
    }

    function onPathStop() {
      if (finished) return
      const pos = bot.entity.position
      const distanceToGoal = Math.hypot(pos.x - goalPos.x, pos.z - goalPos.z)
      const success = distanceToGoal < 2
      logger.log('maze_path_stop', { stepCount, success, distanceToGoal })
      finish(success, 'path_stop')
    }

    // Set up event listeners
    bot.on('goal_reached', onGoalReached)
    bot.on('path_update', onPathUpdate)
    bot.on('path_reset', onPathReset)
    bot.on('path_stop', onPathStop)

    // Set up periodic position checking (every 1 second)
    positionCheckInterval = setInterval(() => {
      checkPosition()
    }, 1000)

    // Set the goal
    bot.pathfinder.setGoal(goal)

    // Timeout fallback (convert maxSteps seconds to milliseconds)
    const timeoutMs = maxSeconds * 1000
    setTimeout(() => {
      if (finished) return
      logger.log('maze_timeout', { timeoutMs, stepCount })
      finish(false, 'timeout')
    }, timeoutMs)
  })
}

module.exports = { trySolveMazeInWorld }
