const { retrieveLeverAttempts } = require('../rag/kb')

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

function parseSequenceFromText(text) {
  const match = text && text.match(/sequence ([0-9-]+)/)
  if (!match) return null
  const seq = match[1].split('-').map(n => Number(n)).filter(n => !Number.isNaN(n))
  return seq.length ? seq : null
}

function chooseLeverSequence(scenarioId, leverCount, distilledMemories = []) {
  const attempts = retrieveLeverAttempts(scenarioId)
  const tried = attempts.map(a => a.sequence)

  const avoidedSequences = distilledMemories
    .map(mem => ({ mem, seq: parseSequenceFromText(mem.text) }))
    .filter(({ mem, seq }) =>
      mem &&
      mem.type === 'lever_sequence_distilled' &&
      typeof mem.text === 'string' &&
      mem.text.includes('Failed') &&
      Array.isArray(seq)
    )
    .map(x => x.seq)

  const suggestedSequences = distilledMemories
    .map(mem => ({ mem, seq: parseSequenceFromText(mem.text) }))
    .filter(({ mem, seq }) =>
      mem &&
      mem.type === 'lever_sequence_distilled' &&
      typeof mem.text === 'string' &&
      mem.text.includes('Successful') &&
      Array.isArray(seq)
    )
    .map(x => x.seq)

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
