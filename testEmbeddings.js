
const { embedText, cosineSimilarity } = require('./rag/embeddings/embedder')
const { addDistilledMemory, searchVectorStore, getStoreStats } = require('./rag/store/vectorStore')

async function testEmbeddings() {
  console.log('Testing embedding system...\n')

  console.log('1. Generating embeddings...')
  const text1 = 'Successful lever sequence 2-3-1 at attempt 4'
  const text2 = 'Failed lever sequence 1-2-3 at attempt 2'
  const text3 = 'The maze navigation turned left then right'

  const emb1 = await embedText(text1)
  const emb2 = await embedText(text2)
  const emb3 = await embedText(text3)

  console.log(`   Text 1 embedding dimension: ${emb1.length}`)
  console.log(`   Text 2 embedding dimension: ${emb2.length}`)
  console.log(`   Text 3 embedding dimension: ${emb3.length}`)

  console.log('\n2. Computing similarities...')
  const sim12 = cosineSimilarity(emb1, emb2)
  const sim13 = cosineSimilarity(emb1, emb3)
  const sim23 = cosineSimilarity(emb2, emb3)

  console.log(`   Similarity (lever success vs lever fail): ${sim12.toFixed(4)}`)
  console.log(`   Similarity (lever success vs maze):       ${sim13.toFixed(4)}`)
  console.log(`   Similarity (lever fail vs maze):          ${sim23.toFixed(4)}`)

  console.log('\n3. Adding to vector store...')

  await addDistilledMemory({
    id: 'test-1',
    scenarioId: 'lever_puzzle_test',
    type: 'lever_sequence_distilled',
    text: text1,
    confidence: 0.9,
    timestamp: Date.now()
  })

  await addDistilledMemory({
    id: 'test-2',
    scenarioId: 'lever_puzzle_test',
    type: 'lever_sequence_distilled',
    text: text2,
    confidence: 0.55,
    timestamp: Date.now()
  })

  await addDistilledMemory({
    id: 'test-3',
    scenarioId: 'maze_test',
    type: 'maze_distilled',
    text: text3,
    confidence: 0.8,
    timestamp: Date.now()
  })

  console.log('   Added 3 memories to vector store')

  console.log('\n4. Searching vector store...')

  const query = 'successful lever puzzle solution'
  const results = await searchVectorStore(query, {
    topK: 5,
    includeDistilled: true,
    includeRaw: false
  })

  console.log(`   Query: "${query}"`)
  console.log(`   Found ${results.length} results:\n`)

  results.forEach((r, i) => {
    console.log(`   ${i + 1}. [${r.scenarioId}] ${r.text}`)
    console.log(`      Similarity: ${r.similarity.toFixed(4)}, Boosted: ${r.boostedScore.toFixed(4)}, Confidence: ${r.confidence}`)
  })

  console.log('\n5. Store statistics:')
  const stats = getStoreStats()
  console.log(`   Distilled: ${stats.distilledCount}`)
  console.log(`   Raw: ${stats.rawCount}`)
  console.log(`   Size: ${(stats.storeSizeBytes / 1024).toFixed(2)} KB`)

  console.log('\nTests complete\n')
}

testEmbeddings().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
