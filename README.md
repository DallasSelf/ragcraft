RAGCraft: Episodic Memory for Minecraft NPCs

RAGCraft is a research project built to test a simple idea:
NPCs should learn from their experiences.
Traditional RAG systems can retrieve information, but they don’t build memories. They act like every attempt is their first day on the job. This project adds an episodic memory layer that lets agents improve over time inside a real, interactive world.

Minecraft gives a perfect testing ground. The environment is structured, repeatable, and deterministic. Mineflayer provides full programmatic access to the world. Together they create a controlled lab for testing autonomous decision-making.

This repo contains the full codebase for three learning scenarios, the episodic memory system, and the distilled memory layer used to make the agent more efficient with each episode.

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

Directory Overview
ragcraft/
  agent/
    leverEpisode.js
    mazeEpisode.js
    keyFinderEpisode.js
    leverStrategy.js
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
