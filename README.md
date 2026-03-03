RAGCraft: Episodic Memory for Minecraft NPCs

RAGCraft is a research project built to test a simple idea:
NPCs should learn from their experiences.
Traditional RAG systems can retrieve information, but they don’t build memories. They act like every attempt is their first day on the job. This project adds an episodic memory layer that lets agents improve over time inside a real, interactive world.

Minecraft gives a perfect testing ground. The environment is structured, repeatable, and deterministic. Mineflayer provides full programmatic access to the world. Together they create a controlled lab for testing autonomous decision-making.

This repo contains the full codebase for three learning scenarios, the episodic memory system, and the distilled memory layer used to make the agent more efficient with each episode.

          This project is sensitive to version compatibility. Use the versions below.

          Node.js: v22.x (required)
          Minecraft Server: Paper 1.21.8
          Mineflayer: latest (Node 22 compatible)

          Do NOT downgrade Mineflayer or minecraft-protocol.
          Do NOT run this project on Node 20 or earlier.

          If the bot fails to connect, verify:
          - The Paper server is running
          - The server version is 1.21.8
          - The bot is started with Node 22 (`nvm use 22`)
          - The .env host/port match the server

Project Goals

Push RAG beyond static retrieval.

Give agents a way to store and reuse episodic memories.

Measure how efficiency changes across repeated attempts.

Compare “traditional RAG” vs “buffered RAG” with experiential memory.

Show whether one agent’s distilled memory can help another agent start smarter.

Core Idea: Buffered RAG

“Buffered RAG” adds a middle layer between the agent and the knowledge store:

Logs every action the agent takes.

Distills important events into small memory units.

Stores distilled memories as reusable facts.

Feeds those facts back into the next episode.

The result is an agent that avoids repeating failed actions and prefers paths that worked before.

Scenarios
1. Lever Puzzle

The bot has to discover a hidden sequence of levers.
Each attempt gets logged and distilled into memory units like:

“Failed sequence 2-1-3”

“Successful sequence 3-2-1”

The bot avoids sequences that previously failed and prioritizes successful ones.

2. Key Finder

The bot searches a small area with walls for a hidden key.
It must pick the key up and open a chest.

Distilled memory examples:

“Key found at (x,y,z)”

“Search in this area wasted time”

“This path leads to a dead end”

3. Maze Navigation

The bot tries to reach a goal block in a simple maze.
It logs every movement and learns from failed paths.

Distilled memory helps it:

Avoid loops

Avoid dead ends

Prefer successful paths in later episodes

4. Scout Mode (scout_area_v1)

Before tackling a mission the bot can sweep a bounded area (either a center+radius bubble or two explicit corners), prioritize unvisited grid cells, and catalog the world. While roaming it emits LandmarkClaim, RouteClaim, InteractableClaim, ToolLocationClaim, DoorLocationClaim, and HazardZoneClaim records using the shared cross-task schema so later scenarios can retrieve them. Tune the sweep with CLI flags such as `--scout-radius 10 --scout-steps 24 --scout-center 20,65,-5` or by passing opposite corners.

How It Works
Mineflayer

Provides access to:

world state

block data

movement

navigation

interactions with levers, chests, items, etc.

Pathfinder

Used for navigating the world:

Goal-based movement

Pathfinding updates

Event listeners for movement, stop, reset, etc.

Episodic Memory

Raw logs for each attempt:

actions

positions

errors

success/failure

timestamps

Distilled Memory Layer

A small summarization system that reduces logs into stable memory facts.
These memories influence the next episode’s planning.

Stored in:

rag/distilledMemory/memory.json

Commands

When the bot is running inside the Minecraft server:

!lever — runs the lever puzzle
!key — runs the key finding scenario
!maze — runs the maze
!scout — runs the scout/survey pass for a bounded area
!all — runs all three in sequence

Running the Project

You need a Paper server and a working Node environment.

Start your Paper server:

java -Xmx2G -Xms2G -jar paper.jar


Start the agent bot:

cd ragcraft
npm install
npm start


Join the server in Minecraft Java Edition

Use the chat commands to trigger scenarios

One-command bootstrap

If you want a single command that boots the Paper server, launches the bot, and runs a scenario loop, you have two options:

1. Node helper (recommended when you want everything in one console)

  node StartItAll.js --scenario key --useRunJs --mode distilled

  Flags mirror the CLI options inside StartItAll.js (e.g., --serverDir, --serverJar, --skipServerStart, --stopServerWhenDone). By default it launches the Paper jar located at C:\Users\dalla\Desktop\School\RAGCraft\mc\paper, waits for port 25565, then runs the requested scenario command (run.js or runScenarios.js).

2. PowerShell helper (opens a separate server window)

  powershell -ExecutionPolicy Bypass -File scripts/launch-all.ps1 -Scenario key -UseRunJs -Mode distilled

  Or run the lever puzzle five times via runScenarios:

  powershell -ExecutionPolicy Bypass -File scripts/launch-all.ps1 -Scenario lever -Repeats 5

Important flags for the PowerShell helper:

-ServerDir: override if your Paper server lives somewhere other than C:\Users\dalla\Desktop\School\RAGCraft\mc\paper
-SkipServerStart: set this switch if the server is already running and you only want to trigger bot runs
-StopServerWhenDone: automatically closes the spawned server window after the scenarios finish; otherwise leave it open and stop manually when you are done
-UseRunJs: swap from runScenarios.js to run.js (lets you pass modes such as distilled/raw)
-RunCommand: provide a fully custom bot command (e.g., "node run.js key --mode raw") if you need total control

