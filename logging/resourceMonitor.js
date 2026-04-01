const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

function ensureDir(dirPath) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function toMb(bytes) {
  if (!Number.isFinite(bytes)) return null
  return Number((bytes / (1024 * 1024)).toFixed(3))
}

function numberOrNull(value, digits = 3) {
  if (!Number.isFinite(value)) return null
  return Number(Number(value).toFixed(digits))
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function max(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  return Math.max(...values)
}

function parseGpuCsv(csvOutput) {
  if (!csvOutput || typeof csvOutput !== 'string') return null
  const lines = csvOutput
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

  const parsed = []
  for (const line of lines) {
    const parts = line.split(',').map(part => part.trim())
    if (parts.length < 3) continue
    const util = Number(parts[0])
    const used = Number(parts[1])
    const total = Number(parts[2])
    if (![util, used, total].every(Number.isFinite)) continue
    parsed.push({ util, used, total })
  }
  if (parsed.length === 0) return null

  const utilValues = parsed.map(item => item.util)
  const usedValues = parsed.map(item => item.used)
  const totalValues = parsed.map(item => item.total)

  return {
    gpu_count: parsed.length,
    gpu_util_percent: avg(utilValues),
    vram_used_mb: usedValues.reduce((sum, value) => sum + value, 0),
    vram_total_mb: totalValues.reduce((sum, value) => sum + value, 0)
  }
}

function queryNvidiaSmi() {
  return new Promise(resolve => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 800 },
      (error, stdout) => {
        if (error) {
          resolve({
            available: false,
            reason: error.code || error.message || 'nvidia-smi unavailable'
          })
          return
        }

        const parsed = parseGpuCsv(stdout)
        if (!parsed) {
          resolve({
            available: false,
            reason: 'nvidia-smi returned no parsable GPU rows'
          })
          return
        }

        resolve({
          available: true,
          ...parsed
        })
      }
    )
  })
}

class RunResourceMonitor {
  constructor(options = {}) {
    this.runDir = options.runDir || null
    this.samplingIntervalMs = Number(options.samplingIntervalMs) > 0
      ? Number(options.samplingIntervalMs)
      : 1000
    this.logger = options.logger || null

    this.samples = []
    this.startedAt = null
    this.endedAt = null
    this.intervalHandle = null
    this.sampleInFlight = null

    this.lastCpuUsage = null
    this.lastSampleHr = null
    this.cpuCount = Math.max(os.cpus().length || 1, 1)

    this.gpuProbe = {
      checked: false,
      available: false,
      reason: 'not_checked'
    }
  }

  async start() {
    if (this.intervalHandle) return
    this.startedAt = Date.now()
    this.lastCpuUsage = process.cpuUsage()
    this.lastSampleHr = process.hrtime.bigint()

    // Probe once up-front; per-sample collection is skipped when unavailable.
    this.gpuProbe = {
      checked: true,
      ...(await queryNvidiaSmi())
    }
    if (!this.gpuProbe.available && !this.gpuProbe.reason) {
      this.gpuProbe.reason = 'nvidia-smi unavailable'
    }

    await this.sampleOnce('start')
    this.intervalHandle = setInterval(() => {
      this.sampleInFlight = this.sampleOnce('interval')
        .catch(() => null)
        .finally(() => {
          this.sampleInFlight = null
        })
    }, this.samplingIntervalMs)
  }

  async stopAndWriteArtifacts() {
    this.stopSampling()
    if (this.sampleInFlight) await this.sampleInFlight

    await this.sampleOnce('stop')
    this.endedAt = Date.now()

    const summary = this.buildSummary()
    const payload = {
      started_at_iso: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      ended_at_iso: this.endedAt ? new Date(this.endedAt).toISOString() : null,
      runtime_ms: Number.isFinite(this.startedAt) && Number.isFinite(this.endedAt)
        ? this.endedAt - this.startedAt
        : null,
      sample_count: this.samples.length,
      sampling_interval_ms: this.samplingIntervalMs,
      gpu_probe: this.gpuProbe,
      samples: this.samples,
      summary
    }

    if (!this.runDir) {
      return {
        usagePath: null,
        summaryPath: null,
        summary
      }
    }

    ensureDir(this.runDir)
    const usagePath = path.join(this.runDir, 'resource_usage.json')
    const summaryPath = path.join(this.runDir, 'resource_summary.json')
    fs.writeFileSync(usagePath, JSON.stringify(payload, null, 2), 'utf8')
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

    return {
      usagePath,
      summaryPath,
      summary
    }
  }

