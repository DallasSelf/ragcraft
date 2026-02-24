// Lever sequence selection utilities for puzzle agent

function sequencesEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function permute(values) {
  const result = []
  function backtrack(path, remaining) {
    if (remaining.length === 0) {
      result.push(path)
      return
    }
    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i]
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1))
      backtrack(path.concat(next), rest)
    }
  }
  backtrack([], values)
  return result
}

function parseNumbersFromFragment(fragment) {
  if (typeof fragment !== 'string') return null
  const numbers = fragment
    .split(/[^0-9]+/)
    .map(n => Number(n))
    .filter(n => Number.isFinite(n))
  return numbers.length ? numbers : null
}

function parseSequenceFromText(text) {
  if (typeof text !== 'string' || text.length === 0) return null

  const patterns = [
    /sequence\s+([0-9]+(?:-[0-9]+)+)/i,
    /sequence\s*[:\-]\s*([0-9,\s]+)/i,
    /sequence\s*\[([^\]]+)\]/i,
    /sequence\s*\(([^\)]+)\)/i
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const seq = parseNumbersFromFragment(match[1])
      if (seq) return seq
    }
  }

  return null
}

function classifyMemoryOutcome(mem) {
  const text = typeof mem?.text === 'string' ? mem.text.toLowerCase() : ''
  if (text.includes('successful')) return true
  if (text.includes('failed') || text.includes('avoid')) return false

  if (typeof mem?.confidence === 'number') {
    if (mem.confidence >= 0.8) return true
    if (mem.confidence <= 0.6) return false
  }

  return null
}

function chooseLeverSequence(scenarioId, leverCount, distilledMemories = [], attemptHistory = []) {
  const tried = Array.isArray(attemptHistory) ? attemptHistory : []

  const parsedMemories = distilledMemories
    .filter(mem => mem && mem.type === 'lever_sequence_distilled')
    .map(mem => ({
      seq: parseSequenceFromText(mem.text),
      outcome: classifyMemoryOutcome(mem)
    }))
    .filter(entry => Array.isArray(entry.seq) && entry.seq.length > 0)

  const avoidedSequences = parsedMemories
    .filter(entry => entry.outcome === false)
    .map(entry => entry.seq)

  const suggestedSequences = parsedMemories
    .filter(entry => entry.outcome === true)
    .map(entry => entry.seq)

  if (suggestedSequences.length > 0) {
    const firstGood = suggestedSequences.find(seq =>
      !tried.some(t => sequencesEqual(t, seq)) &&
      !avoidedSequences.some(a => sequencesEqual(a, seq))
    )
    if (firstGood) {
      return { sequence: firstGood, source: 'distilled_memory_success' }
    }
  }

  const allPerms = permute(Array.from({ length: leverCount }, (_, i) => i + 1))
  const unseen = allPerms.filter(p =>
    !tried.some(t => sequencesEqual(t, p)) &&
    !avoidedSequences.some(a => sequencesEqual(a, p))
  )

  if (unseen.length > 0) {
    const idx = Math.floor(Math.random() * unseen.length)
    return { sequence: unseen[idx], source: 'unseen_random' }
  }

  const remaining = allPerms.filter(p =>
    !avoidedSequences.some(a => sequencesEqual(a, p))
  )

  if (remaining.length > 0) {
    const idx = Math.floor(Math.random() * remaining.length)
    return { sequence: remaining[idx], source: 'fallback_random' }
  }

  const idx = Math.floor(Math.random() * allPerms.length)
  return { sequence: allPerms[idx], source: 'last_resort' }
}

module.exports = { chooseLeverSequence }