Facility Reset Utility

Restore the physical challenge areas to their baseline state between trials without erasing learned knowledge:

  node scripts/resetFacility.js

Pass --wipeMemory when you explicitly want a clean-slate run (this clears distilled memories, the vector store, and kb.json). Add --quiet to suppress per-command logs; otherwise a short JSON summary shows which subsystems were reset.

Transfer Experiment Pipeline

Run the composite lever ➜ captive transfer experiment (covering transfer_disabled, transfer_enabled_claims_only, transfer_enabled) and emit both summary JSON and a terminal table with one command:

  npm run transfer:pipeline -- --runs 5 --mode distilled

Key details:

- --runs N sets how many trials to collect per condition (defaults to 3)
- --mode controls the underlying memory backend passed to each scenario (defaults to distilled)
- Outputs land in runs/experiments/ as two files per run: transfer_<timestamp>.json (full run logs) and transfer_summary_<timestamp>.json (aggregated metrics for time per trial, actions per trial, lever revisits per trial, and success rate)
- The terminal view prints a table so you can compare all three conditions without opening the JSON
- Every batch now begins with `scout_area_v1`, so cross-task claims exist before lever/captive runs. Use `--skip-scout` to revert to the legacy behavior or pass `--scout-radius`, `--scout-steps`, `--scout-center x,y,z`, `--scout-corner-a x,y,z`, and `--scout-corner-b x,y,z` to tighten the sweep bounds.
- Per-run metrics include `scout_claims_detected`, `scout_steps`, and `scout_cells_explored` so you can verify the survey actually discovered new knowledge.

Composite Experiment Runner

Need a broader facility-wide batch (maze, unlock, captive, artifact retrieval) with multiple knowledge-sharing regimes? Run:

```
node scripts/compositeExperimentRunner.js --trials 4 --delay 2000
```

This helper:

- Spins up three baked-in conditions per trial:
  - **Condition A** – no scout, no cross-task transfer (resets memories before every goal and limits retrieval scope to local claims).
  - **Condition B** – scout enabled with full cross-task transfer (global scope, claims + raw episodes via the new `hybrid` memory mode).
  - **Condition C** – scout enabled, claims-only transfer (global scope but distilled-only retrieval).
- Runs all four goal types sequentially per trial so later tasks can reuse knowledge when the condition allows it.
- Resets `rag/distilledMemory`, the vector store, and `rag/kb.json` between trials for clean comparisons.
- Writes a JSON summary to `runs/composite/<timestamp>.json` (use `--output none` to skip or `--output ./path/file.json` to override).

Helpful flags:

- `--trials N` — repetitions per condition (default 3).
- `--delay MS` — pause between scenario launches (default 1500 ms) so the server can settle.
- `--output <path|none>` — custom summary location or `none` to disable file emission.

When the batch finishes you’ll see per-condition success rates plus per-goal averages right in the terminal.

Debug Logging

Toggle high-signal console debugging without touching scenario logic:

- Set AGENT_DEBUG=true to stream all debug topics
- Or set AGENT_DEBUG_TOPICS=retrieval,plan,claims to see only those slices (comma-delimited, supports all)
- Topics currently include retrieval (goal + vector lookups), plan (planner strategy summaries), and claims (how claim data influenced chosen sequences or captive attempts)
- Logs remain opt-in so evaluation output is quiet by default

World Model Planner

- `agent/world_model.js` now reconstructs an affordance graph from stored claims at mission start and increments it as new claims arrive. Nodes capture landmarks, interactables, hazards, and resources, while edges mark traversable paths, adjacency, requirements, or unlock relationships.
- `agent/planning/planner.js` consumes that graph rather than scenario IDs. Goals are decomposed into required end states, then automatically chained across a small skill library (`navigate_to`, `retrieve_item`, `unlock_door_with_code`, `avoid_hazard_path`, `interact_entity`).
- Plan metadata (claim references, preferred locations, door codes, maze routes) continues to flow into each episode, so lever/key/maze logic reuse the same downstream interfaces with richer context.
- Because prerequisites now come from affordances, adding a new scenario typically means emitting claims; the planner rehydrates the world model and assembles the appropriate skill chain without per-scenario switches.

Directory Overview
ragcraft/
  agent/
    leverEpisode.js
    mazeEpisode.js
    keyFinderEpisode.js
    leverStrategy.js
      scoutEpisode.js
    mazeStrategy.js
  key_finder/
    ...
  maze/
    mazeWorld.js
  rag/
    kb.js
    distilledMemory/
      memory.json
  scenarios/
    leverPuzzleConfig.js
    keyFinderConfig.js
      scoutAreaConfig.js
    mazeConfig.js
  memoryDistiller.js
  index.js

Why This Matters

Most RAG research focuses on static document sets.
This project tests how RAG behaves when you plug in real agent experience.
By giving the agent memory:

Repetition drops

Efficiency climbs

Accuracy improves

Behavior becomes more human-like

Knowledge becomes transferable across agents

This repo is a step toward more autonomous, self-improving NPCs and richer RAG systems.

License

MIT — do anything you want, just don’t blame me if your bot redecorates your base.
