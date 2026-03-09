const path = require('path')

const DEFAULT_PROFILE = 'distilled'
let activeProfile = normalizeProfile(process.env.RAG_MEMORY_PROFILE || DEFAULT_PROFILE)
const listeners = new Set()

function normalizeProfile(input) {
  return (input || '').toString().trim().toLowerCase() || DEFAULT_PROFILE
}

function getMemoryProfile() {
  return activeProfile
}

function setMemoryProfile(profile) {
  const normalized = normalizeProfile(profile)
  if (normalized === activeProfile) {
    return
  }
  activeProfile = normalized
  listeners.forEach(listener => {
    try {
      listener(activeProfile)
    } catch (err) {
      console.warn('memory profile listener failed:', err.message)
    }
  })
}

function onMemoryProfileChange(listener) {
  if (typeof listener !== 'function') {
    return () => {}
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function profileFromMode(mode) {
  const normalized = (mode || '').toString().trim().toLowerCase()
  if (normalized === 'raw' || normalized === 'rag') {
    return 'raw'
  }
  return DEFAULT_PROFILE
}

function applyMemoryProfile({ mode, profile }) {
  if (profile) {
    setMemoryProfile(profile)
    return
  }
  const derived = profileFromMode(mode)
  setMemoryProfile(derived)
}

function getProfileAwarePath(baseDir, baseName) {
  const profile = getMemoryProfile()
  let fileName = baseName
  if (profile && profile !== DEFAULT_PROFILE) {
    const extIndex = baseName.lastIndexOf('.')
    if (extIndex >= 0) {
      const stem = baseName.slice(0, extIndex)
      const ext = baseName.slice(extIndex)
      fileName = `${stem}.${profile}${ext}`
    } else {
      fileName = `${baseName}.${profile}`
    }
  }
  return path.join(baseDir, fileName)
}

module.exports = {
  DEFAULT_PROFILE,
  getMemoryProfile,
  setMemoryProfile,
  profileFromMode,
  applyMemoryProfile,
  getProfileAwarePath,
  onMemoryProfileChange
}
