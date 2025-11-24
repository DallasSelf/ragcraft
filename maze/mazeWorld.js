const { goals } = require('mineflayer-pathfinder')

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function trySolveMazeInWorld(bot, plan, mazeConfig, logger) {
  const actions = []
  let stepCount = 0
  const maxSteps = mazeConfig.maxSteps || 100

  logger.log('maze_attempt_start', {
    startPos: mazeConfig.startPos,
    goalPos: mazeConfig.goalPos,
    plan: plan
  })

  const startPos = mazeConfig.startPos
  const currentPos = bot.entity.position
  const startDistance = Math.hypot(
    currentPos.x - startPos.x,
    currentPos.z - startPos.z
  )

  if (startDistance > 2) {
    logger.log('maze_move_to_start', { target: startPos })
    const startGoal = new goals.GoalBlock(startPos.x, startPos.y, startPos.z)
    bot.pathfinder.setGoal(startGoal)
    await wait(1000)
    actions.push({ type: 'move', target: startPos, step: stepCount++ })
  }

  const goalPos = mazeConfig.goalPos
  logger.log('maze_move_to_goal', { target: goalPos })
  
  const goal = new goals.GoalBlock(goalPos.x, goalPos.y, goalPos.z)
  
  return new Promise((resolve) => {
    let finished = false
    let success = false

    function onGoalReached() {
      if (finished) return
      finished = true
      bot.removeListener('goal_reached', onGoalReached)
      bot.removeListener('path_update', onPathUpdate)
      
      success = true
      logger.log('maze_goal_reached', {
        stepCount,
        finalPos: {
          x: bot.entity.position.x,
          y: bot.entity.position.y,
          z: bot.entity.position.z
        }
      })
      
      resolve({ success: true, actions, stepCount })
    }

    function onPathUpdate(r) {
      if (finished) return
      stepCount++
      const currentPos = bot.entity.position
      actions.push({
        type: 'move',
        target: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
        step: stepCount
      })
      
      logger.log('maze_path_update', {
        step: stepCount,
        position: { x: currentPos.x, y: currentPos.y, z: currentPos.z }
      })
    }

    bot.on('goal_reached', onGoalReached)
    bot.on('path_update', onPathUpdate)
    
    bot.pathfinder.setGoal(goal)

    setTimeout(() => {
      if (finished) return
      finished = true
      bot.removeListener('goal_reached', onGoalReached)
      bot.removeListener('path_update', onPathUpdate)
      
      const currentPos = bot.entity.position
      const distanceToGoal = Math.hypot(
        currentPos.x - goalPos.x,
        currentPos.z - goalPos.z
      )
      
      success = distanceToGoal < 2
      
      logger.log('maze_attempt_timeout', {
        stepCount,
        success,
        finalPos: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
        distanceToGoal
      })
      
      resolve({ success, actions, stepCount })
    }, maxSteps * 1000)
  })
}

module.exports = { trySolveMazeInWorld }

