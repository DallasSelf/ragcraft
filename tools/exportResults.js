const fs = require('fs')
const path = require('path')
const { loadScenarioMetrics, comparePerformance } = require('../rag/eval/metrics')

function parseArgs(argv) {
  const out = { scenario: null, outDir: 'out' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--scenario') out.scenario = argv[++i]
    else if (a === '--out') out.outDir = argv[++i]
  }
  return out
}

function safeNumber(n) {
  return Number.isFinite(n) ? n : null
}

function summarizeRun(m) {
  const retrievals = Array.isArray(m.retrievals) ? m.retrievals : []
  const latencies = retrievals.map(r => r.latencyMs).filter(x => Number.isFinite(x) && x > 0)
  const sims = retrievals.map(r => r.topSimilarity).filter(x => Number.isFinite(x) && x > 0)

  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

  const snapshots = Array.isArray(m.storeSnapshots) ? m.storeSnapshots : []
  const lastSnap = snapshots.length ? snapshots.slice().sort((a, b) => a.timestamp - b.timestamp)[snapshots.length - 1] : null

  return {
    runId: m.runId || null,
    scenarioId: m.scenarioId || null,
    mode: m.mode || m.variant || null,
    timestamp: safeNumber(m.timestamp),
    success: m.taskOutcome ? !!m.taskOutcome.success : null,
    attempts: m.taskOutcome ? safeNumber(m.taskOutcome.attempts) : null,
    durationMs: m.taskOutcome ? safeNumber(m.taskOutcome.durationMs) : null,
    retrievalCount: retrievals.length,
    avgRetrievalLatencyMs: safeNumber(avg(latencies)),
    topSimilarityAvg: safeNumber(avg(sims)),
    storeDistilledCountEnd: lastSnap ? safeNumber(lastSnap.distilledCount) : null,
    storeRawCountEnd: lastSnap ? safeNumber(lastSnap.rawCount) : null,
    storeSizeBytesEnd: lastSnap ? safeNumber(lastSnap.storeSizeBytes) : null
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.scenario) {
    console.error('Usage: node tools/exportResults.js --scenario <scenarioId|all> [--out out]')
    process.exit(1)
  }

  ensureDir(args.outDir)

  const scenarios = args.scenario === 'all'
    ? ['lever_puzzle_3', 'key_finder_v1', 'maze_v1']
    : [args.scenario]

  const index = []

  for (const scenarioId of scenarios) {
    const metrics = loadScenarioMetrics(scenarioId)
    const runs = metrics.map(summarizeRun)

    const comparison = comparePerformance(scenarioId)

    const summary = {
      scenarioId,
      runCount: runs.length,
      comparison
    }

    const scenarioDir = path.join(args.outDir, 'scenarios', scenarioId)
    ensureDir(scenarioDir)

    writeJson(path.join(scenarioDir, 'summary.json'), summary)
    writeJson(path.join(scenarioDir, 'runs.json'), runs)

    index.push({
      scenarioId,
      runCount: runs.length,
      summaryPath: `scenarios/${scenarioId}/summary.json`,
      runsPath: `scenarios/${scenarioId}/runs.json`
    })
  }

  writeJson(path.join(args.outDir, 'index.json'), { generatedAt: Date.now(), scenarios: index })
  console.log(`Wrote ${args.outDir}/index.json`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
