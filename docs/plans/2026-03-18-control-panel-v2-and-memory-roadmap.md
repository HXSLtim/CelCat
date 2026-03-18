# CelCat Control Panel V2 And Memory Roadmap

## Goal

CelCat should continue evolving toward a dual-surface product:

- The pet window stays lightweight, emotional, and low-noise.
- The local control panel becomes the durable workspace for tasks, approvals, results, and memory.

This document consolidates current project status and the next-stage product, UX, and technical plan.

## Current Product State

### Pet Window

Current behavior is centered in:

- [src/renderer/index.html](c:/Users/a2778/Desktop/Code/CelCat/src/renderer/index.html)
- [src/renderer/renderer.ts](c:/Users/a2778/Desktop/Code/CelCat/src/renderer/renderer.ts)
- [src/renderer/styles/main.css](c:/Users/a2778/Desktop/Code/CelCat/src/renderer/styles/main.css)

What is already true:

- The pet window no longer exposes backend task workspace details.
- Dragging is moving toward a "long press to drag" model instead of a visible drag button.
- The window menu is the only low-frequency system control surface.
- A unified status surface exists via `#assistant-status`.

What still needs product-level refinement:

- A stricter status priority model.
- Clear separation of pet feedback vs. background task state.
- More deliberate touch / mouse interaction semantics.

### Local Control Panel

Current behavior is centered in:

- [src/control-panel/index.html](c:/Users/a2778/Desktop/Code/CelCat/src/control-panel/index.html)
- [src/control-panel/app.js](c:/Users/a2778/Desktop/Code/CelCat/src/control-panel/app.js)
- [src/control-panel/styles.css](c:/Users/a2778/Desktop/Code/CelCat/src/control-panel/styles.css)
- [src/main-process/control-panel/controlPanelServer.ts](c:/Users/a2778/Desktop/Code/CelCat/src/main-process/control-panel/controlPanelServer.ts)

What is already true:

- There is a localhost control panel.
- It can list tasks and show task detail.
- It supports approve / cancel actions.
- It now has basic error fallback instead of hard-failing on request issues.

What still needs product-level refinement:

- Stronger dashboard summary.
- A real task timeline instead of only a step list.
- Better "waiting for approval" emphasis.
- Memory and identity visualization.

### Memory Layer

Current memory and identity sources are centered in:

- [src/main-process/agent/agentMemoryStore.ts](c:/Users/a2778/Desktop/Code/CelCat/src/main-process/agent/agentMemoryStore.ts)
- [agentWorkspace/agentMemory/openClawStyleMemory.md](c:/Users/a2778/Desktop/Code/CelCat/agentWorkspace/agentMemory/openClawStyleMemory.md)

The system already persists:

- Companion identity notes
- Stable preferences
- Recent task memories
- Long-term memory signals
- Task memory markdown documents

The product gap is not persistence anymore. The gap is readable presentation and safe UI shaping.

## Product Boundary

### What Belongs In The Pet Window

- Live2D character presence
- Emotional response
- Mouth / expression feedback
- Unified conversation status
- Minimal menu and low-frequency controls
- Light identity expression such as "who are you" / "what can you do"

### What Must Stay In The Control Panel

- Task list and task details
- Approval / cancel decisions
- Task stages and timeline
- Result summaries
- Memory overview
- Identity and preference summary
- Failure states, retries, and system-level operational feedback

### What Should Not Return To The Pet Window

- Task titles
- Task progress summaries
- Workspace steps
- MCP / skill detail lists
- Compressed context dumps
- Memory document paths or raw prompt-like content
- Long diagnostic or backend execution text

## UX Principles

### Pet Window Information Hierarchy

The pet window should stay limited to 3 layers:

1. Character body
2. Single status bar
3. System menu

No fourth persistent layer should be added.

### Pet Window Interaction Rules

- Single tap: character interaction only
- Long press: window drag only
- Menu interaction: never triggers drag or character tap
- Touch / no-hover devices: menu entry remains visible
- Fullscreen: more immersive chrome, but controls never disappear entirely

### Status Priority Model

The status system should become a single selector instead of scattered conditionals.

Recommended priority from highest to lowest:

1. `error`
2. `waiting_user`
3. `delegated`
4. `assistant_speaking`
5. `assistant_thinking`
6. `user_listening`
7. `idle`

Recommended user-facing meanings:

- `error`: something important failed
- `waiting_user`: one step needs user confirmation
- `delegated`: task was sent to the background
- `assistant_speaking`: the pet is actively replying
- `assistant_thinking`: the pet is preparing a reply
- `user_listening`: the pet is listening to the user

## Control Panel V2

### V2 Product Goal

Upgrade the control panel from a thin management page into a task-and-memory workspace.

### Recommended Page Structure

#### Top Summary

- Session state
- Latest transcript
- Auto-execute state
- Active task count
- Any current approval-needed signal

