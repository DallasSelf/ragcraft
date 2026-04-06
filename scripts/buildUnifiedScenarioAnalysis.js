const fs = require('fs')
const path = require('path')

const REPO_ROOT = process.cwd()
const RUNS_ROOT = path.join(REPO_ROOT, 'runs')
const ANALYSIS_ROOT = path.join(REPO_ROOT, 'analysis')

const SCENARIOS = ['lever', 'maze', 'key']
const CONDITIONS = [
  { name: 'baseline_raw', modeFolder: 'raw' },
  { name: 'raw_memory', modeFolder: 'distilled' },
  { name: 'distilled_memory', modeFolder: 'distilled' }
]

const REQUIRED_ARTIFACTS = [
  'metrics.json',
  'summary.json',
  'events.jsonl',
  'resource_usage.json',
  'resource_summary.json'
]

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function toNumOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function readJsonSafe(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8')
    return { data: JSON.parse(txt), error: null }
  } catch (err) {
    return { data: null, error: String(err && err.message ? err.message : err) }
  }
}

function listRunDirs(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(root, d.name))
    .sort()
}

function detectTrialIndex(runLabel) {
  if (!runLabel) return null
  const m = String(runLabel).match(/_(\d{3})$/)
  if (!m) return null
  const idx = Number(m[1])
  return Number.isFinite(idx) ? idx : null
}

function detectWindowLabel(trialIndex) {
  if (!Number.isFinite(trialIndex)) return null
  const w = WINDOWS.find(win => trialIndex >= win.start && trialIndex <= win.end)
  return w ? w.label : null
}

function mean(values) {
  const nums = values.filter(Number.isFinite)
  if (nums.length === 0) return null
  const sum = nums.reduce((acc, n) => acc + n, 0)
  return sum / nums.length
}

function median(values) {
  const nums = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (nums.length === 0) return null
  const mid = Math.floor(nums.length / 2)
  if (nums.length % 2 === 1) return nums[mid]
  return (nums[mid - 1] + nums[mid]) / 2
}

function rate(boolValues) {
  if (!boolValues || boolValues.length === 0) return null
  const ones = boolValues.filter(Boolean).length
  return ones / boolValues.length
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return '"' + JSON.stringify(value).replace(/"/g, '""') + '"'
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function writeCsv(filePath, rows) {
  ensureDir(path.dirname(filePath))
  if (!rows || rows.length === 0) {
    fs.writeFileSync(filePath, '', 'utf8')
    return
  }
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach(k => set.add(k))
    return set
  }, new Set()))

  const lines = [keys.join(',')]
  for (const row of rows) {
    lines.push(keys.map(k => csvEscape(row[k])).join(','))
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8')
}

function attemptHistogram(rows, useCorrected) {
  const hist = {}
  for (const r of rows) {
    const value = useCorrected ? r.corrected_attempts : r.attempts
    if (!Number.isFinite(value)) continue
    const key = String(value)
    hist[key] = (hist[key] || 0) + 1
  }
  return hist
}

function pickSpotcheckRows(rows) {
  const out = []
  const sorted = rows.slice().sort((a, b) => (a.trial_index || 9999) - (b.trial_index || 9999))
  if (sorted.length > 0) out.push(sorted[0])
  if (sorted.length > 1) out.push(sorted[1])
  if (sorted.length > 99) out.push(sorted[99])
  if (sorted.length > 1) out.push(sorted[sorted.length - 2])
  if (sorted.length > 0) out.push(sorted[sorted.length - 1])

  const uniq = []
  const seen = new Set()
  for (const row of out) {
    if (!row) continue
    if (seen.has(row.run_path)) continue
    seen.add(row.run_path)
    uniq.push(row)
  }
  return uniq
}

