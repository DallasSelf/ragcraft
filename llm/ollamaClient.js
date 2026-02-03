const fetch = global.fetch || require('node-fetch')

const BASE_URL = process.env.LLM_ENDPOINT || 'http://localhost:11434'
const MODEL = process.env.LLM_MODEL || 'llama3.1'

async function runLLM(prompt, options = {}) {
  if (!process.env.LLM_ENABLED || process.env.LLM_ENABLED === 'false') {
    return ''
  }

  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options
    })
  })

  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()
  return json.response || ''
}

module.exports = { runLLM }