  stopSampling() {
    if (!this.intervalHandle) return
    clearInterval(this.intervalHandle)
    this.intervalHandle = null
  }

  async sampleOnce(reason) {
    if (!this.startedAt) return

    const nowHr = process.hrtime.bigint()
    const cpuUsage = process.cpuUsage(this.lastCpuUsage)
    const elapsedMicros = Number(nowHr - this.lastSampleHr) / 1000
    this.lastCpuUsage = process.cpuUsage()
    this.lastSampleHr = nowHr

    const cpuMicros = cpuUsage.user + cpuUsage.system
    const cpuPercent = elapsedMicros > 0
      ? (cpuMicros / elapsedMicros / this.cpuCount) * 100
      : null

    const memoryUsage = process.memoryUsage()
    const sample = {
      timestamp_iso: new Date().toISOString(),
      elapsed_ms: Date.now() - this.startedAt,
      reason,
      process_cpu_percent: numberOrNull(cpuPercent),
      process_memory_rss_mb: toMb(memoryUsage.rss),
      process_memory_heap_used_mb: toMb(memoryUsage.heapUsed)
    }

    if (this.gpuProbe.available) {
      const gpuData = await queryNvidiaSmi()
      if (gpuData.available) {
        sample.gpu_util_percent = numberOrNull(gpuData.gpu_util_percent)
        sample.vram_used_mb = numberOrNull(gpuData.vram_used_mb)
        sample.vram_total_mb = numberOrNull(gpuData.vram_total_mb)
        sample.gpu_count = gpuData.gpu_count
      } else {
        sample.gpu_util_percent = null
        sample.vram_used_mb = null
        sample.vram_total_mb = null
        sample.gpu_count = null
      }
    }

    this.samples.push(sample)
    return sample
  }

  buildSummary() {
    const cpuValues = this.samples
      .map(sample => sample.process_cpu_percent)
      .filter(Number.isFinite)
    const rssValues = this.samples
      .map(sample => sample.process_memory_rss_mb)
      .filter(Number.isFinite)
    const heapValues = this.samples
      .map(sample => sample.process_memory_heap_used_mb)
      .filter(Number.isFinite)
    const gpuUtilValues = this.samples
      .map(sample => sample.gpu_util_percent)
      .filter(Number.isFinite)
    const vramUsedValues = this.samples
      .map(sample => sample.vram_used_mb)
      .filter(Number.isFinite)

    return {
      wall_clock_runtime_ms: Number.isFinite(this.startedAt) && Number.isFinite(this.endedAt)
        ? this.endedAt - this.startedAt
        : null,
      sample_count: this.samples.length,
      sampling_interval_ms: this.samplingIntervalMs,
      avg_cpu_percent: numberOrNull(avg(cpuValues)),
      max_cpu_percent: numberOrNull(max(cpuValues)),
      avg_rss_mb: numberOrNull(avg(rssValues)),
      max_rss_mb: numberOrNull(max(rssValues)),
      avg_heap_used_mb: numberOrNull(avg(heapValues)),
      max_heap_used_mb: numberOrNull(max(heapValues)),
      avg_gpu_util_percent: numberOrNull(avg(gpuUtilValues)),
      max_gpu_util_percent: numberOrNull(max(gpuUtilValues)),
      avg_vram_used_mb: numberOrNull(avg(vramUsedValues)),
      max_vram_used_mb: numberOrNull(max(vramUsedValues)),
      vram_total_mb: (() => {
        const values = this.samples
          .map(sample => sample.vram_total_mb)
          .filter(Number.isFinite)
        return numberOrNull(max(values))
      })(),
      gpu_metrics_available: this.gpuProbe.available && gpuUtilValues.length > 0,
      gpu_unavailable_reason: this.gpuProbe.available ? null : this.gpuProbe.reason || 'nvidia-smi unavailable'
    }
  }
}

function createRunResourceMonitor(options = {}) {
  return new RunResourceMonitor(options)
}

module.exports = {
  RunResourceMonitor,
  createRunResourceMonitor
}