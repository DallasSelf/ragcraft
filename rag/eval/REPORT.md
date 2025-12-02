# RAG System Performance Report

## Scenario: lever_puzzle_3

Generated: 2025-11-26T07:41:40.600Z

## Current Vector Store Status

| Metric | Value |
|--------|-------|
| Distilled Memories | 97 |
| Raw Episodes | 81 |
| Total Entries | 178 |
| Store Size | 2058.88 KB |

## Performance Comparison

### Distilled Mode

- **Runs**: 10
- **Avg Attempts to Solve**: 2.40
- **Avg Duration**: 10.86 seconds
- **Avg Store Size**: 711.24 KB
- **Retrieval Latency**: 33.94 ms
- **Success Rate**: 80.0%

### Raw Mode

- **Runs**: 8
- **Avg Attempts to Solve**: 3.13
- **Avg Duration**: 12.32 seconds
- **Avg Store Size**: 1037.89 KB
- **Retrieval Latency**: 5.16 ms
- **Success Rate**: 75.0%

## Key Findings

- **Task Efficiency**: 23.2% fewer attempts (distilled)
- **Time to Solve**: 11.8% faster completion (distilled)
- **Storage Reduction**: 31.5%
- **Compression Ratio**: 1.46x
- **Success Rate**: Both modes 80%

