import pkgPathfinder from "mineflayer-pathfinder"
import mcDataLoader from "minecraft-data"
const { Movements, goals } = pkgPathfinder

export function setupNav(bot) {
  const mcData = mcDataLoader(bot.version)
  const move = new Movements(bot, mcData)
  bot.pathfinder.setMovements(move)
}
export function goTo(bot, x, y, z) {
  bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z), true)
}