function buildDataset() {
  const mergedRows = []
  const issues = []
  const coverage = {}
  const spotchecks = {}

  for (const scenario of SCENARIOS) {
    coverage[scenario] = {}
    spotchecks[scenario] = {}

    for (const cond of CONDITIONS) {
      const conditionName = cond.name
      const prefix = `${scenario}_${conditionName}_`
      const root = path.join(RUNS_ROOT, scenario, cond.modeFolder)

      const runDirs = listRunDirs(root)
      const condRows = []
      const trialSet = new Set()

      for (const runDir of runDirs) {
        const relRunPath = path.relative(REPO_ROOT, runDir).replace(/\\/g, '/')

        const missingArtifacts = REQUIRED_ARTIFACTS.filter(name => {
          return !fs.existsSync(path.join(runDir, name))
        })

        const summaryPath = path.join(runDir, 'summary.json')
        if (!fs.existsSync(summaryPath)) {
          if (missingArtifacts.length > 0) {
            issues.push({
              scenario,
              condition_name: conditionName,
              run_path: relRunPath,
              issue_type: 'missing_artifacts',
              details: { missing_artifacts: missingArtifacts }
            })
          }
          continue
        }

        const summaryJson = readJsonSafe(summaryPath)
        if (!summaryJson.data) {
          issues.push({
            scenario,
            condition_name: conditionName,
            run_path: relRunPath,
            issue_type: 'malformed_summary_json',
            details: { error: summaryJson.error }
          })
          continue
        }

        const summary = summaryJson.data
        const runLabel = summary?.metadata?.run_label || summary?.run_label || null
        if (!runLabel || !String(runLabel).startsWith(prefix)) {
          continue
        }

        if (missingArtifacts.length > 0) {
          issues.push({
            scenario,
            condition_name: conditionName,
            run_path: relRunPath,
            run_label: runLabel,
            issue_type: 'missing_artifacts',
            details: { missing_artifacts: missingArtifacts }
          })
        }

        const resourceSummaryPath = path.join(runDir, 'resource_summary.json')
        const rsJson = readJsonSafe(resourceSummaryPath)
        const rs = rsJson.data || {}
        if (!rsJson.data) {
          issues.push({
            scenario,
            condition_name: conditionName,
            run_path: relRunPath,
            run_label: runLabel,
            issue_type: 'malformed_resource_summary_json',
            details: { error: rsJson.error }
          })
        }

        const eventualSuccess = summary.success === true
        const attempts = toNumOrNull(summary.attempts)
        const correctedAttempts = scenario === 'lever' && eventualSuccess && Number.isFinite(attempts)
          ? attempts + 1
          : (scenario === 'lever' ? attempts : null)

        const attemptsForFirstAttempt = scenario === 'lever' ? correctedAttempts : attempts
        const firstAttemptSuccess = Number.isFinite(attemptsForFirstAttempt)
          ? (eventualSuccess && attemptsForFirstAttempt === 1)
          : null

        const trialIndex = detectTrialIndex(runLabel)
        if (Number.isFinite(trialIndex)) trialSet.add(trialIndex)

        const row = {
          scenario,
          condition_name: conditionName,
          run_id: summary.run_id || path.basename(runDir),
          run_label: runLabel,
          run_path: relRunPath,
          trial_index: trialIndex,
          window_label: detectWindowLabel(trialIndex),
          eventual_success: eventualSuccess,
          first_attempt_success: firstAttemptSuccess,
          attempts,
          corrected_attempts: correctedAttempts,
          duration_seconds: toNumOrNull(summary.duration_seconds),
          runtime_ms: toNumOrNull(rs.wall_clock_runtime_ms),
          avg_cpu_percent: toNumOrNull(rs.avg_cpu_percent),
          max_cpu_percent: toNumOrNull(rs.max_cpu_percent),
          avg_rss_mb: toNumOrNull(rs.avg_rss_mb),
          max_rss_mb: toNumOrNull(rs.max_rss_mb),
          avg_heap_used_mb: toNumOrNull(rs.avg_heap_used_mb),
          max_heap_used_mb: toNumOrNull(rs.max_heap_used_mb),
          avg_gpu_util_percent: toNumOrNull(rs.avg_gpu_util_percent),
          max_gpu_util_percent: toNumOrNull(rs.max_gpu_util_percent),
          avg_vram_used_mb: toNumOrNull(rs.avg_vram_used_mb),
          max_vram_used_mb: toNumOrNull(rs.max_vram_used_mb),
          sample_count: toNumOrNull(rs.sample_count)
        }

        condRows.push(row)
        mergedRows.push(row)
      }

      condRows.sort((a, b) => (a.trial_index || 9999) - (b.trial_index || 9999))

      coverage[scenario][conditionName] = {
        run_count: condRows.length,
        unique_trial_count: trialSet.size,
        expected_runs: 200,
        expected_met: condRows.length === 200 && trialSet.size === 200
      }

      const spotRows = pickSpotcheckRows(condRows)
      const spotResult = []
      for (const row of spotRows) {
        const runAbs = path.join(REPO_ROOT, row.run_path)
        const missing = REQUIRED_ARTIFACTS.filter(name => !fs.existsSync(path.join(runAbs, name)))
        spotResult.push({
          scenario,
          condition_name: conditionName,
          run_label: row.run_label,
          run_path: row.run_path,
          missing_artifacts: missing,
          pass: missing.length === 0
        })
      }
      spotchecks[scenario][conditionName] = spotResult
    }
  }

  mergedRows.sort((a, b) => {
    if (a.scenario !== b.scenario) return a.scenario.localeCompare(b.scenario)
    if (a.condition_name !== b.condition_name) return a.condition_name.localeCompare(b.condition_name)
    return (a.trial_index || 9999) - (b.trial_index || 9999)
  })

  return { mergedRows, coverage, spotchecks, issues }
}

