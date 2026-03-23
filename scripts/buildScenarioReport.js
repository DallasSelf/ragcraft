const fs = require('fs')
const path = require('path')

const RUNS_ROOT = path.join(__dirname, '..', 'runs')
const RUNS_SUMMARY_DIR = path.join(RUNS_ROOT, '_summary')
const OUTPUT_DIR = path.join(__dirname, '..', 'rag', 'eval', 'reporting')
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'scenario_mode_summary.json')
const OUTPUT_CSV = path.join(OUTPUT_DIR, 'scenario_mode_summary.csv')
const OUTPUT_RUNS_CSV = path.join(OUTPUT_DIR, 'run_records.csv')
const OUTPUT_UNIFIED_JSON = path.join(RUNS_SUMMARY_DIR, 'aggregated_runs.json')
const OUTPUT_UNIFIED_CSV = path.join(RUNS_SUMMARY_DIR, 'aggregated_runs.csv')
const DISTILLED_MEMORY_FILE = path.join(__dirname, '..', 'rag', 'distilledMemory', 'memory.json')

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function walkFiles(rootDir, out = []) {
  if (!fs.existsSync(rootDir)) return out
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, out)
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
      out.push(full)
    }
  }
  return out
}

function walkSummaryFiles(rootDir, out = []) {
  if (!fs.existsSync(rootDir)) return out
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      walkSummaryFiles(full, out)
      continue
    }
    if (entry.isFile() && entry.name === 'summary.json') {
      out.push(full)
    }
  }
  return out
}

function parseJsonLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function parseEvents(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return raw
    .split(/\r?\n/)
    .map(parseJsonLine)
    .filter(Boolean)
}

function parseSummaryFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function toNumberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null
}

function inferMode(runLabel) {
  const label = String(runLabel || '').toLowerCase()
  if (label.includes('distilled')) return 'distilled'
  if (label.includes('raw')) return 'raw'
  if (label.includes('terminal')) return 'terminal'
  return 'unknown'
}

function detectOutcome(result = {}) {
  if (typeof result.success === 'boolean') return result.success
  if (typeof result.solved === 'boolean') return result.solved
  if (typeof result.found === 'boolean') return result.found
  return null
}

function detectAttempts(result = {}) {
  if (Number.isFinite(result.attempts)) return Number(result.attempts)
  if (Number.isFinite(result.stepsExecuted)) return Number(result.stepsExecuted)
  return null
}

function detectDetailedMazeMetrics(events, result = {}) {
  const explicitWrongTurns = toNumberOrNull(result.wrongTurns)
  const explicitRevisits = toNumberOrNull(result.revisits)
  const explicitPathEfficiency = toNumberOrNull(result.pathEfficiency)

  if (explicitWrongTurns !== null || explicitRevisits !== null || explicitPathEfficiency !== null) {
    return {
      wrongTurns: explicitWrongTurns,
      revisits: explicitRevisits,
      pathEfficiency: explicitPathEfficiency
    }
  }

  const lastMazeAttemptResult = [...events].reverse().find(e => e.type === 'maze_attempt_result')
  if (!lastMazeAttemptResult) {
    return {
      wrongTurns: null,
      revisits: null,
      pathEfficiency: null
    }
  }

  return {
    wrongTurns: toNumberOrNull(lastMazeAttemptResult.wrongTurns),
    revisits: toNumberOrNull(lastMazeAttemptResult.revisits),
    pathEfficiency: toNumberOrNull(lastMazeAttemptResult.pathEfficiency)
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function avg(values) {
  const usable = values.filter(v => Number.isFinite(v))
  if (usable.length === 0) return null
  const total = usable.reduce((sum, v) => sum + v, 0)
  return Number((total / usable.length).toFixed(3))
}

function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return Number((numerator / denominator).toFixed(4))
}

function relativeRunPath(filePath) {
  return path.relative(path.join(__dirname, '..'), filePath).replace(/\\/g, '/')
}

function loadMemoryScenarioIndex() {
  if (!fs.existsSync(DISTILLED_MEMORY_FILE)) return new Map()
  try {
    const raw = JSON.parse(fs.readFileSync(DISTILLED_MEMORY_FILE, 'utf8'))
    const claims = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.claims)
        ? raw.claims
        : []
    const out = new Map()
    for (const claim of claims) {
      if (!claim || !claim.id) continue
      out.set(String(claim.id), String(claim.scenarioId || claim.task_id || 'unknown'))
    }
    return out
  } catch {
    return new Map()
  }
}

