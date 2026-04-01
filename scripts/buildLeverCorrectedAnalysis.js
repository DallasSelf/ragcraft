const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')
const RAW_ROOT = path.join(REPO_ROOT, 'runs', 'lever', 'raw')
const DIST_ROOT = path.join(REPO_ROOT, 'runs', 'lever', 'distilled')
const OUT_DIR = path.join(REPO_ROOT, 'analysis', 'lever')

const WINDOWS = [
  { label: '1-25', start: 1, end: 25 },
  { label: '26-50', start: 26, end: 50 },
  { label: '51-75', start: 51, end: 75 },
  { label: '76-100', start: 76, end: 100 },
  { label: '101-125', start: 101, end: 125 },
  { label: '126-150', start: 126, end: 150 },
  { label: '151-175', start: 151, end: 175 },
  { label: '176-200', start: 176, end: 200 }
]

const CONDITIONS = [
  { name: 'baseline_raw', root: RAW_ROOT, prefix: 'lever_baseline_raw_', modeFolder: 'raw' },
  { name: 'raw_memory', root: DIST_ROOT, prefix: 'lever_raw_memory_', modeFolder: 'distilled' },
  { name: 'distilled_memory', root: DIST_ROOT, prefix: 'lever_distilled_memory_', modeFolder: 'distilled' }
]

const REQUIRED_ARTIFACTS = [
  'metrics.json',
  'summary.json',
  'events.jsonl',
  'resource_usage.json',
  'resource_summary.json'
]

function toNumOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mean(values) {
  const arr = values.filter(v => Number.isFinite(v))
  if (arr.length === 0) return null
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4))
}

function median(values) {
  const arr = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  if (arr.length === 0) return null
  const mid = Math.floor(arr.length / 2)
  if (arr.length % 2 === 1) return arr[mid]
  return Number(((arr[mid - 1] + arr[mid]) / 2).toFixed(4))
}

function rate(values) {
  const arr = values.filter(v => v === 0 || v === 1)
  if (arr.length === 0) return null
  return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4))
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function detectTrialIndex(runLabel) {
  const m = String(runLabel || '').match(/_(\d{3})$/)
  return m ? Number(m[1]) : null
}

function detectWindowLabel(trialIndex) {
  if (!Number.isFinite(trialIndex)) return null
  const win = WINDOWS.find(w => trialIndex >= w.start && trialIndex <= w.end)
  return win ? win.label : null
}

function listRunDirs(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(root, e.name))
    .sort()
}

function buildRowsAndIssues() {
  const rows = []
  const issues = []

  for (const cond of CONDITIONS) {
    const runDirs = listRunDirs(cond.root)
    for (const runDir of runDirs) {
      const summaryPath = path.join(runDir, 'summary.json')
      const resourceSummaryPath = path.join(runDir, 'resource_summary.json')

      const missing = REQUIRED_ARTIFACTS.filter(f => !fs.existsSync(path.join(runDir, f)))
      if (missing.length > 0) {
        issues.push({
          condition_name: cond.name,
          run_path: path.relative(REPO_ROOT, runDir).replace(/\\/g, '/'),
          issue: 'missing_artifacts',
          detail: missing.join(',')
        })
      }

      const summary = readJsonSafe(summaryPath)
      if (!summary || typeof summary !== 'object') continue
      const metadata = summary.metadata && typeof summary.metadata === 'object' ? summary.metadata : {}
      const runLabel = metadata.run_label || null
      if (!runLabel || !String(runLabel).startsWith(cond.prefix)) continue

      const success = summary.success === true
      const storedAttempts = toNumOrNull(summary.attempts)
      const correctedAttempts = (success && Number.isFinite(storedAttempts))
        ? storedAttempts + 1
        : storedAttempts
      const firstAttemptSuccess = success && correctedAttempts === 1

      const resourceSummary = readJsonSafe(resourceSummaryPath) || {}
      const runtimeMs = toNumOrNull(resourceSummary.wall_clock_runtime_ms)
      const durationSeconds = toNumOrNull(summary.duration_seconds)

      const trialIndex = detectTrialIndex(runLabel)
      const windowLabel = detectWindowLabel(trialIndex)

      rows.push({
        scenario: summary.scenario || 'lever',
        mode_folder: cond.modeFolder,
        condition_name: cond.name,
        run_id: summary.run_id || path.basename(runDir),
        run_label: runLabel,
        run_path: path.relative(REPO_ROOT, runDir).replace(/\\/g, '/'),
        trial_index: trialIndex,
        window_label: windowLabel,
        eventual_success: success,
        first_attempt_success: firstAttemptSuccess,
        stored_attempts: storedAttempts,
        corrected_attempts: correctedAttempts,
        duration_seconds: durationSeconds,
        runtime_ms: runtimeMs
      })
    }
  }

  return { rows, issues }
}

function summarizeWindows(rows) {
  const out = []
  for (const cond of CONDITIONS) {
    const condRows = rows.filter(r => r.condition_name === cond.name)
    for (const w of WINDOWS) {
      const slice = condRows
        .filter(r => Number.isFinite(r.trial_index) && r.trial_index >= w.start && r.trial_index <= w.end)
        .sort((a, b) => a.trial_index - b.trial_index)

      out.push({
        scenario: 'lever',
        condition_name: cond.name,
        window_label: w.label,
        window_start: w.start,
        window_end: w.end,
        run_count: slice.length,
        eventual_success_rate: rate(slice.map(r => r.eventual_success ? 1 : 0)),
        first_attempt_success_rate: rate(slice.map(r => r.first_attempt_success ? 1 : 0)),
        mean_corrected_attempts: mean(slice.map(r => r.corrected_attempts)),
        median_corrected_attempts: median(slice.map(r => r.corrected_attempts)),
        mean_runtime: mean(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : r.duration_seconds)),
        median_runtime: median(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : r.duration_seconds))
      })
    }
  }
  return out
}

