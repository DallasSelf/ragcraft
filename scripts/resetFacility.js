#!/usr/bin/env node
require('dotenv').config()

const { resetFacility } = require('../runner/facilityReset')
const { resetKnowledgeStores } = require('../runner/knowledgeReset')

function parseArgs(argv) {
  const options = {
    quiet: false,
    wipeMemory: false,
    username: null
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--quiet') {
      options.quiet = true
    } else if (token === '--wipeMemory' || token === '--wipe-memory' || token === '--wipe') {
      options.wipeMemory = true
    } else if (token === '--username' && argv[i + 1]) {
      options.username = argv[i + 1]
      i += 1
    }
  }

  return options
}

async function main() {
  const options = parseArgs(process.argv)
  if (!options.quiet) {
    console.log('Resetting facility to baseline state...')
  }

  const summary = await resetFacility({
    quiet: options.quiet,
    username: options.username || undefined
  })

  if (options.wipeMemory) {
    resetKnowledgeStores()
    summary.memoryCleared = true
  }

  if (options.quiet) {
    return
  }

  console.log('Facility reset complete:')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(err => {
  console.error('Facility reset failed:', err.message)
  process.exit(1)
})
