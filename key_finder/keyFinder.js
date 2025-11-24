const mineflayer = require('mineflayer')
const { saveEvent, summarizeEvent, embedEvent, storeMemory, getRelevantMemories } = require('./memory/episodicMemory')

async function runKeyFinderScenario() {
  const bot = mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'KeyFinderBot'
  })

  bot.once('spawn', async () => {
    console.log('Bot spawned into Key Finder scenario.')

    const scenarioId = 'key_finder_v1'

    const memories = await getRelevantMemories(scenarioId, 'key_search')
    console.log('Retrieved relevant past memories:', memories.length)

    const chestPos = { x: 5, y: 4, z: 5 }

    const rawEvent = {
      scenarioId,
      eventType: 'key_search_attempt',
      timestamp: Date.now(),
      actions: []
    }

    try {
      await bot.pathfinder.goto(new bot.pathfinder.goals.GoalBlock(chestPos.x, chestPos.y, chestPos.z))
      rawEvent.actions.push({ type: 'move', pos: chestPos })

      const chestBlock = bot.blockAt(bot.entity.position.offset(0, 0, 0))
      const chest = await bot.openChest(chestBlock)

      const items = chest.containerItems()
      const keyItem = items.find(i => i && i.name === 'stick' && i.customName === 'Key')

      let foundKey = false

      if (keyItem) {
        await bot.tossStack(keyItem)
        foundKey = true
        rawEvent.actions.push({ type: 'found_key', item: keyItem })
      } else {
        rawEvent.actions.push({ type: 'no_key_found' })
      }

      chest.close()

      rawEvent.result = foundKey ? 'success' : 'fail'

      await saveEvent(rawEvent)

      const summary = await summarizeEvent(rawEvent)
      const embedding = await embedEvent(summary)

      await storeMemory({
        scenarioId,
        memoryType: 'key_search',
        rawEvent,
        summary,
        embedding
      })

      console.log('Memory stored successfully.')

      if (!foundKey) {
        console.log('No key found. Using past memories to refine search strategy.')
        console.log('This is where your “RAG scaling efficiency” gets demonstrated.')
      } else {
        console.log('Key found! Scenario succeeded.')
      }

      setTimeout(() => bot.quit(), 2000)
    } catch (err) {
      console.log('Error during key finder scenario:', err)
      bot.quit()
    }
  })
}

runKeyFinderScenario()
