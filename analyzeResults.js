
const { loadScenarioMetrics, comparePerformance } = require('./rag/eval/metrics')
const { getStoreStats } = require('./rag/store/vectorStore')
const { printStoreStats } = require('./rag/eval/comparison')
const fs = require('fs')
const path = require('path')

function printSeparator() {
  console.log('\n' + '='.repeat(70) + '\n')
}

function analyzeRetrievalPatterns(metrics) {
  console.log('RETRIEVAL PATTERN ANALYSIS')
  printSeparator()

  const allRetrievals = metrics.flatMap(m => m.retrievals || [])

  if (allRetrievals.length === 0) {
    console.log('No retrieval data available yet.\n')
    return
  }

  const latencies = allRetrievals.map(r => r.latencyMs).filter(l => l > 0)
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const minLatency = Math.min(...latencies)
  const maxLatency = Math.max(...latencies)

  console.log('Retrieval Latency:')
  console.log(`  Average: ${avgLatency.toFixed(2)} ms`)
  console.log(`  Min:     ${minLatency.toFixed(2)} ms`)
  console.log(`  Max:     ${maxLatency.toFixed(2)} ms`)
  console.log(`  Total retrievals: ${allRetrievals.length}`)

  const similarities = allRetrievals.map(r => r.topSimilarity).filter(s => s > 0)
  if (similarities.length > 0) {
    const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length
    const minSim = Math.min(...similarities)
    const maxSim = Math.max(...similarities)

    console.log('\nTop Similarity Scores:')
    console.log(`  Average: ${avgSim.toFixed(4)}`)
    console.log(`  Min:     ${minSim.toFixed(4)}`)
    console.log(`  Max:     ${maxSim.toFixed(4)}`)
  }

  const resultCounts = allRetrievals.map(r => r.resultCount)
  const avgResults = resultCounts.reduce((a, b) => a + b, 0) / resultCounts.length

  console.log('\nResults per Query:')
  console.log(`  Average: ${avgResults.toFixed(2)}`)
  console.log(`  Max:     ${Math.max(...resultCounts)}`)

  printSeparator()
}

function analyzeStorageGrowth(metrics) {
  console.log('STORAGE GROWTH ANALYSIS')
  printSeparator()

  const allSnapshots = metrics.flatMap(m => m.storeSnapshots || [])
    .sort((a, b) => a.timestamp - b.timestamp)

  if (allSnapshots.length === 0) {
    console.log('No storage snapshots available yet.\n')
    return
  }

  const firstSnapshot = allSnapshots[0]
  const lastSnapshot = allSnapshots[allSnapshots.length - 1]

  console.log('Initial State:')
  console.log(`  Distilled: ${firstSnapshot.distilledCount || 0}`)
  console.log(`  Raw:       ${firstSnapshot.rawCount || 0}`)
  console.log(`  Size:      ${((firstSnapshot.storeSizeBytes || 0) / 1024).toFixed(2)} KB`)

  console.log('\nFinal State:')
  console.log(`  Distilled: ${lastSnapshot.distilledCount || 0}`)
  console.log(`  Raw:       ${lastSnapshot.rawCount || 0}`)
  console.log(`  Size:      ${((lastSnapshot.storeSizeBytes || 0) / 1024).toFixed(2)} KB`)

  const growth = lastSnapshot.distilledCount - firstSnapshot.distilledCount
  const sizeGrowth = (lastSnapshot.storeSizeBytes - firstSnapshot.storeSizeBytes) / 1024

  console.log('\nGrowth:')
  console.log(`  +${growth} distilled memories`)
  console.log(`  +${sizeGrowth.toFixed(2)} KB storage`)

  if (growth > 0) {
    const avgSizePerMemory = sizeGrowth / growth
    console.log(`  Avg size per memory: ${avgSizePerMemory.toFixed(2)} KB`)
  }

  printSeparator()
}