function summarizeConditions(rows) {
  const out = []
  for (const cond of CONDITIONS) {
    const slice = rows
      .filter(r => r.condition_name === cond.name)
      .sort((a, b) => (a.trial_index || 9999) - (b.trial_index || 9999))

    const hist = {}
    for (const row of slice) {
      if (!Number.isFinite(row.corrected_attempts)) continue
      const key = String(row.corrected_attempts)
      hist[key] = (hist[key] || 0) + 1
    }

    out.push({
      scenario: 'lever',
      condition_name: cond.name,
      run_count: slice.length,
      eventual_success_rate: rate(slice.map(r => r.eventual_success ? 1 : 0)),
      first_attempt_success_rate: rate(slice.map(r => r.first_attempt_success ? 1 : 0)),
      mean_corrected_attempts: mean(slice.map(r => r.corrected_attempts)),
      median_corrected_attempts: median(slice.map(r => r.corrected_attempts)),
      attempt_histogram: hist,
      mean_runtime: mean(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : r.duration_seconds)),
      median_runtime: median(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : r.duration_seconds))
    })
  }
  return out
}

function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, '', 'utf8')
    return
  }
  const columns = Object.keys(rows[0])
  const lines = [columns.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(columns.map(c => {
      const v = row[c]
      if (v && typeof v === 'object' && !Array.isArray(v)) return csvEscape(JSON.stringify(v))
      return csvEscape(v)
    }).join(','))
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8')
}

function main() {
  ensureDir(OUT_DIR)

  const { rows, issues } = buildRowsAndIssues()
  rows.sort((a, b) => {
    if (a.condition_name !== b.condition_name) return a.condition_name.localeCompare(b.condition_name)
    const ai = Number.isFinite(a.trial_index) ? a.trial_index : 9999
    const bi = Number.isFinite(b.trial_index) ? b.trial_index : 9999
    if (ai !== bi) return ai - bi
    return String(a.run_id).localeCompare(String(b.run_id))
  })

  const windowSummary = summarizeWindows(rows)
  const conditionSummary = summarizeConditions(rows)

  const mergedCsv = path.join(OUT_DIR, 'lever_runs_merged_corrected.csv')
  const mergedJson = path.join(OUT_DIR, 'lever_runs_merged_corrected.json')
  const winCsv = path.join(OUT_DIR, 'lever_window_summary_corrected.csv')
  const winJson = path.join(OUT_DIR, 'lever_window_summary_corrected.json')
  const condCsv = path.join(OUT_DIR, 'lever_condition_summary_corrected.csv')
  const condJson = path.join(OUT_DIR, 'lever_condition_summary_corrected.json')

  writeCsv(mergedCsv, rows)
  fs.writeFileSync(mergedJson, JSON.stringify(rows, null, 2), 'utf8')
  writeCsv(winCsv, windowSummary)
  fs.writeFileSync(winJson, JSON.stringify(windowSummary, null, 2), 'utf8')
  writeCsv(condCsv, conditionSummary)
  fs.writeFileSync(condJson, JSON.stringify(conditionSummary, null, 2), 'utf8')

  const coverage = {}
  for (const cond of CONDITIONS) {
    const trials = new Set(rows
      .filter(r => r.condition_name === cond.name && Number.isFinite(r.trial_index))
      .map(r => r.trial_index))
    coverage[cond.name] = trials.size
  }

  const firstAttemptRates = Object.fromEntries(conditionSummary.map(c => [c.condition_name, c.first_attempt_success_rate]))
  const attemptsStats = Object.fromEntries(conditionSummary.map(c => [c.condition_name, {
    mean: c.mean_corrected_attempts,
    median: c.median_corrected_attempts
  }]))

  console.log(`WROTE_MERGED_CSV=${path.relative(REPO_ROOT, mergedCsv).replace(/\\/g, '/')}`)
  console.log(`WROTE_MERGED_JSON=${path.relative(REPO_ROOT, mergedJson).replace(/\\/g, '/')}`)
  console.log(`WROTE_WINDOW_CSV=${path.relative(REPO_ROOT, winCsv).replace(/\\/g, '/')}`)
  console.log(`WROTE_WINDOW_JSON=${path.relative(REPO_ROOT, winJson).replace(/\\/g, '/')}`)
  console.log(`WROTE_CONDITION_CSV=${path.relative(REPO_ROOT, condCsv).replace(/\\/g, '/')}`)
  console.log(`WROTE_CONDITION_JSON=${path.relative(REPO_ROOT, condJson).replace(/\\/g, '/')}`)
  console.log(`TOTAL_ROWS=${rows.length}`)
  console.log(`ISSUE_COUNT=${issues.length}`)
  console.log(`COVERAGE_BASELINE_RAW=${coverage.baseline_raw || 0}`)
  console.log(`COVERAGE_RAW_MEMORY=${coverage.raw_memory || 0}`)
  console.log(`COVERAGE_DISTILLED_MEMORY=${coverage.distilled_memory || 0}`)
  console.log(`FIRST_ATTEMPT_RATES=${JSON.stringify(firstAttemptRates)}`)
  console.log(`ATTEMPT_STATS=${JSON.stringify(attemptsStats)}`)
}

main()
