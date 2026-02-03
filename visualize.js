const fs = require('fs')
const path = require('path')
const { loadScenarioMetrics, comparePerformance } = require('./rag/eval/metrics')

/**
 * Generate ASCII bar chart
 */
function generateBarChart(data, title, width = 50) {
  if (data.length === 0) {
    return `${title}\nNo data available\n`
  }

  const max = Math.max(...data.map(d => d.value))
  const scale = width / max

  let chart = `\n${title}\n`
  chart += '─'.repeat(width + 25) + '\n'

  data.forEach(item => {
    const barLength = Math.round(item.value * scale)
    const bar = '█'.repeat(barLength)
    const padding = ' '.repeat(Math.max(0, width - barLength))
    chart += `${item.label.padEnd(20)} │${bar}${padding}│ ${item.value.toFixed(2)}\n`
  })

  chart += '─'.repeat(width + 25) + '\n'
  return chart
}

/**
 * Generate HTML visualization with Chart.js
 */
function generateHTMLVisualization(allData) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>RagCraft Performance Visualization</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    h1 {
      color: #333;
      text-align: center;
    }
    h2 {
      color: #555;
      border-bottom: 2px solid #4CAF50;
      padding-bottom: 10px;
    }
    canvas {
      max-height: 400px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat-card {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 5px;
      border-left: 4px solid #4CAF50;
    }
    .stat-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin-top: 5px;
    }
    .export-buttons {
      text-align: center;
      margin: 20px 0;
    }
    .export-btn {
      background: #4CAF50;
      color: white;
      border: none;
      padding: 10px 20px;
      margin: 5px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
    }
    .export-btn:hover {
      background: #45a049;
    }
    .chart-container {
      position: relative;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <h1>RagCraft Performance Visualization</h1>
  
  ${allData.map((scenarioData, idx) => `
  <div class="container">
    <h2>${scenarioData.scenarioId}</h2>
    
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Avg Completion Time</div>
        <div class="stat-value">${(scenarioData.avgCompletionTime / 1000).toFixed(1)}s</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Storage Size</div>
        <div class="stat-value">${(scenarioData.avgStorageSize / 1024).toFixed(2)} KB</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Success Rate</div>
        <div class="stat-value">${(scenarioData.successRate * 100).toFixed(1)}%</div>
      </div>
    </div>

    <div class="export-buttons">
      <button class="export-btn" onclick="exportChart('chart${idx}_completion', '${scenarioData.scenarioId}_completion.png')">Export Completion Time (PNG)</button>
      <button class="export-btn" onclick="exportChart('chart${idx}_storage', '${scenarioData.scenarioId}_storage.png')">Export Storage Size (PNG)</button>
      <button class="export-btn" onclick="exportChart('chart${idx}_success', '${scenarioData.scenarioId}_success.png')">Export Success Rate (PNG)</button>
    </div>
    <div class="chart-container">
      <canvas id="chart${idx}_completion"></canvas>
    </div>
    <div class="chart-container">
      <canvas id="chart${idx}_storage"></canvas>
    </div>
    <div class="chart-container">
      <canvas id="chart${idx}_success"></canvas>
    </div>
  </div>
  `).join('')}

  <script>
    // Export function for charts
    function exportChart(canvasId, filename) {
      const canvas = document.getElementById(canvasId);
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      link.click();
    }

    // Export all charts as PDF
    function exportAllAsPDF() {
      if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
        alert('PDF export requires html2canvas and jsPDF libraries. Please ensure they are loaded.');
        return;
      }
      
      const { jsPDF } = window.jspdf;
      html2canvas(document.body).then(canvas => {
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const pageHeight = 295;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft >= 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }

        pdf.save('ragcraft_performance_report.pdf');
      });
    }

    // Add export all button
    document.addEventListener('DOMContentLoaded', function() {
      const exportAllBtn = document.createElement('button');
      exportAllBtn.className = 'export-btn';
      exportAllBtn.textContent = 'Export All as PDF';
      exportAllBtn.style.cssText = 'position: fixed; top: 10px; right: 10px; z-index: 1000;';
      exportAllBtn.onclick = exportAllAsPDF;
      document.body.appendChild(exportAllBtn);
    });
  </script>

  <script>
    ${allData.map((scenarioData, idx) => {
      const distilled = scenarioData.distilled
      const raw = scenarioData.raw
      
      return `
      // Completion Time Chart ${idx}
      new Chart(document.getElementById('chart${idx}_completion'), {
        type: 'bar',
        data: {
          labels: ['Distilled', 'Raw'],
          datasets: [{
            label: 'Avg Completion Time (ms)',
            data: [${distilled.avgDuration}, ${raw.avgDuration}],
            backgroundColor: ['#4CAF50', '#FF9800']
          }]
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: 'Task Completion Time Comparison'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Time (milliseconds)'
              }
            }
          }
        }
      });

      // Storage Size Chart ${idx}
      new Chart(document.getElementById('chart${idx}_storage'), {
        type: 'bar',
        data: {
          labels: ['Distilled', 'Raw'],
          datasets: [{
            label: 'Avg Storage Size (bytes)',
            data: [${distilled.avgStoreSize}, ${raw.avgStoreSize}],
            backgroundColor: ['#2196F3', '#FF9800']
          }]
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: 'Storage Size Comparison'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Size (bytes)'
              }
            }
          }
        }
      });

      // Success Rate Chart ${idx}
      new Chart(document.getElementById('chart${idx}_success'), {
        type: 'bar',
        data: {
          labels: ['Distilled', 'Raw'],
          datasets: [{
            label: 'Success Rate (%)',
            data: [${distilled.successRate * 100}, ${raw.successRate * 100}],
            backgroundColor: ['#4CAF50', '#FF9800']
          }]
        },
        options: {
          responsive: true,
          plugins: {
            title: {
              display: true,
              text: 'Success Rate Comparison'
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              title: {
                display: true,
                text: 'Success Rate (%)'
              }
            }
          }
        }
      });
      `
    }).join('\n')}
  </script>