function canonicalScenarioId(value) {
  const sid = String(value || '').toLowerCase()
  if (!sid) return 'unknown'
  if (sid.startsWith('maze')) return 'maze'
  if (sid.startsWith('lever')) return 'lever'
  if (sid.startsWith('key')) return 'key'
  if (sid.startsWith('scout')) return 'scout'
  if (sid.startsWith('captive')) return 'captive'
  return sid.replace(/_v\d+$/, '')
}

function collectClaimRefs(events = []) {
  const refs = new Set()
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    if (Array.isArray(event.steps)) {
      for (const step of event.steps) {
        if (step && step.claimRef) refs.add(String(step.claimRef))
      }
    }
    if (Array.isArray(event.claimReferences)) {
      for (const ref of event.claimReferences) {
        if (ref) refs.add(String(ref))
      }
    }
    if (event.claimRef) refs.add(String(event.claimRef))
  }
  return Array.from(refs)
}

function derivePolicyAudit(events, runRecord, memoryScenarioIndex) {
  const claimRefs = collectClaimRefs(events)
  if (claimRefs.length === 0) {
    return {
      scoutReconHits: null,
      crossScenarioHits: null,
      sameScenarioHits: null,
      rawBlockedSharedHits: runRecord.mode === 'raw' ? 0 : null,
      policyAuditSource: runRecord.mode === 'raw' ? 'inferred_no_claim_refs' : null
    }
  }

  const runScenario = canonicalScenarioId(runRecord.scenarioId)
  let scoutReconHits = 0
  let crossScenarioHits = 0
  let sameScenarioHits = 0

  for (const ref of claimRefs) {
    const sourceScenario = canonicalScenarioId(memoryScenarioIndex.get(ref))
    if (sourceScenario === 'unknown') continue
    if (sourceScenario === 'scout') scoutReconHits += 1
    if (sourceScenario === runScenario) sameScenarioHits += 1
    else crossScenarioHits += 1
  }

  const rawBlockedSharedHits = runRecord.mode === 'raw' ? 0 : null

  return {
    scoutReconHits,
    crossScenarioHits,
    sameScenarioHits,
    rawBlockedSharedHits,
    policyAuditSource: 'claim_ref_memory_index'
  }
}

function normalizeRunRecord(filePath, memoryScenarioIndex) {
  const events = parseEvents(filePath)
  if (events.length === 0) return null

  const runEnd = [...events].reverse().find(e => e.type === 'run_end')
  if (!runEnd) return null

  const runStart = [...events].reverse().find(e => e.type === 'run_start') || {}
  const result = runEnd.result || {}
  const mazeMetrics = detectDetailedMazeMetrics(events, result)

  const mode = runStart.mode || inferMode(runEnd.runLabel)
  const scenarioId = runEnd.scenarioId || result.scenarioId || 'unknown'
  const attempts = detectAttempts(result)
  const outcome = detectOutcome(result)

  const runRecord = {
    scenarioId,
    runLabel: runEnd.runLabel || null,
    mode,
    runId: runEnd.runId || result.runId || null,
    runFile: relativeRunPath(filePath),
    runFilename: path.basename(filePath),
    timestamp: toNumberOrNull(runEnd.timestamp),
    durationMs: toNumberOrNull(runEnd.ms),
    attempts,
    outcome,
    wrongTurns: mazeMetrics.wrongTurns,
    revisits: mazeMetrics.revisits,
    pathEfficiency: mazeMetrics.pathEfficiency,
    failedMoves: toNumberOrNull(result.failedMoves),
    successfulMoves: toNumberOrNull(result.successfulMoves),
    coverageRatio: toNumberOrNull(result.coverageRatio),
    waypointSuccessRate: toNumberOrNull(result.waypointSuccessRate),
    hazardExposures: toNumberOrNull(runEnd.hazardExposures) || 0,
    terminatedByStagnation: Boolean(result.terminatedByStagnation)
  }

  const policyAudit = derivePolicyAudit(events, runRecord, memoryScenarioIndex)
  return {
    ...runRecord,
    scout_recon_hits: toNumberOrNull(policyAudit.scoutReconHits),
    cross_scenario_hits: toNumberOrNull(policyAudit.crossScenarioHits),
    same_scenario_hits: toNumberOrNull(policyAudit.sameScenarioHits),
    raw_blocked_shared_hits: toNumberOrNull(policyAudit.rawBlockedSharedHits),
    policyAuditSource: policyAudit.policyAuditSource
  }
}

