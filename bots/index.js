import mineflayer from "mineflayer"
import pkgPathfinder from "mineflayer-pathfinder"
import { makeBelief, normalize, bestCell, merge } from "./belief.js"
import { parseClue, applyClue } from "./clues.js"
import { setupNav, goTo } from "./nav.js"

const { pathfinder } = pkgPathfinder
const host = process.env.MC_HOST || "host.docker.internal"
const port = parseInt(process.env.MC_PORT || "25565", 10)
const version = process.env.MC_VERSION || "1.20.6"

const worldBounds = { minX: -32, minZ: -32, size: 64, meetY: 64 }
const meetZone = { x1: -2, z1: -2, x2: 2, z2: 2 }

const landmarks = {
  point: {
    Well: { x: 0, z: -18 },
    Bakery: { x: -15, z: 6 },
    Tower: { x: 18, z: 12 }
  },
  region: {
    MarketSquare: { x1: -10, z1: -10, x2: 10, z2: 10 },
    Alley: { x1: -26, z1: -6, x2: -12, z2: 8 }
  }
}

function makeBot(username, spawnOffset) {
  const bot = mineflayer.createBot({ host, port, username, version })
  bot.loadPlugin(pathfinder)

  const belief = makeBelief(worldBounds.minX, worldBounds.minZ, worldBounds.size)
  const seenClues = new Set()
  let lastTarget = null
  let lastMoveAt = 0

  bot.once("spawn", () => {
    setupNav(bot)
    console.log(username + " spawned")
    tick()
  })

  function scanClues() {
    const signs = Object.values(bot.entities).filter(e => e.name === "sign" || e.displayName === "Sign")
    const nearby = signs.filter(e => bot.entity.position.distanceTo(e.position) < 6)
    for (const s of nearby) {
      const text = s.signText || s.text || ""
      if (!text) continue
      const line = text.split("\n")[0].trim()
      if (!line) continue
      if (seenClues.has(line)) continue
      const c = parseClue(line)
      applyClue(belief, c, landmarks)
      seenClues.add(line)
    }
    normalize(belief)
  }

  function inMeetZone() {
    const p = bot.entity.position
    return p.x >= meetZone.x1 && p.x <= meetZone.x2 && p.z >= meetZone.z1 && p.z <= meetZone.z2
  }

  function pickAndGo() {
    const b = bestCell(belief)
    const y = worldBounds.meetY
    if (!lastTarget || Math.hypot(lastTarget.x - b.x, lastTarget.z - b.z) > 3) {
      lastTarget = { x: Math.round(b.x), y, z: Math.round(b.z) }
      goTo(bot, lastTarget.x, lastTarget.y, lastTarget.z)
      lastMoveAt = Date.now()
      console.log(username + " heading to " + JSON.stringify(lastTarget) + " score " + b.score.toFixed(4))
    }
  }

  function syncIfClose() {
    const mates = ["Scout", "Archivist", "Courier"].filter(n => n !== username)
    for (const name of mates) {
      const other = Object.values(bot.players).find(p => p.username === name)?.entity
      if (!other) continue
      const d = bot.entity.position.distanceTo(other.position)
      if (d < 5) {
        if (bot.username < name) {
          bot.chat("sync")
        }
      }
    }
  }

  bot.on("chat", (uname, message) => {
    if (uname === username) return
    if (message === "sync") {
      // crude broadcast merge via position proximity
      merge(belief, botsState[uname].belief, 0.5)
      normalize(belief)
      pickAndGo()
    }
  })

  function tick() {
    scanClues()
    if (!inMeetZone()) pickAndGo()
    syncIfClose()
    setTimeout(tick, 500)
  }

  botsState[username] = { belief, seenClues }
  return bot
}

const botsState = {}
makeBot("Scout")
makeBot("Archivist")
makeBot("Courier")
