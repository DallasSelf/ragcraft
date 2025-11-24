@@ -4,74 +4,102 @@ function sequencesEqual(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function permute(values) {
  const result = []
  function helper(arr, remaining) {
    if (remaining.length === 0) {
      result.push(arr)
      return
    }
    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i]
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1))
      helper(arr.concat(next), rest)
    }
  }
  helper([], values)
  return result
}

function chooseLeverSequence(scenarioId, leverCount) {
function parseSequenceFromText(text) {
  const match = text && text.match(/sequence ([0-9-]+)/)
  if (!match) return null
  return match[1].split('-').map(Number)
}

function chooseLeverSequence(scenarioId, leverCount, distilledMemories = []) {
  const attempts = retrieveLeverAttempts(scenarioId)
  const successes = attempts.filter(a => a.success)
  const avoidedSequences = distilledMemories
    .map(mem => ({ mem, seq: parseSequenceFromText(mem.text) }))
    .filter(({ mem, seq }) => mem.type === 'lever_sequence_distilled' && mem.text.includes('Failed') && seq)
    .map(item => item.seq)
  const suggestedSequences = distilledMemories
    .map(mem => ({ mem, seq: parseSequenceFromText(mem.text) }))
    .filter(({ mem, seq }) => mem.type === 'lever_sequence_distilled' && mem.text.includes('Successful') && seq)
    .map(item => item.seq)

  if (successes.length > 0) {
    const recentSuccess = successes.sort((a, b) => b.timestamp - a.timestamp)[0]
    const allPerms = permute(Array.from({ length: leverCount }, (_, i) => i + 1))
    const tried = attempts.map(a => a.sequence)
    const remaining = allPerms.filter(p =>
      !tried.some(t => sequencesEqual(t, p))
      !tried.some(t => sequencesEqual(t, p)) &&
      !avoidedSequences.some(t => sequencesEqual(t, p))
    )
    if (remaining.length === 0) {
      return {
        sequence: recentSuccess.sequence,
        source: 'kb_success'
      }
    }
  }

  const allPerms = permute(Array.from({ length: leverCount }, (_, i) => i + 1))
  const tried = attempts.map(a => a.sequence)
  const unseen = allPerms.filter(p =>
    !tried.some(t => sequencesEqual(t, p))
    !tried.some(t => sequencesEqual(t, p)) &&
    !avoidedSequences.some(t => sequencesEqual(t, p))
  )

  if (suggestedSequences.length > 0) {
    const first = suggestedSequences.find(seq =>
      !tried.some(t => sequencesEqual(t, seq))
    )
    if (first) {
      return {
        sequence: first,
        source: 'distilled_memory_success'
      }
    }
  }

  if (unseen.length > 0) {
    const idx = Math.floor(Math.random() * unseen.length)
    return {
      sequence: unseen[idx],
      source: 'untried_permutation'
    }
  }

  if (successes.length > 0) {
    const recentSuccess = successes.sort((a, b) => b.timestamp - a.timestamp)[0]
    return {
      sequence: recentSuccess.sequence,
      source: 'kb_success_fallback'
    }
  }

  const idx = Math.floor(Math.random() * allPerms.length)
  return {
    sequence: allPerms[idx],
    source: 'exhausted_all_permutations'
  }
}

module.exports = { chooseLeverSequence }