function normalizeSummaryRecord(summaryPath, memoryScenarioIndex) {
  const summary = parseSummaryFile(summaryPath)
  if (!summary || typeof summary !== 'object') return null

  const metadata = summary.metadata && typeof summary.metadata === 'object'
    ? summary.metadata
    : {}
  const rawResult = metadata.raw_result && typeof metadata.raw_result === 'object'
    ? metadata.raw_result
    : {}

  const runRecord = {
    scenarioId: summary.scenario || rawResult.scenarioId || 'unknown',
    runLabel: metadata.run_label || null,
    mode: summary.memory_mode || 'unknown',
    runId: summary.run_id || rawResult.runId || null,
    runFile: relativeRunPath(summaryPath),
    runFilename: path.basename(path.dirname(summaryPath)),
    timestamp: Number.isFinite(Date.parse(summary.timestamp)) ? Date.parse(summary.timestamp) : null,
    durationMs: Number.isFinite(summary.duration_seconds) ? Math.round(summary.duration_seconds * 1000) : null,
    attempts: toNumberOrNull(summary.attempts),
    outcome: typeof summary.success === 'boolean' ? summary.success : detectOutcome(rawResult),
    wrongTurns: toNumberOrNull(summary.wrong_turns ?? rawResult.wrongTurns),
    revisits: toNumberOrNull(summary.revisits ?? rawResult.revisits),
    pathEfficiency: toNumberOrNull(summary.path_efficiency ?? rawResult.pathEfficiency),
    failedMoves: toNumberOrNull(rawResult.failedMoves),
    successfulMoves: toNumberOrNull(rawResult.successfulMoves),
    coverageRatio: toNumberOrNull(rawResult.coverageRatio),
    waypointSuccessRate: toNumberOrNull(rawResult.waypointSuccessRate),
    hazardExposures: toNumberOrNull(metadata.hazard_exposures) || 0,
    terminatedByStagnation: Boolean(rawResult.terminatedByStagnation),
    actionCount: toNumberOrNull(summary.action_count)
  }

  const policyAudit = {
    scoutReconHits: toNumberOrNull(rawResult.scout_recon_hits),
    crossScenarioHits: toNumberOrNull(rawResult.cross_scenario_hits),
    sameScenarioHits: toNumberOrNull(rawResult.same_scenario_hits),
    rawBlockedSharedHits: toNumberOrNull(rawResult.raw_blocked_shared_hits),
    policyAuditSource: rawResult.policyAuditSource || null
  }

  if (policyAudit.scoutReconHits === null) {
    const fallback = derivePolicyAudit([], runRecord, memoryScenarioIndex)
    policyAudit.scoutReconHits = toNumberOrNull(fallback.scoutReconHits)
    policyAudit.crossScenarioHits = toNumberOrNull(fallback.crossScenarioHits)
    policyAudit.sameScenarioHits = toNumberOrNull(fallback.sameScenarioHits)
    policyAudit.rawBlockedSharedHits = toNumberOrNull(fallback.rawBlockedSharedHits)
    policyAudit.policyAuditSource = fallback.policyAuditSource
  }

  return {
    ...runRecord,
    scout_recon_hits: policyAudit.scoutReconHits,
    cross_scenario_hits: policyAudit.crossScenarioHits,
    same_scenario_hits: policyAudit.sameScenarioHits,
    raw_blocked_shared_hits: policyAudit.rawBlockedSharedHits,
    policyAuditSource: policyAudit.policyAuditSource
  }
}

