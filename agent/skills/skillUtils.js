function ensureInputs(inputs = {}, required = []) {
  for (const key of required) {
    if (inputs[key] === undefined || inputs[key] === null) {
      throw new Error(`Skill missing required input: ${key}`)
    }
  }
  return inputs
}

function skillSuccess(signal, details = {}) {
  return {
    success: true,
    signal,
    details
  }
}

function skillFailure(signal, error) {
  return {
    success: false,
    signal,
    error
  }
}

module.exports = {
  ensureInputs,
  skillSuccess,
  skillFailure
}
