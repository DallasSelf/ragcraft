

const { loadScenarioMetrics, comparePerformance } = require('./rag/eval/metrics')
const { getStoreStats } = require('./rag/store/vectorStore')
const { printStoreStats } = require('./rag/eval/comparison')
const fs = require('fs')
const path = require('path')

function printSeparator() {
  console.log('\n' + '='.repeat(70) + '\n')
}

function analyzeRetrievalPatterns(metrics) {
  console.log('📊 RETRIEVAL PATTERN ANALYSIS')
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
  console.log('💾 STORAGE GROWTH ANALYSIS')
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
  console.log('🎯 TASK PERFORMANCE ANALYSIS')
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
  console.log('🔬 DETAILED MODE COMPARISON')
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

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('RAGCRAFT ANALYSIS DASHBOARD')
  console.log('='.repeat(70))

  
  printStoreStats()

  
  const scenarioId = 'lever_puzzle_3'
  const metrics = loadScenarioMetrics(scenarioId)

  console.log(`Loaded ${metrics.length} evaluation runs for ${scenarioId}\n`)

  if (metrics.length === 0) {
    console.log('No evaluation data found. Run experiments first:')
    console.log('  npm run eval\n')
    return
  }

 
  analyzeRetrievalPatterns(metrics)
  analyzeStorageGrowth(metrics)
  analyzeTaskPerformance(metrics)
  compareModesDetailed(scenarioId)

  
  console.log('💡 RECOMMENDATIONS')
  printSeparator()

  const comparison = comparePerformance(scenarioId)

  if (comparison.distilled.runs > 0) {
    if (comparison.distilled.successRate >= 0.8) {
      console.log('✓ High success rate achieved with distilled mode')
    }

    if (comparison.distilled.avgLatency < 20) {
      console.log('✓ Retrieval latency is excellent (< 20ms)')
    }

    const storeSize = comparison.distilled.avgStoreSize / 1024
    if (storeSize < 100) {
      console.log('✓ Storage footprint is compact (< 100 KB)')
    }

    console.log('\nFor your defense:')
    console.log('1. Highlight the storage efficiency gains')
    console.log('2. Show the retrieval speed improvements')
    console.log('3. Demonstrate maintained task performance')
    console.log('4. Emphasize the confidence-weighted ranking')
  }

  if (comparison.distilled.runs < 5) {
    console.log('\n⚠ Consider running more experiments (at least 5 runs)')
    console.log('  npm run eval  # Run this multiple times')
  }

  printSeparator()
}

main().catch(err => {
  console.error('Analysis failed:', err)
  process.exit(1)
})
