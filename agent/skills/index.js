const navigateToLandmark = require('./navigateToLandmark')
const unlockDoorWithCode = require('./unlockDoorWithCode')
const retrieveFromChest = require('./retrieveFromChest')
const solveLeverPanel = require('./solveLeverPanel')
const traverseSafeRoute = require('./traverseSafeRoute')
const avoidHazardZone = require('./avoidHazardZone')
const exploreBoundedRegion = require('./exploreBoundedRegion')

const skillList = [
  navigateToLandmark,
  unlockDoorWithCode,
  retrieveFromChest,
  solveLeverPanel,
  traverseSafeRoute,
  avoidHazardZone,
  exploreBoundedRegion
]

const skillMap = new Map(skillList.map(skill => [skill.id, skill]))

function getSkill(skillId) {
  return skillMap.get(skillId) || null
}

function listSkills() {
  return skillList.slice()
}

module.exports = {
  getSkill,
  listSkills
}
