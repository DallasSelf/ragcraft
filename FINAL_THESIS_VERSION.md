# FINAL THESIS VERSION (FROZEN)

Freeze date: 2026-04-02
Workspace: ragcraft_refactor/work_repo
Status: Final experiment reruns and unified analysis completed.

## Final Version Intent
This marker freezes the project for thesis writing and slides.
No additional experiment reruns, logic tuning, or distilled-memory redesign should be done after this point.

## Final Experiment Code to Treat as Frozen
- memoryDistiller.js
- llm/distiller.js
- rag/store/vectorStore.js
- rag/retrieval.js
- agent/keyFinderEpisodeEnhanced.js

## Final Analysis/Chart Scripts to Treat as Frozen
- scripts/buildUnifiedScenarioAnalysis.js
- scripts/buildLeverCorrectedAnalysis.js
- scripts/generateThesisCharts.py
- scripts/generateEarlyRunCharts.py

## Final Dataset Roots (Use These)
- runs/lever/raw
- runs/lever/distilled
- runs/maze/raw
- runs/maze/distilled
- runs/key/raw
- runs/key/distilled

Condition mapping in distilled folders:
- *_raw_memory_* labels = raw_memory condition
- *_distilled_memory_* labels = distilled_memory condition

Verified counts:
- lever/raw: 200
- lever/distilled: 400 (200 raw_memory + 200 distilled_memory)
- maze/raw: 200
- maze/distilled: 400 (200 raw_memory + 200 distilled_memory)
- key/raw: 200
- key/distilled: 400 (200 raw_memory + 200 distilled_memory)

Total final merged runs: 1800

## Final Analysis Outputs (Use These)
- analysis/all_runs_merged.csv
- analysis/all_runs_merged.json
- analysis/dataset_verification.json
- analysis/artifact_spotcheck.json
- analysis/artifact_issues.json

Scenario summaries:
- analysis/lever/lever_condition_summary_corrected.json
- analysis/lever/lever_window_summary_corrected.json
- analysis/maze/maze_condition_summary.json
- analysis/maze/maze_window_summary.json
- analysis/key/key_condition_summary.json
- analysis/key/key_window_summary.json

Comparison outputs:
- analysis/final_distilled_comparison.csv
- analysis/final_distilled_comparison.json

Charts:
- analysis/charts/chart_manifest.json
- analysis/charts/early_chart_manifest.json
- analysis/charts/lever/
- analysis/charts/maze/
- analysis/charts/key/

## Old/Confusing Artifacts (Ignore for Thesis Results)
- runs/_pre_final_clean_archive_20260401_154818/
- runs/archives/
- runs/_summary/
- runs/_final_clean_logs/ (operational logs only)

## Non-Final Utility Scripts (Ignore Unless Needed for Ops)
- scripts/serveDashboard.js
- scripts/launch-all.ps1
- scripts/nlCommandLoop.js

## Freeze Rules
1. Do not rerun experiments.
2. Do not modify experiment logic.
3. Do not retune distilled-memory behavior.
4. Do not delete final run/analysis/chart outputs.
5. If you must make non-thesis edits, do them in a separate branch.
