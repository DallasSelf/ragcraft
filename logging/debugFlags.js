const normalize = value => String(value || '').toLowerCase().trim()

const topicList = (process.env.AGENT_DEBUG_TOPICS || '')
  .split(',')
  .map(normalize)
  .filter(Boolean)

const debugAll = /^true$|^1$|^on$/i.test(process.env.AGENT_DEBUG || '') || topicList.includes('all')
const topics = new Set(topicList)
const claimTraceEnabled = /^true$|^1$|^on$/i.test(process.env.AGENT_TRACE_CLAIMS || process.env.CLAIM_USAGE_TRACE || '')

function shouldLog(topic) {
  if (!topic) return debugAll
  return debugAll || topics.has(normalize(topic))
}

function debugLog(topic, message, details) {
  if (!shouldLog(topic)) return
  const prefix = `[agent:${normalize(topic) || 'debug'}]`
  if (details === undefined) {
    console.log(prefix, message)
    return
  }
  const payload = typeof details === 'function' ? details() : details
  console.log(prefix, message, payload)
}

function claimTrace(message, details) {
  if (!claimTraceEnabled) return
  const payload = typeof details === 'function' ? details() : details
  console.log('[agent:claim-trace]', message, payload)
}

module.exports = { debugLog, shouldLog, claimTrace }
