const { runLLM } = require('./ollamaClient')

const SUPPORTED_SCENARIOS = ['lever', 'maze', 'scout', 'key']
const SUPPORTED_TASK_TYPES = ['run_scenario', 'scout_area', 'find_object', 'find_location', 'acquire_object']

function normalizeMemoryMode(value, fallback = 'distilled') {
  const mode = String(value || fallback).trim().toLowerCase()
  if (['raw', 'distilled', 'rag', 'hybrid', 'distilled-ollama'].includes(mode)) {
    return mode
  }
  return fallback
}

function normalizeScenario(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return null
  if (v === 'keyfinder' || v === 'key_finder' || v === 'key-finder') return 'key'
  if (v === 'survey' || v === 'scan') return 'scout'
  if (SUPPORTED_SCENARIOS.includes(v)) return v
  return null
}

function normalizeTaskType(value) {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return null
  if (v === 'lever_puzzle' || v === 'maze' || v === 'scout' || v === 'keyfinder') return 'run_scenario'
  if (v === 'find_tool' || v === 'find_item' || v === 'find_resource') return 'find_object'
  if (v === 'find_place' || v === 'find_area') return 'find_location'
  if (v === 'acquire_item' || v === 'get_item') return 'acquire_object'
  if (v === 'scout') return 'scout_area'
  if (SUPPORTED_TASK_TYPES.includes(v)) return v
  return null
}

function normalizeTarget(value) {
  if (!value) return null
  return String(value).trim().toLowerCase().replace(/\s+/g, '_')
}

function extractJsonCandidate(raw) {
  const text = String(raw || '').trim()
  if (!text) return null

  // Allow plain JSON or fenced code block output.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim()
  return text
}

function validateTask(task) {
  const out = {
    taskType: normalizeTaskType(task.taskType),
    scenario: normalizeScenario(task.scenario),
    targetItem: normalizeTarget(task.targetItem),
    targetObject: normalizeTarget(task.targetObject || task.targetItem),
    targetLocation: normalizeTarget(task.targetLocation),
    memoryMode: normalizeMemoryMode(task.memoryMode, 'distilled'),
    priority: task.priority ? String(task.priority).trim() : 'normal',
    successCondition: task.successCondition ? String(task.successCondition).trim() : 'scenario_success'
  }

  if (!out.taskType) {
    return { ok: false, error: 'taskType is missing or unsupported.' }
  }

  if (out.taskType === 'run_scenario') {
    if (!out.scenario) {
      return { ok: false, error: 'scenario is required for run_scenario and must be one of lever, maze, scout, key.' }
    }
    return { ok: true, task: out }
  }

  if (out.taskType === 'scout_area') {
    out.scenario = 'scout'
    out.successCondition = out.successCondition || 'recon_memory_recorded'
    return { ok: true, task: out }
  }

  if (out.taskType === 'find_object' || out.taskType === 'acquire_object') {
    out.targetObject = out.targetObject || out.targetItem
    if (!out.targetObject) {
      return { ok: false, error: 'targetObject is required for find_object/acquire_object.' }
    }
    out.successCondition = out.successCondition || (out.taskType === 'acquire_object' ? 'object_acquired' : 'object_found')
    out.scenario = out.scenario || null
    return { ok: true, task: out }
  }

  if (out.taskType === 'find_location') {
    if (!out.targetLocation) {
      return { ok: false, error: 'targetLocation is required for find_location.' }
    }
    out.successCondition = out.successCondition || 'location_found'
    out.scenario = out.scenario || null
    return { ok: true, task: out }
  }

  return { ok: false, error: 'Unsupported taskType.' }
}

function buildStrictPrompt(commandText, defaultMemoryMode) {
  const safeCommand = String(commandText || '').trim()
  return [
    'You are a strict command interpreter for a Minecraft task router.',
    'Return ONLY one valid JSON object. No markdown. No explanation.',
    'Schema:',
    '{',
    '  "taskType": "run_scenario" | "scout_area" | "find_object" | "find_location" | "acquire_object",',
    '  "scenario": "lever" | "maze" | "scout" | "key" | null,',
    '  "targetItem": string | null,',
    '  "targetObject": string | null,',
    '  "targetLocation": string | null,',
    '  "memoryMode": "raw" | "distilled" | "rag" | "hybrid" | "distilled-ollama",',
    '  "priority": string,',
    '  "successCondition": string',
    '}',
    'Rules:',
    '- "solve the lever puzzle" => run_scenario + scenario lever',
    '- "run the maze" => run_scenario + scenario maze',
    '- "scout the area" => scout_area + scenario scout',
    '- "run keyfinder" => run_scenario + scenario key',
    '- "find me a shovel" => find_object + targetObject shovel',
    '- "find a pit of lava" => find_location + targetLocation pit_of_lava',
    '- "find the lever room" => find_location + targetLocation lever_room',
    '- "find a pickaxe" => find_object + targetObject pickaxe',
    `- If memory mode is not specified by the user, use "${defaultMemoryMode}".`,
    '- Keep fields concise. Use snake_case for targetItem when possible.',
    '',
    `User command: "${safeCommand}"`
  ].join('\n')
}

async function interpretNaturalLanguageTask(commandText, options = {}) {
  const defaultMemoryMode = normalizeMemoryMode(options.defaultMemoryMode, 'distilled')
  const prompt = buildStrictPrompt(commandText, defaultMemoryMode)

  const raw = await runLLM(prompt, {
    temperature: 0,
    top_p: 0.1
  })

  if (!raw || !String(raw).trim()) {
    return {
      ok: false,
      error: 'LLM returned empty output. Ensure LLM_ENABLED=true and Ollama is reachable.'
    }
  }

  const candidate = extractJsonCandidate(raw)
  let parsed
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON returned by LLM.',
      raw
    }
  }

  const validated = validateTask(parsed)
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error,
      parsed
    }
  }

  return {
    ok: true,
    task: validated.task,
    raw
  }
}

function getSupportedCommandHints() {
  return [
    'solve the lever puzzle',
    'run the maze',
    'scout the area',
    'run keyfinder',
    'find me a shovel'
  ]
}

module.exports = {
  interpretNaturalLanguageTask,
  getSupportedCommandHints,
  SUPPORTED_SCENARIOS,
  SUPPORTED_TASK_TYPES
}
