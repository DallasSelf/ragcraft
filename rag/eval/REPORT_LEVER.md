# RAG System Performance Report

## Scenario: lever_puzzle_3

Generated: 2025-11-26T08:06:32.651Z

## Current Vector Store Status

| Metric | Value |
|--------|-------|
| Distilled Memories | 169 |
| Raw Episodes | 153 |
| Total Entries | 322 |
| Store Size | 3725.53 KB |

## Performance Comparison

### Distilled Mode

- **Runs**: 13
- **Avg Attempts to Solve**: 2.92
- **Avg Duration**: 12.04 seconds
- **Avg Store Size**: 1168.23 KB
- **Retrieval Latency**: 33.80 ms
- **Success Rate**: 69.2%

### Raw Mode

- **Runs**: 11
- **Avg Attempts to Solve**: 3.73
- **Avg Duration**: 13.87 seconds
- **Avg Store Size**: 1566.74 KB
- **Retrieval Latency**: 5.65 ms
- **Success Rate**: 63.6%

## Key Findings

- **Task Efficiency**: 21.6% fewer attempts (distilled)
- **Time to Solve**: 13.2% faster completion (distilled)
- **Storage Reduction**: 25.4%
- **Compression Ratio**: 1.34x
- **Success Rate**: Both modes 69%

