# CelCat Realtime Voice Agent Architecture

> Current direction:
> - foreground is realtime voice conversation,
> - background is model-only task execution,
> - the earlier click-to-talk / one-shot transcription architecture is archived,
> - tool and MCP execution are not part of the active target architecture for now.

## Goal

Evolve CelCat from a push-to-talk transcription desktop pet into a companion-first realtime voice agent that can:

- hold low-latency spoken conversations,
- keep a warm companion persona in the foreground,
- dispatch complex work to background expert agents,
- let the realtime voice model check task progress and report it naturally.

## Current Project Snapshot

The current app already provides a good Electron skeleton for this work:

- `src/main.ts`
  - owns the Electron window, tray, permission handlers, and a single IPC handler for `voice:transcribe`.
- `src/renderer/renderer.ts`
  - owns the Live2D shell, window chrome, and the current voice button flow.
- `src/renderer/voice/voiceRecognition.ts`
  - records audio with `MediaRecorder`, stops recording, then uploads the full blob for transcription.
- `src/main-process/openaiTranscription.ts`
  - sends a one-shot request to `/v1/audio/transcriptions`.

This means the app is not yet session-based. There is no concept of:

- incremental ASR,
- streaming TTS or streaming audio output,
- conversation sessions,
- background tasks,
- agent routing,
- background model routing,
- progress polling.

## Product Direction

CelCat should behave like a companion at the front desk and a multi-agent system behind the scenes.

- Foreground experience:
  - realtime spoken interaction,
  - interruption support,
  - fast, emotionally warm short replies,
  - visible listening and task status.
- Background experience:
  - long-running tasks delegated to expert model workers,
  - structured task state,
  - resumable progress updates.

The realtime voice model is the primary conversational surface and the first-pass router. It may answer simple companion-style requests directly. Heavy work should be delegated to background models rather than local tools or MCP execution.

## Target Architecture

```text
Renderer UI
  -> Realtime Session Client
  -> Main Process Session Bridge
  -> Conversation Orchestrator
     -> Companion Policy
     -> Task Router
     -> Task Store
     -> Background Model Workers
        -> Claude Agent
        -> Codex Agent
  -> Realtime Voice Provider
```

### 1. Realtime Session Client

Lives mostly in the renderer and owns:

- microphone capture,
- outgoing PCM frame streaming,
- incoming transcript events,
- incoming audio playback events,
- barge-in handling,
- UI state like `idle`, `listening`, `thinking`, `speaking`, `task-running`.

This replaces the current record-then-upload model in `src/renderer/voice/voiceRecognition.ts`.

### 2. Main Process Session Bridge

Lives in the main process and owns:

- provider credentials,
- provider session setup,
- secure IPC,
- backpressure handling,
- session lifecycle,
- routing between renderer and orchestrator.

This is a better long-term fit than the current `nodeIntegration: true` plus direct renderer access pattern. As part of implementation, we should move toward `contextIsolation: true` and expose a typed bridge via `preload.ts`.

### 3. Conversation Orchestrator

Central control plane in the main process. It receives transcript and session events, then decides:

- should the realtime model answer directly,
- should a background task be created,
- should an expert agent be invoked,
- should the response be short spoken feedback now and a fuller answer later.

The orchestrator should be deterministic around permissions and execution rules even if the routing judgment itself is model-assisted.

### 4. Background Model Workers

Specialized backends for heavy work:

- `Claude Agent`
  - analysis, planning, summarization, writing.
- `Codex Agent`
  - coding, repo changes, terminal workflows, debugging.

These model workers run asynchronously as tasks and report structured progress back to the orchestrator.

### 5. Task Store

Persistent or semi-persistent storage for background work. The minimum useful task record is:

```ts
type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

type TaskRecord = {
  id: string;
  kind: 'claude' | 'codex';
  title: string;
  status: TaskStatus;
  progressSummary: string;
  internalDetail: string;
  createdAt: string;
  updatedAt: string;
  resultSummary?: string;
  resultPayload?: unknown;
  errorMessage?: string;
};
```

`progressSummary` is what the companion can safely say aloud.
`internalDetail` is for system-level reasoning and logs.

## Interaction Model

### A. Companion-Only Turn

```text
User speaks
-> realtime provider streams transcript
-> orchestrator classifies as simple conversation
-> realtime model answers directly
-> renderer plays audio and updates Live2D state
```

### B. Background Task Turn

```text
User speaks
-> realtime transcript arrives
-> orchestrator classifies as heavy task
-> create_task(...)
-> realtime model says a short acknowledgement
-> expert agent runs in background
-> task progress updates arrive
-> user asks for progress or result
-> realtime model calls check_task(...)
-> companion reports progress naturally
```

## Realtime Model Responsibilities

The realtime voice model should be allowed to:

- answer simple emotional or conversational turns directly,
- ask clarifying questions,
- acknowledge and narrate background work,
- request task operations such as:
  - `create_task`
  - `check_task`
  - `list_tasks`
  - `cancel_task`
  - `get_task_result`

The realtime voice model should not be allowed to:

- directly mutate the filesystem,
- directly invoke MCP,
- directly run shell commands,
- directly access credentials,
- directly execute tools on behalf of the user.

