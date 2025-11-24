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
    logger.log('maze_move_to_start', { target: startPos })
    bot.pathfinder.setGoal(new goals.GoalBlock(startPos.x, startPos.y, startPos.z))
    await wait(1500)
    stepCount += 1
    actions.push({ type: 'move', target: startPos, step: stepCount })
  }

  logger.log('maze_move_to_goal', { target: goalPos })
  const goal = new goals.GoalBlock(goalPos.x, goalPos.y, goalPos.z)

  return new Promise(resolve => {
    let finished = false

    function finish(success, reason) {
      if (finished) return
      finished = true
      bot.pathfinder.removeListener('goal_reached', onGoalReached)
      bot.pathfinder.removeListener('path_update', onPathUpdate)
      bot.pathfinder.removeListener('path_reset', onPathReset)
      bot.pathfinder.removeListener('path_stop', onPathStop)

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

    function onGoalReached() {
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

    bot.pathfinder.on('goal_reached', onGoalReached)
    bot.pathfinder.on('path_update', onPathUpdate)
    bot.pathfinder.on('path_reset', onPathReset)
    bot.pathfinder.on('path_stop', onPathStop)

    bot.pathfinder.setGoal(goal)

    setTimeout(() => {
      if (finished) return
      finish(false, 'timeout')
    }, maxSeconds * 1000)
  })
}

module.exports = { trySolveMazeInWorld }