function summarizeWindows(rows, scenario) {
  const out = []
  for (const cond of CONDITIONS) {
    const condRows = rows.filter(r => r.scenario === scenario && r.condition_name === cond.name)
    const useCorrected = scenario === 'lever'

    for (const w of WINDOWS) {
      const slice = condRows.filter(r => Number.isFinite(r.trial_index) && r.trial_index >= w.start && r.trial_index <= w.end)

      const attemptsValues = useCorrected
        ? slice.map(r => r.corrected_attempts)
        : slice.map(r => r.attempts)

      out.push({
        scenario,
        condition_name: cond.name,
        window_label: w.label,
        window_start: w.start,
        window_end: w.end,
        run_count: slice.length,
        eventual_success_rate: rate(slice.map(r => r.eventual_success === true)),
        first_attempt_success_rate: rate(slice.filter(r => r.first_attempt_success !== null).map(r => r.first_attempt_success === true)),
        mean_attempts: mean(slice.map(r => r.attempts)),
        median_attempts: median(slice.map(r => r.attempts)),
        mean_corrected_attempts: mean(slice.map(r => r.corrected_attempts)),
        median_corrected_attempts: median(slice.map(r => r.corrected_attempts)),
        mean_attempt_value: mean(attemptsValues),
        median_attempt_value: median(attemptsValues),
        mean_runtime: mean(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : (Number.isFinite(r.duration_seconds) ? r.duration_seconds * 1000 : null))),
        median_runtime: median(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : (Number.isFinite(r.duration_seconds) ? r.duration_seconds * 1000 : null))),
        mean_avg_cpu_percent: mean(slice.map(r => r.avg_cpu_percent)),
        mean_avg_rss_mb: mean(slice.map(r => r.avg_rss_mb)),
        mean_avg_gpu_util_percent: mean(slice.map(r => r.avg_gpu_util_percent)),
        mean_avg_vram_used_mb: mean(slice.map(r => r.avg_vram_used_mb))
      })
    }
  }
  return out
}

function summarizeConditions(rows, scenario) {
  const out = []
  for (const cond of CONDITIONS) {
    const slice = rows.filter(r => r.scenario === scenario && r.condition_name === cond.name)
    const useCorrected = scenario === 'lever'
    const attemptsValues = useCorrected
      ? slice.map(r => r.corrected_attempts)
      : slice.map(r => r.attempts)

    out.push({
      scenario,
      condition_name: cond.name,
      run_count: slice.length,
      eventual_success_rate: rate(slice.map(r => r.eventual_success === true)),
      first_attempt_success_rate: rate(slice.filter(r => r.first_attempt_success !== null).map(r => r.first_attempt_success === true)),
      mean_attempts: mean(slice.map(r => r.attempts)),
      median_attempts: median(slice.map(r => r.attempts)),
      mean_corrected_attempts: mean(slice.map(r => r.corrected_attempts)),
      median_corrected_attempts: median(slice.map(r => r.corrected_attempts)),
      mean_attempt_value: mean(attemptsValues),
      median_attempt_value: median(attemptsValues),
      attempt_histogram: attemptHistogram(slice, useCorrected),
      mean_runtime: mean(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : (Number.isFinite(r.duration_seconds) ? r.duration_seconds * 1000 : null))),
      median_runtime: median(slice.map(r => Number.isFinite(r.runtime_ms) ? r.runtime_ms : (Number.isFinite(r.duration_seconds) ? r.duration_seconds * 1000 : null)))
    })
  }
  return out
}

