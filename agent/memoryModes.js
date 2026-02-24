const MODE_PROFILES = {
  rag: {
    id: 'rag',
    includeRaw: true,
    includeDistilled: false,
    distillStyle: 'none',
    dataset: 'rag_raw'
  },
  distilled: {
    id: 'distilled',
    includeRaw: false,
    includeDistilled: true,
    distillStyle: 'template',
    dataset: 'distilled_template'
  },
  'distilled-ollama': {
    id: 'distilled-ollama',
    includeRaw: false,
    includeDistilled: true,
    distillStyle: 'ollama',
    dataset: 'distilled_ollama'
  }
}

MODE_PROFILES.raw = MODE_PROFILES.rag

function resolveMemoryMode(mode = 'distilled') {
  return MODE_PROFILES[mode] || MODE_PROFILES.distilled
}

module.exports = {
  resolveMemoryMode,
  MODE_PROFILES
}