function buildGroupedSummary(runRecords) {
  const groups = new Map()

  for (const run of runRecords) {
    const key = `${run.scenarioId}::${run.mode}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(run)
  }

  const rows = []
  for (const [key, runs] of groups.entries()) {
    const [scenarioId, mode] = key.split('::')
    const sorted = [...runs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    const outcomes = runs.map(r => r.outcome).filter(v => typeof v === 'boolean')
    const successCount = outcomes.filter(Boolean).length

    rows.push({
      scenarioId,
      mode,
      runCount: runs.length,
      successRate: pct(successCount, outcomes.length),
      averageAttempts: avg(runs.map(r => r.attempts)),
      averageDurationMs: avg(runs.map(r => r.durationMs)),
      averageWrongTurns: avg(runs.map(r => r.wrongTurns)),
      averageRevisits: avg(runs.map(r => r.revisits)),
      averagePathEfficiency: avg(runs.map(r => r.pathEfficiency)),
      averageFailedMoves: avg(runs.map(r => r.failedMoves)),
      averageSuccessfulMoves: avg(runs.map(r => r.successfulMoves)),
      averageCoverageRatio: avg(runs.map(r => r.coverageRatio)),
      averageWaypointSuccessRate: avg(runs.map(r => r.waypointSuccessRate)),
      averageHazardExposures: avg(runs.map(r => r.hazardExposures)),
      scout_recon_hits: avg(runs.map(r => r.scout_recon_hits)),
      cross_scenario_hits: avg(runs.map(r => r.cross_scenario_hits)),
      same_scenario_hits: avg(runs.map(r => r.same_scenario_hits)),
      raw_blocked_shared_hits: avg(runs.map(r => r.raw_blocked_shared_hits)),
      latestRunFilesIncluded: sorted.slice(0, 5).map(r => r.runFile)
    })
  }

  rows.sort((a, b) => {
    if (a.scenarioId === b.scenarioId) return a.mode.localeCompare(b.mode)
    return a.scenarioId.localeCompare(b.scenarioId)
  })

  return rows
}

function buildScenarioStatus(groupedSummary, runRecords) {
  const scenarioIds = Array.from(new Set(groupedSummary.map(row => row.scenarioId))).sort()

  return scenarioIds.map(scenarioId => {
    const sid = scenarioId.toLowerCase()
    if (sid === 'lever' || sid === 'maze') {
      return {
        scenarioId,
        status: 'validated_comparison',
        note: 'Validated comparison scenario for raw vs distilled defense framing.'
      }
    }

    if (sid === 'key' || sid === 'key_finder_v1') {
      return {
        scenarioId,
        status: 'supporting_scenario',
        note: 'Supporting scenario used to reinforce comparison findings.'
      }
    }

    const isScout = sid.includes('scout')

    if (isScout) {
      return {
        scenarioId,
        status: 'reconnaissance_producer',
        note: 'Reconnaissance producer: explores environment and emits shared distilled recon memory for eligible consumers.'
      }
    }

    return {
      scenarioId,
      status: 'standard',
      note: 'Standard scenario reporting.'
    }
  })
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','))
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')
}

function main() {
  ensureDir(OUTPUT_DIR)
  ensureDir(RUNS_SUMMARY_DIR)

  const files = walkFiles(RUNS_ROOT)
  const summaryFiles = walkSummaryFiles(RUNS_ROOT)
  const memoryScenarioIndex = loadMemoryScenarioIndex()
  const summaryRunRecords = summaryFiles
    .map(filePath => normalizeSummaryRecord(filePath, memoryScenarioIndex))
    .filter(Boolean)

  const jsonlWithoutSummary = files.filter(filePath => {
    const runDir = path.dirname(filePath)
    return !fs.existsSync(path.join(runDir, 'summary.json'))
  })

  const legacyRunRecords = jsonlWithoutSummary
    .map(filePath => normalizeRunRecord(filePath, memoryScenarioIndex))
    .filter(Boolean)

  const runRecords = [...summaryRunRecords, ...legacyRunRecords]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

  const groupedSummary = buildGroupedSummary(runRecords)
  const scenarioStatus = buildScenarioStatus(groupedSummary, runRecords)

  const rawPolicyRuns = runRecords.filter(r => r.mode === 'raw' && Number.isFinite(r.scout_recon_hits))
  const distilledPolicyRuns = runRecords.filter(r => r.mode === 'distilled' && Number.isFinite(r.scout_recon_hits))
  const output = {
    generatedAt: new Date().toISOString(),
    sourceOfTruth: {
      runArtifactsRoot: relativeRunPath(RUNS_ROOT),
      parsedJsonlFiles: files.length,
      parsedRuns: runRecords.length,
      notes: [
        'Primary truth source is run_end events in runs/**/*.jsonl.',
        'mode comes from run_start.mode when present; otherwise inferred from run label.',
        'maze wrong turns/revisits/path efficiency fallback to maze_attempt_result when absent in run_end.result.',
        'policy audit fields are lightweight and derived from claimRef usage when present.'
      ]
    },
    policyAudit: {
      raw_runs_with_audit: rawPolicyRuns.length,
      distilled_runs_with_audit: distilledPolicyRuns.length,
      raw_stays_blind_to_scout_recon: rawPolicyRuns.length > 0
        ? rawPolicyRuns.every(r => (r.scout_recon_hits || 0) === 0)
        : null,
      distilled_can_access_eligible_scout_recon: distilledPolicyRuns.length > 0
        ? distilledPolicyRuns.some(r => (r.scout_recon_hits || 0) > 0)
        : null
    },
    groupedSummary,
    scenarioStatus,
    runRecords
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8')
  fs.writeFileSync(OUTPUT_UNIFIED_JSON, JSON.stringify(output, null, 2), 'utf8')

  writeCsv(
    OUTPUT_CSV,
    [
      'scenarioId',
      'mode',
      'runCount',
      'successRate',
      'averageAttempts',
      'averageDurationMs',
      'averageWrongTurns',
      'averageRevisits',
      'averagePathEfficiency',
      'averageFailedMoves',
      'averageSuccessfulMoves',
      'averageCoverageRatio',
      'averageWaypointSuccessRate',
      'averageHazardExposures',
      'scout_recon_hits',
      'cross_scenario_hits',
      'same_scenario_hits',
      'raw_blocked_shared_hits',
      'latestRunFilesIncluded'
    ],
    groupedSummary.map(row => ({
      ...row,
      latestRunFilesIncluded: row.latestRunFilesIncluded.join(' | ')
    }))
  )

  writeCsv(
    OUTPUT_RUNS_CSV,
    [
      'scenarioId',
      'mode',
      'runLabel',
      'runId',
      'runFilename',
      'durationMs',
      'attempts',
      'outcome',
      'wrongTurns',
      'revisits',
      'pathEfficiency',
      'failedMoves',
      'successfulMoves',
      'coverageRatio',
      'waypointSuccessRate',
      'hazardExposures',
      'scout_recon_hits',
      'cross_scenario_hits',
      'same_scenario_hits',
      'raw_blocked_shared_hits',
      'policyAuditSource'
    ],
    runRecords
  )

  writeCsv(
    OUTPUT_UNIFIED_CSV,
    [
      'runId',
      'scenarioId',
      'mode',
      'timestamp',
      'durationMs',
      'attempts',
      'outcome',
      'actionCount',
      'wrongTurns',
      'revisits',
      'pathEfficiency',
      'hazardExposures',
      'runFile'
    ],
    runRecords
  )

  console.log(`Summary JSON: ${relativeRunPath(OUTPUT_JSON)}`)
  console.log(`Summary CSV:  ${relativeRunPath(OUTPUT_CSV)}`)
  console.log(`Runs CSV:     ${relativeRunPath(OUTPUT_RUNS_CSV)}`)
  console.log(`Unified JSON: ${relativeRunPath(OUTPUT_UNIFIED_JSON)}`)
  console.log(`Unified CSV:  ${relativeRunPath(OUTPUT_UNIFIED_CSV)}`)
  console.log(`Runs parsed:  ${runRecords.length}`)
}

main()
