const { MetricsCollector, comparePerformance } = require('./metrics')
const { getStoreStats } = require('../store/vectorStore')

/**
 * Comparison utilities for evaluating RAG performance
 */

/**
 * Print comparison report
 */
function printComparisonReport(scenarioId) {
  const comparison = comparePerformance(scenarioId)

  console.log('\n' + '='.repeat(60))
  console.log(`PERFORMANCE COMPARISON: ${scenarioId}`)
  console.log('='.repeat(60))

  console.log('\nDISTILLED MODE:')
  console.log(`  Runs:              ${comparison.distilled.runs}`)
  console.log(`  Avg Attempts:      ${comparison.distilled.avgAttempts.toFixed(2)}`)
  console.log(`  Avg Duration:      ${(comparison.distilled.avgDuration / 1000).toFixed(2)} s`)
  console.log(`  Avg Store Size:    ${(comparison.distilled.avgStoreSize / 1024).toFixed(2)} KB`)
  console.log(`  Retrieval Latency: ${comparison.distilled.avgLatency.toFixed(2)} ms`)
  console.log(`  Success Rate:      ${(comparison.distilled.successRate * 100).toFixed(1)}%`)

  console.log('\nRAW MODE:')
  console.log(`  Runs:              ${comparison.raw.runs}`)
  console.log(`  Avg Attempts:      ${comparison.raw.avgAttempts.toFixed(2)}`)
  console.log(`  Avg Duration:      ${(comparison.raw.avgDuration / 1000).toFixed(2)} s`)
  console.log(`  Avg Store Size:    ${(comparison.raw.avgStoreSize / 1024).toFixed(2)} KB`)
  console.log(`  Retrieval Latency: ${comparison.raw.avgLatency.toFixed(2)} ms`)
  console.log(`  Success Rate:      ${(comparison.raw.successRate * 100).toFixed(1)}%`)

  if (comparison.distilled.runs > 0 && comparison.raw.runs > 0) {
    const attemptReduction = ((comparison.raw.avgAttempts - comparison.distilled.avgAttempts) / comparison.raw.avgAttempts * 100)
    const durationReduction = ((comparison.raw.avgDuration - comparison.distilled.avgDuration) / comparison.raw.avgDuration * 100)
    const sizeReduction = ((comparison.raw.avgStoreSize - comparison.distilled.avgStoreSize) / comparison.raw.avgStoreSize * 100)

    console.log('\nKEY METRICS:')
    console.log(`  Task Efficiency:   ${attemptReduction > 0 ? '' : '+'}${attemptReduction.toFixed(1)}% attempts `)
    console.log(`  Time to Solve:     ${durationReduction > 0 ? '' : '+'}${durationReduction.toFixed(1)}% duration `)
    console.log(`  Storage Savings:   ${sizeReduction > 0 ? '' : '+'}${sizeReduction.toFixed(1)}% size `)
    console.log(`  Compression Ratio: ${(comparison.raw.avgStoreSize / comparison.distilled.avgStoreSize).toFixed(2)}x`)
  }

  console.log('='.repeat(60) + '\n')

  return comparison
}

/**
 * Print current store statistics
 */
function printStoreStats() {
  const stats = getStoreStats()

  console.log('\nVECTOR STORE STATISTICS:')
  console.log(`  Distilled memories:  ${stats.distilledCount}`)
  console.log(`  Raw episodes:        ${stats.rawCount}`)
  console.log(`  Total entries:       ${stats.totalCount}`)
  console.log(`  Store size:          ${(stats.storeSizeBytes / 1024).toFixed(2)} KB`)
  console.log('')

  return stats
}

/**
 * Generate markdown performance report
 */
function generateMarkdownReport(scenarioId, outputPath) {
  const comparison = comparePerformance(scenarioId)
  const stats = getStoreStats()

  let md = `# RAG System Performance Report\n\n`
  md += `## Scenario: ${scenarioId}\n\n`
  md += `Generated: ${new Date().toISOString()}\n\n`

  md += `## Current Vector Store Status\n\n`
  md += `| Metric | Value |\n`
  md += `|--------|-------|\n`
  md += `| Distilled Memories | ${stats.distilledCount} |\n`
  md += `| Raw Episodes | ${stats.rawCount} |\n`
  md += `| Total Entries | ${stats.totalCount} |\n`
  md += `| Store Size | ${(stats.storeSizeBytes / 1024).toFixed(2)} KB |\n\n`

  md += `## Performance Comparison\n\n`
  md += `### Distilled Mode\n\n`
  md += `- **Runs**: ${comparison.distilled.runs}\n`
  md += `- **Avg Attempts to Solve**: ${comparison.distilled.avgAttempts.toFixed(2)}\n`
  md += `- **Avg Duration**: ${(comparison.distilled.avgDuration / 1000).toFixed(2)} seconds\n`
  md += `- **Avg Store Size**: ${(comparison.distilled.avgStoreSize / 1024).toFixed(2)} KB\n`
  md += `- **Retrieval Latency**: ${comparison.distilled.avgLatency.toFixed(2)} ms\n`
  md += `- **Success Rate**: ${(comparison.distilled.successRate * 100).toFixed(1)}%\n\n`

  md += `### Raw Mode\n\n`
  md += `- **Runs**: ${comparison.raw.runs}\n`
  md += `- **Avg Attempts to Solve**: ${comparison.raw.avgAttempts.toFixed(2)}\n`
  md += `- **Avg Duration**: ${(comparison.raw.avgDuration / 1000).toFixed(2)} seconds\n`
  md += `- **Avg Store Size**: ${(comparison.raw.avgStoreSize / 1024).toFixed(2)} KB\n`
  md += `- **Retrieval Latency**: ${comparison.raw.avgLatency.toFixed(2)} ms\n`
  md += `- **Success Rate**: ${(comparison.raw.successRate * 100).toFixed(1)}%\n\n`

  if (comparison.distilled.runs > 0 && comparison.raw.runs > 0) {
    const attemptReduction = ((comparison.raw.avgAttempts - comparison.distilled.avgAttempts) / comparison.raw.avgAttempts * 100)
    const durationReduction = ((comparison.raw.avgDuration - comparison.distilled.avgDuration) / comparison.raw.avgDuration * 100)
    const sizeReduction = ((comparison.raw.avgStoreSize - comparison.distilled.avgStoreSize) / comparison.raw.avgStoreSize * 100)
    const compressionRatio = comparison.raw.avgStoreSize / comparison.distilled.avgStoreSize

    md += `## Key Findings\n\n`
    md += `- **Task Efficiency**: ${attemptReduction.toFixed(1)}% fewer attempts (distilled)\n`
    md += `- **Time to Solve**: ${durationReduction.toFixed(1)}% faster completion (distilled)\n`
    md += `- **Storage Reduction**: ${sizeReduction.toFixed(1)}%\n`
    md += `- **Compression Ratio**: ${compressionRatio.toFixed(2)}x\n`
    md += `- **Success Rate**: Both modes ${(comparison.distilled.successRate * 100).toFixed(0)}%\n\n`
  }

  if (outputPath) {
    const fs = require('fs')
    fs.writeFileSync(outputPath, md, 'utf8')
    console.log(`Markdown report saved to: ${outputPath}`)
  }

  return md
}

module.exports = {
  printComparisonReport,
  printStoreStats,
  generateMarkdownReport
}