## Recommended Module Layout

Add new modules without rewriting the whole app at once.

### Main process

- `src/main-process/realtime/sessionManager.ts`
  - provider session lifecycle, streaming bridge, reconnect rules.
- `src/main-process/realtime/providerClient.ts`
  - provider-specific protocol wrapper.
- `src/main-process/orchestrator/conversationOrchestrator.ts`
  - central routing logic.
- `src/main-process/tasks/taskStore.ts`
  - task state tracking.
- `src/main-process/tasks/taskRunner.ts`
  - async execution lifecycle.
- `src/main-process/agents/claudeAgent.ts`
- `src/main-process/agents/codexAgent.ts`
- `src/main-process/config/userSettings.ts`
  - stores provider settings and persona preferences.

### Renderer

- `src/renderer/voice/realtimeVoiceController.ts`
  - replaces one-shot recording flow.
- `src/renderer/voice/audioCapture.ts`
  - PCM capture and resampling.
- `src/renderer/voice/audioPlayback.ts`
  - stream playback queue.
- `src/renderer/session/sessionClient.ts`
  - renderer-side bridge to the session manager.
- `src/renderer/task/taskStatusUi.ts`
  - visible summaries for active tasks.

### Shared types

- `src/types/realtime.ts`
- `src/types/tasks.ts`

## IPC Design

The current IPC surface is too narrow for the target product. We should move to explicit channels such as:

- `session:start`
- `session:stop`
- `session:send-audio-frame`
- `session:interrupt`
- `session:event`
- `task:list`
- `task:get`
- `task:cancel`
- `settings:get`
- `settings:update`

Renderer should receive typed events rather than owning business logic.

## State Machines

### Voice session state

```text
idle
-> connecting
-> listening
-> thinking
-> speaking
-> interrupted
-> listening
-> ended
```

### Background task state

```text
queued
-> running
-> waiting_user
-> running
-> completed

queued
-> running
-> failed

queued
-> cancelled
```

The orchestrator should be able to reference tasks even while the companion keeps chatting.

## Implementation Strategy

### Phase 1: Session scaffolding

Goal: introduce realtime session structure without expert agents yet.

- add typed preload bridge,
- add session manager skeleton,
- replace `voice:transcribe` flow with session events,
- show session state in the renderer,
- keep responses mocked or text-only first if needed.

### Phase 2: Background task substrate

Goal: let the companion create and inspect asynchronous tasks.

- add task store,
- add task runner,
- add simple in-memory task progress API,
- support `create_task`, `check_task`, `list_tasks`, `cancel_task`.

### Phase 3: Expert agent integration

Goal: route heavy tasks to external agents.

- integrate Claude/Codex backends,
- normalize outputs into task progress updates,
- add result summarization suitable for voice playback.

### Phase 4: Companion polish

Goal: make the product feel alive.

- Live2D expression hooks for listening/thinking/speaking/task-running,
- concise spoken progress summaries,
- interruption handling,
- memory and preference support.

## MVP Recommendation

Given the current repository, the best MVP is:

1. keep the existing UI shell and Live2D presentation,
2. replace one-shot transcription with a session abstraction,
3. add an in-memory task store,
4. let the companion create background model tasks and report progress,
5. defer tool and MCP execution entirely until the realtime companion loop is stable.

This keeps scope controlled while aligning the codebase with the final product direction.

## Key Decisions

### ADR-001: Realtime voice model is the front-facing router

- Status: accepted
- Why:
  - it gives the product warmth and immediacy,
  - it keeps the companion responsive while deeper work runs elsewhere.
- Trade-off:
  - routing quality now depends partly on the realtime model,
  - so deterministic policy checks are required in the orchestrator.

### ADR-002: Background tasks are first-class objects

- Status: accepted
- Why:
  - companion UX depends on progress narration,
  - complex work cannot block the voice loop.
- Trade-off:
  - task lifecycle and persistence add complexity,
  - but they unlock the core product behavior.

### ADR-003: Background execution is model-only for now

- Status: accepted
- Why:
  - it keeps the first production version simpler,
  - it avoids mixing realtime voice UX with tool-safety complexity too early,
  - it keeps the system focused on conversation quality and model routing.
- Trade-off:
  - the assistant cannot yet perform real-world actions,
  - but the architecture stays easier to validate and evolve.

## Risks And Mitigations

- Provider protocol complexity
  - Mitigation: isolate provider details behind `providerClient.ts`.
- Voice latency regression
  - Mitigation: keep heavy agents fully asynchronous and keep foreground responses short.
- Renderer security debt
  - Mitigation: move toward `contextIsolation: true` and a narrow preload API early.
- Scope explosion
  - Mitigation: ship Phase 1 and Phase 2 before adding any tool execution.

## Immediate Next Steps

1. Introduce a typed preload bridge and stop relying on direct renderer Electron access.
2. Add `realtime/sessionManager.ts` and define provider-neutral session events.
3. Add a simple `taskStore.ts` with in-memory records and progress updates.
4. Refactor the renderer voice controller to consume streaming session state instead of one-shot transcription.
5. Add a lightweight settings model for provider and persona configuration.
