
const { goals } = require('mineflayer-pathfinder')

function executeAction(bot, action) {
  if (action.type === 'move_to') {
    const goal = new goals.GoalBlock(action.target.x, action.target.y, action.target.z)

    return new Promise(resolve => {
      let finished = false

      function onGoal() {
        if (finished) return
        finished = true
        bot.removeListener('goal_reached', onGoal)
        resolve({ type: 'goal_reached' })
      }

      bot.on('goal_reached', onGoal)
      bot.pathfinder.setGoal(goal, false)

      setTimeout(() => {
        if (finished) return
        finished = true
        bot.removeListener('goal_reached', onGoal)
        resolve({ type: 'timeout' })
      }, 10000)
    })
  }

  return Promise.resolve({ type: 'noop' })
}

module.exports = { executeAction }
