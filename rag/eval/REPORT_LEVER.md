# RAG System Performance Report

## Scenario: lever_puzzle_3

Generated: 2025-12-08T02:46:42.950Z

## Current Vector Store Status

| Metric | Value |
|--------|-------|
| Distilled Memories | 204 |
| Raw Episodes | 188 |
| Total Entries | 392 |
| Store Size | 4535.98 KB |

## Performance Comparison

### Distilled Mode

- **Runs**: 14
- **Avg Attempts to Solve**: 2.79
- **Avg Duration**: 11.41 seconds
- **Avg Store Size**: 1375.71 KB
- **Retrieval Latency**: 39.17 ms
- **Success Rate**: 71.4%

### Raw Mode

- **Runs**: 12
- **Avg Attempts to Solve**: 3.92
- **Avg Duration**: 14.43 seconds
- **Avg Store Size**: 1800.66 KB
- **Retrieval Latency**: 5.64 ms
- **Success Rate**: 58.3%

## Key Findings

- **Task Efficiency**: 28.9% fewer attempts (distilled)
- **Time to Solve**: 20.9% faster completion (distilled)
- **Storage Reduction**: 23.6%
- **Compression Ratio**: 1.31x
- **Success Rate**: Both modes 71%

