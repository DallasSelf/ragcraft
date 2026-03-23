async function loadData() {
  const res = await fetch('/rag/eval/reporting/scenario_mode_summary.json', { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Failed to load summary dataset (${res.status})`)
  }
  return res.json()
}

function modeIndex(rows) {
  const out = {}
  for (const row of rows) {
    if (!out[row.scenarioId]) out[row.scenarioId] = {}
    out[row.scenarioId][row.mode] = row
  }
  return out
}

function formatPct(v) {
  if (typeof v !== 'number') return 'n/a'
  return `${(v * 100).toFixed(1)}%`
}

function formatNum(v) {
  if (typeof v !== 'number') return 'n/a'
  return v.toFixed(3).replace(/\.000$/, '')
}

function statusBadge(status) {
  if (status === 'reconnaissance_producer') return '<span class="badge badge-intel">recon producer</span>'
  if (status === 'experimental_open') return '<span class="badge badge-open">experimental/open</span>'
  if (status === 'validated_comparison') return '<span class="badge badge-ok">validated comparison</span>'
  if (status === 'supporting_scenario') return '<span class="badge badge-ok">supporting scenario</span>'
  return '<span class="badge badge-ok">standard</span>'
}

function renderCards(summaryRows, statuses) {
  const cardsValidated = document.getElementById('cardsValidated')
  const cardsSupporting = document.getElementById('cardsSupporting')
  const cardsRecon = document.getElementById('cardsRecon')
  const cardsOpen = document.getElementById('cardsOpen')
  cardsValidated.innerHTML = ''
  cardsSupporting.innerHTML = ''
  cardsRecon.innerHTML = ''
  cardsOpen.innerHTML = ''

  const byScenario = modeIndex(summaryRows)
  const scenarioIds = Object.keys(byScenario).sort()

  for (const scenarioId of scenarioIds) {
    const raw = byScenario[scenarioId].raw || null
    const distilled = byScenario[scenarioId].distilled || null
    const status = statuses.find(s => s.scenarioId === scenarioId)
    const badge = statusBadge(status ? status.status : null)

    const div = document.createElement('article')
    div.className = 'card'
    div.innerHTML = `
      <h3>${scenarioId} ${badge}</h3>
      <div class="kv">
        <span>Raw run count</span><span>${raw ? raw.runCount : 0}</span>
        <span>Distilled run count</span><span>${distilled ? distilled.runCount : 0}</span>
        <span>Raw success rate</span><span>${raw ? formatPct(raw.successRate) : 'n/a'}</span>
        <span>Distilled success rate</span><span>${distilled ? formatPct(distilled.successRate) : 'n/a'}</span>
        <span>Raw avg attempts</span><span>${raw ? formatNum(raw.averageAttempts) : 'n/a'}</span>
        <span>Distilled avg attempts</span><span>${distilled ? formatNum(distilled.averageAttempts) : 'n/a'}</span>
        <span>Raw avg duration (ms)</span><span>${raw ? formatNum(raw.averageDurationMs) : 'n/a'}</span>
        <span>Distilled avg duration (ms)</span><span>${distilled ? formatNum(distilled.averageDurationMs) : 'n/a'}</span>
      </div>
    `
    const statusCode = status ? status.status : null
    if (statusCode === 'validated_comparison') {
      cardsValidated.appendChild(div)
      continue
    }
    if (statusCode === 'supporting_scenario') {
      cardsSupporting.appendChild(div)
      continue
    }
    if (statusCode === 'reconnaissance_producer') {
      cardsRecon.appendChild(div)
      continue
    }
    cardsOpen.appendChild(div)
  }
}

function buildChartData(summaryRows, field) {
  const byScenario = modeIndex(summaryRows)
  const scenarios = Object.keys(byScenario).sort()

  return {
    labels: scenarios,
    distilled: scenarios.map(id => byScenario[id].distilled && typeof byScenario[id].distilled[field] === 'number' ? byScenario[id].distilled[field] : 0),
    raw: scenarios.map(id => byScenario[id].raw && typeof byScenario[id].raw[field] === 'number' ? byScenario[id].raw[field] : 0)
  }
}

function renderBarChart(canvasId, data, yLabel) {
  new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        { label: 'Distilled', data: data.distilled, backgroundColor: '#2f7f4f' },
        { label: 'Raw', data: data.raw, backgroundColor: '#be5a38' }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: yLabel
          }
        }
      }
    }
  })
}

function renderMeta(data) {
  const meta = document.getElementById('meta')
  meta.textContent = `Generated: ${data.generatedAt} | Runs parsed: ${data.sourceOfTruth.parsedRuns} | Files parsed: ${data.sourceOfTruth.parsedJsonlFiles}`
}

function renderPolicyAudit(data) {
  const mount = document.getElementById('policyAudit')
  if (!mount) return
  const policy = data && data.policyAudit ? data.policyAudit : null
  if (!policy) {
    mount.innerHTML = ''
    return
  }

  const raw = policy.raw_stays_blind_to_scout_recon
  const distilled = policy.distilled_can_access_eligible_scout_recon
  const rawLabel = raw === true ? 'OK' : raw === false ? 'Check' : 'n/a'
  const distilledLabel = distilled === true ? 'OK' : distilled === false ? 'Check' : 'n/a'

  mount.innerHTML = `
    <p class="policy-line">Policy audit: raw stays blind to scout recon <span class="policy-badge">${rawLabel}</span> | distilled can access eligible scout recon <span class="policy-badge">${distilledLabel}</span></p>
  `
}

async function main() {
  try {
    const data = await loadData()
    renderMeta(data)
    renderPolicyAudit(data)
    renderCards(data.groupedSummary, data.scenarioStatus || [])
    renderBarChart('chartSuccess', buildChartData(data.groupedSummary, 'successRate'), 'Success rate')
    renderBarChart('chartAttempts', buildChartData(data.groupedSummary, 'averageAttempts'), 'Average attempts')
    renderBarChart('chartDuration', buildChartData(data.groupedSummary, 'averageDurationMs'), 'Average duration (ms)')
  } catch (err) {
    const cardsValidated = document.getElementById('cardsValidated')
    cardsValidated.innerHTML = `<article class="card"><h3>Dataset not found</h3><p>${err.message}</p><p>Run report generation first.</p></article>`
  }
}

main()