function analyzeTaskPerformance(metrics) {
  console.log('TASK PERFORMANCE ANALYSIS')
  printSeparator()

  const outcomes = metrics.map(m => m.taskOutcome).filter(Boolean)

  if (outcomes.length === 0) {
    console.log('No task outcomes available yet.\n')
    return
  }

  const successCount = outcomes.filter(o => o.success).length
  const successRate = successCount / outcomes.length

  const totalAttempts = outcomes.reduce((sum, o) => sum + (o.attempts || 0), 0)
  const avgAttempts = totalAttempts / outcomes.length

  console.log(`Total Runs: ${outcomes.length}`)
  console.log(`Success Rate: ${(successRate * 100).toFixed(1)}% (${successCount}/${outcomes.length})`)
  console.log(`Avg Attempts per Run: ${avgAttempts.toFixed(2)}`)

  console.log('\nLearning Curve (attempts per run):')
  outcomes.forEach((o, i) => {
    const marker = o.success ? '✓' : '✗'
    const bar = '█'.repeat(Math.min(o.attempts || 0, 20))
    console.log(`  Run ${i + 1}: ${bar} ${o.attempts || 0} ${marker}`)
  })

  printSeparator()
}

function generateASCIIChart(data, title, width = 50) {
  console.log(title)
  console.log('-'.repeat(width))

  if (data.length === 0) {
    console.log('No data')
    return
  }

  const max = Math.max(...data.map(d => d.value))
  const scale = width / max

  data.forEach(item => {
    const barLength = Math.round(item.value * scale)
    const bar = '█'.repeat(barLength)
    console.log(`${item.label.padEnd(15)} ${bar} ${item.value.toFixed(2)}`)
  })

  console.log('-'.repeat(width))
}

function compareModesDetailed(scenarioId) {
  console.log('DETAILED MODE COMPARISON')
  printSeparator()

  const comparison = comparePerformance(scenarioId)

  if (comparison.distilled.runs === 0 && comparison.raw.runs === 0) {
    console.log('No comparison data available. Run experiments first.\n')
    return
  }

  console.log(`Scenario: ${scenarioId}\n`)

  const metrics = [
    {
      name: 'Runs',
      distilled: comparison.distilled.runs,
      raw: comparison.raw.runs
    },
    {
      name: 'Avg Latency (ms)',
      distilled: comparison.distilled.avgLatency.toFixed(2),
      raw: comparison.raw.avgLatency.toFixed(2)
    },
    {
      name: 'Avg Store (KB)',
      distilled: (comparison.distilled.avgStoreSize / 1024).toFixed(2),
      raw: (comparison.raw.avgStoreSize / 1024).toFixed(2)
    },
    {
      name: 'Success Rate',
      distilled: (comparison.distilled.successRate * 100).toFixed(1) + '%',
      raw: (comparison.raw.successRate * 100).toFixed(1) + '%'
    }
  ]

  console.log('Metric'.padEnd(25) + 'Distilled'.padEnd(15) + 'Raw'.padEnd(15) + 'Winner')
  console.log('-'.repeat(70))

  metrics.forEach(m => {
    const dVal = parseFloat(m.distilled) || 0
    const rVal = parseFloat(m.raw) || 0

    let winner = '—'
    if (m.name.includes('Success')) {
      winner = dVal > rVal ? 'Distilled ✓' : rVal > dVal ? 'Raw ✓' : 'Tie'
    } else if (dVal !== 0 && rVal !== 0) {
      winner = dVal < rVal ? 'Distilled ✓' : rVal < dVal ? 'Raw ✓' : 'Tie'
    }

    console.log(
      m.name.padEnd(25) +
      String(m.distilled).padEnd(15) +
      String(m.raw).padEnd(15) +
      winner
    )
  })

  printSeparator()
}

/**
 * Extract unique scenario IDs from metrics files
 */
function getAllScenarioIds() {
  const metricsDir = path.join(__dirname, 'rag/eval/runs')
  if (!fs.existsSync(metricsDir)) return []

  const files = fs.readdirSync(metricsDir)
    .filter(f => f.endsWith('.json'))

  const scenarioIds = new Set()
  
  // Known scenario patterns to match
  const knownScenarios = ['lever_puzzle_3', 'maze_v1', 'key_finder_v1']
  
  for (const file of files) {
    let found = false
    
    // Try to match known scenario patterns first (faster)
    for (const known of knownScenarios) {
      if (file.startsWith(known + '_')) {
        scenarioIds.add(known)
        found = true
        break
      }
    }
    
    // If no match, extract from JSON content
    if (!found) {
      try {
        const filePath = path.join(metricsDir, file)
        const content = fs.readFileSync(filePath, 'utf8')
        const data = JSON.parse(content)
        if (data.scenarioId) {
          scenarioIds.add(data.scenarioId)
        }
      } catch (err) {
        // Skip invalid files
        continue
      }
    }
  }

  return Array.from(scenarioIds)
}

