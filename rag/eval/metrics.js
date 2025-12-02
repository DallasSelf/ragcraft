const fs = require('fs')
const path = require('path')
const { getStoreStats } = require('../store/vectorStore')

const metricsDir = path.join(__dirname, 'runs')
if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true })

/**
 * Metrics tracking for RAG system evaluation
 */

class MetricsCollector {
  constructor(runId, scenarioId, mode = 'distilled') {
    this.runId = runId
    this.scenarioId = scenarioId
    this.mode = mode  // 'distilled', 'raw', 'hybrid'
    this.metrics = {
      runId,
      scenarioId,
      mode,
      startTime: Date.now(),
      endTime: null,
      retrievals: [],
      storeSnapshots: [],
      taskOutcome: null
    }
  }

  /**
   * Record a retrieval operation
   */
  recordRetrieval(retrievalData) {
    const record = {
      timestamp: Date.now(),
      queryText: retrievalData.queryText || '',
      resultCount: retrievalData.results?.length || 0,
      topSimilarity: retrievalData.results?.[0]?.similarity || 0,
      avgSimilarity: this._avgSimilarity(retrievalData.results || []),
      latencyMs: retrievalData.latencyMs || 0,
      source: retrievalData.source || this.mode
    }

    this.metrics.retrievals.push(record)
  }

  /**
   * Snapshot vector store size
   */
  snapshotStore() {
    const stats = getStoreStats()
    const snapshot = {
      timestamp: Date.now(),
      ...stats
    }
    this.metrics.storeSnapshots.push(snapshot)
  }

  /**
   * Record final task outcome
   */
  recordOutcome(outcome) {
    this.metrics.taskOutcome = {
      success: outcome.success || false,
      attempts: outcome.attempts || 0,
      totalSteps: outcome.steps || 0,
      solved: outcome.solved || false
    }
    this.metrics.endTime = Date.now()
  }

  /**
   * Compute summary statistics
   */
  computeSummary() {
    const totalRetrievals = this.metrics.retrievals.length

    const avgLatency = totalRetrievals > 0
      ? this.metrics.retrievals.reduce((sum, r) => sum + r.latencyMs, 0) / totalRetrievals
      : 0

    const avgResultCount = totalRetrievals > 0
      ? this.metrics.retrievals.reduce((sum, r) => sum + r.resultCount, 0) / totalRetrievals
      : 0

    const finalStore = this.metrics.storeSnapshots[this.metrics.storeSnapshots.length - 1] || {}

    return {
      totalRetrievals,
      avgLatencyMs: avgLatency,
      avgResultCount,
      totalDurationMs: this.metrics.endTime - this.metrics.startTime,
      finalStoreSize: finalStore.storeSizeBytes || 0,
      finalDistilledCount: finalStore.distilledCount || 0,
      finalRawCount: finalStore.rawCount || 0,
      taskSuccess: this.metrics.taskOutcome?.success || false,
      attemptsToSolve: this.metrics.taskOutcome?.attempts || 0
    }
  }

  /**
   * Save metrics to file
   */
  save() {
    const summary = this.computeSummary()
    const output = {
      ...this.metrics,
      summary
    }

    const filename = `${this.scenarioId}_${this.mode}_${this.runId}.json`
    const filepath = path.join(metricsDir, filename)

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf8')

    console.log(`Metrics saved: ${filename}`)
    return filepath
  }

  _avgSimilarity(results) {
    if (!results || results.length === 0) return 0
    const sum = results.reduce((acc, r) => acc + (r.similarity || 0), 0)
    return sum / results.length
  }
}

/**
 * Load all metrics for a scenario
 */
function loadScenarioMetrics(scenarioId) {
  if (!fs.existsSync(metricsDir)) return []

  const files = fs.readdirSync(metricsDir)
    .filter(f => f.startsWith(scenarioId) && f.endsWith('.json'))

  const metrics = []
  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(metricsDir, file), 'utf8')
      metrics.push(JSON.parse(data))
    } catch (err) {
      console.warn(`Failed to load metrics file ${file}:`, err.message)
    }
  }

  return metrics
}

/**
 * Compare distilled vs raw performance
 */
function comparePerformance(scenarioId) {
  const allMetrics = loadScenarioMetrics(scenarioId)

  const distilledRuns = allMetrics.filter(m => m.mode === 'distilled')
  const rawRuns = allMetrics.filter(m => m.mode === 'raw')

  const avgMetric = (runs, key) => {
    if (runs.length === 0) return 0
    const sum = runs.reduce((acc, r) => acc + (r.summary?.[key] || 0), 0)
    return sum / runs.length
  }

  return {
    scenarioId,
    distilled: {
      runs: distilledRuns.length,
      avgLatency: avgMetric(distilledRuns, 'avgLatencyMs'),
      avgStoreSize: avgMetric(distilledRuns, 'finalStoreSize'),
      avgDuration: avgMetric(distilledRuns, 'totalDurationMs'),
      avgAttempts: avgMetric(distilledRuns, 'attemptsToSolve'),
      successRate: distilledRuns.filter(r => r.summary?.taskSuccess).length / (distilledRuns.length || 1)
    },
    raw: {
      runs: rawRuns.length,
      avgLatency: avgMetric(rawRuns, 'avgLatencyMs'),
      avgStoreSize: avgMetric(rawRuns, 'finalStoreSize'),
      avgDuration: avgMetric(rawRuns, 'totalDurationMs'),
      avgAttempts: avgMetric(rawRuns, 'attemptsToSolve'),
      successRate: rawRuns.filter(r => r.summary?.taskSuccess).length / (rawRuns.length || 1)
    }
  }
}

module.exports = {
  MetricsCollector,
  loadScenarioMetrics,
  comparePerformance
}
