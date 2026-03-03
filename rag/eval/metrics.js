const fs = require('fs')
const path = require('path')
const { getStoreStats } = require('../store/vectorStore')

const metricsDir = path.join(__dirname, 'runs')
if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true })

function toArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean).map(String)
  if (typeof value === 'string') return [value]
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, flag]) => Boolean(flag))
      .map(([key]) => String(key))
  }
  return []
}

function normalizeRunContext(scenarioId, mode, provided = {}) {
  const scenarioType = provided.scenarioType || provided.scenario_type || scenarioId
  const goalType = provided.goalType || provided.goal_type || scenarioType
  const conditionName = provided.conditionName || provided.condition_name || null
  const scoutProvided = provided.scoutEnabled ?? provided.scout_enabled
  const scoutEnabled = typeof scoutProvided === 'boolean' ? scoutProvided : false
  const transferMode = provided.transferMode || provided.transfer_mode || mode
  const transferFlags = Array.from(new Set(toArray(provided.transferFlags || provided.transfer_used_flags)))
  const totalActions = Number(provided.totalActions ?? provided.total_actions ?? 0)
  const hazardExposures = Number(provided.hazardExposures ?? provided.hazard_exposures ?? 0)
  const redundantSearchEvents = Number(provided.redundantSearchEvents ?? provided.redundant_search_events ?? 0)

  return {
    scenario_type: scenarioType,
    goal_type: goalType,
    condition_name: conditionName,
    scout_enabled: scoutEnabled,
    transfer_mode: transferMode,
    transfer_used_flags: transferFlags,
    total_actions: Number.isFinite(totalActions) ? totalActions : 0,
    completion_time_ms: null,
    wrong_turns: null,
    hazard_exposures: Number.isFinite(hazardExposures) ? hazardExposures : 0,
    redundant_search_events: Number.isFinite(redundantSearchEvents) ? redundantSearchEvents : 0,
    success: null
  }
}

/**
 * Metrics tracking for RAG system evaluation
 */

class MetricsCollector {
  constructor(runId, scenarioId, mode = 'distilled', context = {}) {
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
    this.runContext = normalizeRunContext(scenarioId, mode, context)
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
      solved: outcome.solved || false,
      wrongTurns: Number.isFinite(outcome.wrongTurns) ? outcome.wrongTurns : null,
      revisits: Number.isFinite(outcome.revisits) ? outcome.revisits : null,
      pathEfficiency: Number.isFinite(outcome.pathEfficiency) ? outcome.pathEfficiency : null,
      optimalPathLength: Number.isFinite(outcome.optimalPathLength) ? outcome.optimalPathLength : null,
      searchActionsAvoided: Number.isFinite(outcome.searchActionsAvoided) ? outcome.searchActionsAvoided : 0
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
    const outcome = this.metrics.taskOutcome || {}

    return {
      totalRetrievals,
      avgLatencyMs: avgLatency,
      avgResultCount,
      totalDurationMs: this.metrics.endTime - this.metrics.startTime,
      finalStoreSize: finalStore.storeSizeBytes || 0,
      finalDistilledCount: finalStore.distilledCount || 0,
      finalRawCount: finalStore.rawCount || 0,
      taskSuccess: outcome.success || false,
      attemptsToSolve: outcome.attempts || 0,
      mazeWrongTurns: outcome.wrongTurns ?? null,
      mazeRevisits: outcome.revisits ?? null,
      mazePathEfficiency: outcome.pathEfficiency ?? null,
      mazeOptimalPathLength: outcome.optimalPathLength ?? null,
      searchActionsAvoided: outcome.searchActionsAvoided || 0
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