function writeAllOutputs(dataset) {
  const { mergedRows, coverage, spotchecks, issues } = dataset
  ensureDir(ANALYSIS_ROOT)

  const allMergedCsv = path.join(ANALYSIS_ROOT, 'all_runs_merged.csv')
  const allMergedJson = path.join(ANALYSIS_ROOT, 'all_runs_merged.json')
  writeCsv(allMergedCsv, mergedRows)
  fs.writeFileSync(allMergedJson, JSON.stringify(mergedRows, null, 2), 'utf8')

  const written = [allMergedCsv, allMergedJson]

  for (const scenario of SCENARIOS) {
    const scenarioDir = path.join(ANALYSIS_ROOT, scenario)
    ensureDir(scenarioDir)
    const scenarioRows = mergedRows.filter(r => r.scenario === scenario)

    const runsCsv = path.join(scenarioDir, `${scenario}_runs_merged.csv`)
    const runsJson = path.join(scenarioDir, `${scenario}_runs_merged.json`)
    writeCsv(runsCsv, scenarioRows)
    fs.writeFileSync(runsJson, JSON.stringify(scenarioRows, null, 2), 'utf8')

    const windowRows = summarizeWindows(mergedRows, scenario)
    const winCsv = path.join(scenarioDir, `${scenario}_window_summary.csv`)
    const winJson = path.join(scenarioDir, `${scenario}_window_summary.json`)
    writeCsv(winCsv, windowRows)
    fs.writeFileSync(winJson, JSON.stringify(windowRows, null, 2), 'utf8')

    const conditionRows = summarizeConditions(mergedRows, scenario)
    const condCsv = path.join(scenarioDir, `${scenario}_condition_summary.csv`)
    const condJson = path.join(scenarioDir, `${scenario}_condition_summary.json`)
    writeCsv(condCsv, conditionRows)
    fs.writeFileSync(condJson, JSON.stringify(conditionRows, null, 2), 'utf8')

    written.push(runsCsv, runsJson, winCsv, winJson, condCsv, condJson)
  }

  const verificationPath = path.join(ANALYSIS_ROOT, 'dataset_verification.json')
  const issuesPath = path.join(ANALYSIS_ROOT, 'artifact_issues.json')
  const spotPath = path.join(ANALYSIS_ROOT, 'artifact_spotcheck.json')

  fs.writeFileSync(verificationPath, JSON.stringify(coverage, null, 2), 'utf8')
  fs.writeFileSync(issuesPath, JSON.stringify(issues, null, 2), 'utf8')
  fs.writeFileSync(spotPath, JSON.stringify(spotchecks, null, 2), 'utf8')

  written.push(verificationPath, issuesPath, spotPath)
  return written
}

function main() {
  const dataset = buildDataset()
  const written = writeAllOutputs(dataset)

  console.log(`TOTAL_MERGED_ROWS=${dataset.mergedRows.length}`)
  console.log(`TOTAL_ISSUE_COUNT=${dataset.issues.length}`)

  for (const scenario of SCENARIOS) {
    for (const cond of CONDITIONS) {
      const c = dataset.coverage[scenario][cond.name]
      console.log(`COUNT_${scenario.toUpperCase()}_${cond.name.toUpperCase()}=${c.run_count}`)
      console.log(`TRIALS_${scenario.toUpperCase()}_${cond.name.toUpperCase()}=${c.unique_trial_count}`)
      console.log(`EXPECTED_MET_${scenario.toUpperCase()}_${cond.name.toUpperCase()}=${c.expected_met}`)
    }
  }

  const spotFailures = []
  for (const scenario of SCENARIOS) {
    for (const cond of CONDITIONS) {
      for (const row of dataset.spotchecks[scenario][cond.name]) {
        if (!row.pass) spotFailures.push(row)
      }
    }
  }
  console.log(`SPOTCHECK_FAILURE_COUNT=${spotFailures.length}`)

  for (const p of written) {
    console.log(`WROTE=${path.relative(REPO_ROOT, p).replace(/\\/g, '/')}`)
  }
}

main()