</body>
</html>`

  return html
}

/**
 * Get all scenario IDs from metrics files
 */
function getAllScenarioIds() {
  const metricsDir = path.join(__dirname, 'rag/eval/runs')
  if (!fs.existsSync(metricsDir)) return []

  const files = fs.readdirSync(metricsDir)
    .filter(f => f.endsWith('.json'))

  const scenarioIds = new Set()
  const knownScenarios = ['lever_puzzle_3', 'maze_v1', 'key_finder_v1']
  
  for (const file of files) {
    let found = false
    
    for (const known of knownScenarios) {
      if (file.startsWith(known + '_')) {
        scenarioIds.add(known)
        found = true
        break
      }
    }
    
    if (!found) {
      try {
        const filePath = path.join(metricsDir, file)
        const content = fs.readFileSync(filePath, 'utf8')
        const data = JSON.parse(content)
        if (data.scenarioId) {
          scenarioIds.add(data.scenarioId)
        }
      } catch (err) {
        continue
      }
    }
  }

  return Array.from(scenarioIds)
}

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('RAGCRAFT PERFORMANCE VISUALIZATION')
  console.log('='.repeat(70))

  const scenarioIds = getAllScenarioIds()

  if (scenarioIds.length === 0) {
    console.log('\nNo evaluation data found. Run "npm run eval" first to generate metrics.\n')
    return
  }

  console.log(`\nFound ${scenarioIds.length} scenario(s): ${scenarioIds.join(', ')}\n`)

  const allData = []

  // Generate visualizations for each scenario
  for (const scenarioId of scenarioIds) {
    const comparison = comparePerformance(scenarioId)
    const metrics = loadScenarioMetrics(scenarioId)

    if (metrics.length === 0) {
      console.log(`Skipping ${scenarioId}: No metrics data\n`)
      continue
    }

    // Calculate averages
    const distilledRuns = metrics.filter(m => m.mode === 'distilled')
    const rawRuns = metrics.filter(m => m.mode === 'raw')

    const avgCompletionTime = (comparison.distilled.avgDuration + comparison.raw.avgDuration) / 2
    const avgStorageSize = (comparison.distilled.avgStoreSize + comparison.raw.avgStoreSize) / 2
    const successRate = (comparison.distilled.successRate + comparison.raw.successRate) / 2

    allData.push({
      scenarioId,
      comparison,
      avgCompletionTime,
      avgStorageSize,
      successRate,
      distilled: comparison.distilled,
      raw: comparison.raw
    })

    console.log('='.repeat(70))
    console.log(`SCENARIO: ${scenarioId.toUpperCase()}`)
    console.log('='.repeat(70))

    // Task Completion Time Chart
    console.log(generateBarChart([
      { label: 'Distilled', value: comparison.distilled.avgDuration / 1000 },
      { label: 'Raw', value: comparison.raw.avgDuration / 1000 }
    ], 'Task Completion Time (seconds)', 40))

    // Storage Size Chart
    console.log(generateBarChart([
      { label: 'Distilled', value: comparison.distilled.avgStoreSize / 1024 },
      { label: 'Raw', value: comparison.raw.avgStoreSize / 1024 }
    ], 'Storage Size (KB)', 40))

    // Success Rate Chart
    console.log(generateBarChart([
      { label: 'Distilled', value: comparison.distilled.successRate * 100 },
      { label: 'Raw', value: comparison.raw.successRate * 100 }
    ], 'Success Rate (%)', 40))

    console.log('\nSummary:')
    console.log(`  Completion Time: Distilled ${(comparison.distilled.avgDuration / 1000).toFixed(2)}s vs Raw ${(comparison.raw.avgDuration / 1000).toFixed(2)}s`)
    console.log(`  Storage Size: Distilled ${(comparison.distilled.avgStoreSize / 1024).toFixed(2)} KB vs Raw ${(comparison.raw.avgStoreSize / 1024).toFixed(2)} KB`)
    console.log(`  Success Rate: Distilled ${(comparison.distilled.successRate * 100).toFixed(1)}% vs Raw ${(comparison.raw.successRate * 100).toFixed(1)}%\n`)
  }

  // Generate HTML visualization
  if (allData.length > 0) {
    const htmlPath = path.join(__dirname, 'rag', 'eval', 'visualization.html')
    const htmlDir = path.dirname(htmlPath)
    if (!fs.existsSync(htmlDir)) {
      fs.mkdirSync(htmlDir, { recursive: true })
    }
    
    const html = generateHTMLVisualization(allData)
    fs.writeFileSync(htmlPath, html, 'utf8')
    
    console.log('='.repeat(70))
    console.log('HTML Visualization Generated')
    console.log('='.repeat(70))
    console.log(`\nOpen ${htmlPath} in your browser to view interactive charts.\n`)
  }

  // Cross-scenario comparison
  if (allData.length > 1) {
    console.log('='.repeat(70))
    console.log('CROSS-SCENARIO COMPARISON')
    console.log('='.repeat(70))

    // Average completion time across scenarios
    const completionData = allData.map(d => ({
      label: d.scenarioId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: d.avgCompletionTime / 1000
    }))
    console.log(generateBarChart(completionData, 'Average Completion Time Across Scenarios (seconds)', 40))

    // Average storage size across scenarios
    const storageData = allData.map(d => ({
      label: d.scenarioId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: d.avgStorageSize / 1024
    }))
    console.log(generateBarChart(storageData, 'Average Storage Size Across Scenarios (KB)', 40))

    // Average success rate across scenarios
    const successData = allData.map(d => ({
      label: d.scenarioId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: d.successRate * 100
    }))
    console.log(generateBarChart(successData, 'Average Success Rate Across Scenarios (%)', 40))
  }
}

main().catch(err => {
  console.error('Visualization failed:', err)
  process.exit(1)
})