#### Left Rail

- Task title
- Status
- Risk level
- Updated time
- One-line summary

#### Main Detail Area

- Summary
- Current stage
- Result
- Timeline
- Notes
- Approve / cancel actions

#### Secondary Area

- Memory
- Recent artifacts
- Identity / preferences

### UX Rules For Key States

#### Empty State

Should not only say "no task". It should remind the user that tasks can be assigned directly from the pet window.

#### Waiting For Approval

Should be elevated into a visible decision card, not only hidden in bottom action buttons.

#### Completed Task

Result summary should be the first reading target, ahead of raw steps.

#### Disconnected Control Panel

The panel should preserve the last known content and clearly show that it is reconnecting.

## Memory Visualization

Memory should be exposed as productized summaries, not as raw prompt context.

### Recommended Memory Views

#### Identity

- Current display name
- Role summary
- Identity notes
- Recent identity updates

#### Preferences

- Stable language preference
- Execution preference
- Confirmation preference
- Companion experience preference

#### Recent Work

- Recent completed or active tasks
- Result highlights
- Continuation hooks

#### Memory Docs

- Recent memory documents
- Source task
- Written time
- Short summary

### Memory Product Rules

- Memory must be understandable
- Memory must be traceable back to source work
- Identity memory and task memory must remain separate
- Control panel should show summaries first and raw documents only on drill-down

## Technical Direction

### Keep Current Architectural Boundary

The current split is directionally correct:

- Pet interaction layer: [src/renderer](c:/Users/a2778/Desktop/Code/CelCat/src/renderer)
- Control panel UI: [src/control-panel](c:/Users/a2778/Desktop/Code/CelCat/src/control-panel)
- Control panel service: [src/main-process/control-panel](c:/Users/a2778/Desktop/Code/CelCat/src/main-process/control-panel)
- Task domain model: [src/types/tasks.ts](c:/Users/a2778/Desktop/Code/CelCat/src/types/tasks.ts)
- Session state: [src/types/session.ts](c:/Users/a2778/Desktop/Code/CelCat/src/types/session.ts)
- Memory persistence: [src/main-process/agent](c:/Users/a2778/Desktop/Code/CelCat/src/main-process/agent)

### Recommended Next Technical Layer

Add a control panel view-model adapter layer in main process so UI does not directly consume raw domain objects forever.

Suggested new concepts:

- `ControlPanelDashboard`
- `ControlPanelTaskListItem`
- `ControlPanelTaskDetail`
- `MemoryOverviewCard`

### Recommended API Evolution

Keep `/api/state` as a lightweight compatibility summary.

Add:

- `GET /api/dashboard`
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `GET /api/tasks/:id/timeline`
- `GET /api/memory/overview`
- `GET /api/memory/docs/:id`
- Keep `POST /api/tasks/:id/approve`
- Keep `POST /api/tasks/:id/cancel`

### Recommended Renderer Refactor

Extract a pure status-priority selector from [src/renderer/renderer.ts](c:/Users/a2778/Desktop/Code/CelCat/src/renderer/renderer.ts) into a dedicated module such as:

- `src/renderer/status/statePriority.ts`

That selector should take:

- local voice state
- realtime session state
- assistant stream state
- background task state

and return one renderable pet status model.

## Milestones

### M1: Control Panel V2 Foundation

Must deliver:

- Improved top summary
- Better task list fields
- Timeline replacing plain step list
- Stronger waiting-user emphasis
- Stable empty / error / reconnect states

### M2: Memory Visualization

Must deliver:

- Identity view
- Preferences view
- Recent work summary
- Memory document entry points

### M3: Mature Workspace

Can deliver:

- Search and filtering
- History and archive
- Artifact previews
- Richer result reporting
- Optional light memory editing

## Immediate Backlog

Recommended order:

1. Build the pet status priority selector
2. Add control panel view-model adapter
3. Add dashboard / tasks / memory APIs
4. Upgrade control panel detail view into a timeline + approval card layout
5. Add memory overview UI

## Test Strategy

Most valuable next tests:

### Pet Status Tests

- `error` overrides everything
- `waiting_user` outranks delegated work
- `assistant_speaking` outranks listening
- delegated background work does not pollute casual chat state

### Control Panel Adapter Tests

- stable task list summaries
- correct timeline grouping
- safe memory overview shaping

### Control Panel UI Tests

- dashboard request failure
- empty timeline
- empty memory overview
- reconnect state
- approval card behavior

### Memory Tests

- identity aggregation
- preferences aggregation
- recent work aggregation
- long-term highlight aggregation

## Success Criteria

We should consider this direction successful when:

- The pet window stays emotionally clear and operationally quiet
- Users can understand current work from the control panel within seconds
- Approval-needed work is hard to miss
- Memory becomes visible and useful without becoming noisy
- The product feels like a companion plus workspace, not a debug shell with a face