async function analyzeScenario(scenarioId) {
  console.log('\n' + '='.repeat(70))
  console.log(`SCENARIO: ${scenarioId.toUpperCase()}`)
  console.log('='.repeat(70))

  const metrics = loadScenarioMetrics(scenarioId)

  console.log(`Loaded ${metrics.length} evaluation runs for ${scenarioId}\n`)

  if (metrics.length === 0) {
    console.log('No evaluation data found for this scenario.\n')
    return
  }

  analyzeRetrievalPatterns(metrics)
  analyzeStorageGrowth(metrics)
  analyzeTaskPerformance(metrics)
  compareModesDetailed(scenarioId)
}

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('RAGCRAFT ANALYSIS DASHBOARD')
  console.log('='.repeat(70))

  printStoreStats()

  const scenarioIds = getAllScenarioIds()

  if (scenarioIds.length === 0) {
    console.log('\nNo evaluation data found. Run scenarios first to generate metrics.')
    console.log('\nNote: Only "Enhanced" episode functions collect metrics:')
    console.log('  - runMazeEpisodeEnhanced (not runMazeEpisode)')
    console.log('  - runKeyFinderEpisodeEnhanced (not runKeyFinderEpisode)')
    console.log('  - runLeverEpisodeEnhanced (not runLeverEpisode)')
    console.log('\nUse evalRunner.js or evalRunnerFull.js to run scenarios with metrics collection.\n')
    return
  }

  console.log(`\nFound ${scenarioIds.length} scenario(s) with metrics: ${scenarioIds.join(', ')}`)
  
  // Check for expected scenarios that might be missing
  const expectedScenarios = ['lever_puzzle_3', 'maze_v1', 'key_finder_v1']
  const missingScenarios = expectedScenarios.filter(id => !scenarioIds.includes(id))
  if (missingScenarios.length > 0) {
    console.log(`\nNote: The following scenarios have no metrics yet: ${missingScenarios.join(', ')}`)
    console.log('Run these scenarios using the "Enhanced" episode functions to collect metrics.\n')
  } else {
    console.log('\n')
  }

  // Analyze each scenario
  for (const scenarioId of scenarioIds) {
    await analyzeScenario(scenarioId)
  }

  // Summary across all scenarios
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY ACROSS ALL SCENARIOS')
  console.log('='.repeat(70))

  const allMetrics = scenarioIds.flatMap(id => loadScenarioMetrics(id))
  if (allMetrics.length > 0) {
    console.log(`\nTotal runs across all scenarios: ${allMetrics.length}`)
    
    const successCount = allMetrics.filter(m => m.summary?.taskSuccess).length
    const successRate = (successCount / allMetrics.length) * 100
    console.log(`Overall success rate: ${successRate.toFixed(1)}% (${successCount}/${allMetrics.length})`)

    const totalAttempts = allMetrics.reduce((sum, m) => sum + (m.summary?.attemptsToSolve || 0), 0)
    const avgAttempts = totalAttempts / allMetrics.length
    console.log(`Average attempts to solve: ${avgAttempts.toFixed(2)}`)

    const totalRetrievals = allMetrics.reduce((sum, m) => sum + (m.summary?.totalRetrievals || 0), 0)
    const avgRetrievals = totalRetrievals / allMetrics.length
    console.log(`Average retrievals per run: ${avgRetrievals.toFixed(2)}`)

    const avgLatencies = allMetrics
      .filter(m => m.summary?.avgLatencyMs > 0)
      .map(m => m.summary.avgLatencyMs)
    if (avgLatencies.length > 0) {
      const overallAvgLatency = avgLatencies.reduce((a, b) => a + b, 0) / avgLatencies.length
      console.log(`Average retrieval latency: ${overallAvgLatency.toFixed(2)} ms`)
    }
  }

  console.log('\n')
}

main().catch(err => {
  console.error('Analysis failed:', err)
  process.exit(1)
})
