const { v4: uuidv4 } = require('uuid')
const { runLLM } = require('./client')

function safeNumber(n, fallback) {
  const x = Number(n)
  return Number.isFinite(x) ? x : fallback
}

function normalizeScenarioId(s) {
  return typeof s === 'string' ? s : ''
}

function buildPrompt(attempt) {
  const scenarioId = normalizeScenarioId(attempt.scenarioId)
  const base = {
    scenarioId,
    runId: attempt.runId || null,
    attemptIndex: attempt.attemptIndex ?? null,
    success: Boolean(attempt.success),
    timestamp: attempt.timestamp || Date.now()
  }

  if (scenarioId.startsWith('lever_puzzle')) {
    return [
      'You are distilling a Minecraft lever puzzle attempt into a single memory unit for later retrieval.',
      'Return only valid JSON. No extra text.',
      'Schema:',
      '{ "type": "lever_sequence_distilled", "text": "<string>", "confidence": <number 0..1> }',
      'Attempt:',
      JSON.stringify({
        ...base,
        sequence: Array.isArray(attempt.sequence) ? attempt.sequence : null
      })
    ].join('\n')
  }

  if (scenarioId.startsWith('key_finder') || scenarioId.startsWith('key_unlock')) {
    return [
      'You are distilling a Minecraft key-finder attempt into a single memory unit for later retrieval.',
      'Return only valid JSON. No extra text.',
      'Schema:',
      '{ "type": "key_finder_distilled", "text": "<string>", "confidence": <number 0..1> }',
      'Attempt:',
      JSON.stringify({
        ...base,
        targetPos: attempt.targetPos || null,
        actions: Array.isArray(attempt.actions) ? attempt.actions : null
      })
    ].join('\n')
  }

  if (scenarioId.startsWith('maze')) {
    return [
      'You are distilling a Minecraft maze attempt into a single memory unit for later retrieval.',
      'Return only valid JSON. No extra text.',
      'Schema:',
      '{ "type": "maze_distilled", "payload": { "outcome": "success|failed", "stepCount": <number>, "turnSequence": <array>, "rule": "<string>" }, "confidence": <number 0..1> }',
      'Attempt:',
      JSON.stringify({
        ...base,
        stepCount: attempt.stepCount ?? null,
        turnSequence: Array.isArray(attempt.turnSequence) ? attempt.turnSequence : null
      })
    ].join('\n')
  }

  return ''
}

function tryParseJson(s) {
  if (typeof s !== 'string' || s.trim().length === 0) return null
  const t = s.trim()
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

async function distillWithLLM(attempt) {
  const scenarioId = normalizeScenarioId(attempt.scenarioId)
  if (!scenarioId) return null

  const prompt = buildPrompt(attempt)
  if (!prompt) return null

  const raw = await runLLM(prompt, { temperature: 0.1 })
  const parsed = tryParseJson(raw)
  if (!parsed || typeof parsed !== 'object') return null

  const type = typeof parsed.type === 'string' ? parsed.type : null
  const confidence = safeNumber(parsed.confidence, null)

  if (scenarioId.startsWith('maze')) {
    if (type !== 'maze_distilled') return null
    if (!parsed.payload || typeof parsed.payload !== 'object') return null

    const unit = {
      id: uuidv4(),
      scenarioId,
      type: 'maze_distilled',
      text: JSON.stringify({
        outcome: parsed.payload.outcome === 'success' ? 'success' : 'failed',
        stepCount: safeNumber(parsed.payload.stepCount, 0),
        turnSequence: Array.isArray(parsed.payload.turnSequence) ? parsed.payload.turnSequence : [],
        rule: typeof parsed.payload.rule === 'string' ? parsed.payload.rule : ''
      }),
      confidence: safeNumber(confidence, 0.6),
      evidenceRunIds: attempt.runId ? [attempt.runId] : [],
      timestamp: attempt.timestamp || Date.now()
    }

    return unit
  }

  if (scenarioId.startsWith('lever_puzzle')) {
    if (type !== 'lever_sequence_distilled') return null
  }

  if (scenarioId.startsWith('key_finder') || scenarioId.startsWith('key_unlock')) {
    if (type !== 'key_finder_distilled') return null
  }

  const text = typeof parsed.text === 'string' ? parsed.text : null
  if (!text) return null

  const unit = {
    id: uuidv4(),
    scenarioId,
    type,
    text,
    confidence: safeNumber(confidence, 0.6),
    evidenceRunIds: attempt.runId ? [attempt.runId] : [],
    timestamp: attempt.timestamp || Date.now()
  }

  return unit
}

module.exports = { distillWithLLM }