const { resetDistilledMemoryStore } = require('../rag/distilledMemory')
const { resetKb } = require('../rag/kb')
const { clearVectorStore } = require('../rag/store/vectorStore')

function resetKnowledgeStores() {
  resetDistilledMemoryStore()
  clearVectorStore()
  resetKb()
}

module.exports = {
  resetKnowledgeStores
}
