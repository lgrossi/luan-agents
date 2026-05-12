# Unified Spawn orchestrator spec

This document defines the next Spawn offering. It is intentionally separate
from `docs/spawn.md`: current `spawn.ts` remains the neutral lane primitive,
while this spec defines the policy layer that composes lanes, headless agents,
profiles, budgets, and observability.

## Product shape

Spawn is one user-facing offering with shared primitives behind it:

- **Run**: canonical unit of work. A run can be orchestration, research,
  handoff, implementation, verification, review, shell, or command work.
- **Lane**: execution/view backend for a run. A run can be headless,
  session-backed, pane-backed, command-backed, or promoted from headless to an
  inspectable session.
- **Profile**: independent agent policy: system prompt, tool set, context
  policy, model tier, edit policy, and isolation requirement.
- **Pipeline**: acceptance-driven graph of runs compiled by the orchestrator.
- **Trace ledger**: durable project-local metadata keyed by origin request and
  run IDs.

The LLM-facing surface must stay small:

- `orchestrate(request, mode?, budget?)`
- `lane_status(runId?|origin?)`
- `lane_result(runId, verbosity?)`

Human surfaces can be richer: `/spawn`, `/lanes`, dashboard/widget, jump,
stop, inspect, trace, and budget commands.

## Non-negotiable behavior

1. Every run is jumpable or promotable to a jumpable lane. Promotion must
   attach to the already-run agent/session transcript when the backend supports
   it; otherwise the planner chooses a session-backed lane up front.
2. Agent prompts are isolated by default. Profiles use prompt replacement and
   narrow context unless they explicitly opt into inherited prompt/context.
   Coding is a profile, not the root default.
3. Budget contention is first-class: model tier, parallelism, depth, tokens,
   tools, turns, and runtime are admitted by a scheduler before execution.
4. The orchestrator evaluates requirements, complexity, unknowns, risks, and
   acceptance criteria before compiling a pipeline. It is not done until
   acceptance is verified or the pipeline is blocked with traceable reasons.
5. Tool descriptions must be token-conscious. Complex policy belongs in local
   code/docs and UI, not in giant tool schemas.
6. UI defaults to compact feedback and dashboard/widget state. Panes/windows
   open only when requested, when the lane is interactive, or when promotion is
   needed.
7. Observability is core: every run records origin, parent, profile, prompt
   visibility, tools, token estimates/usage, duration, errors, artifacts, and
   lane references.
8. Internals stay modular. The user sees one Spawn offering; the code should
   not become one bloated extension file.

## Architecture modules

## Imported patterns from existing options

Spawn imports patterns, not extension dependencies:

- Current `spawn.ts`: keep the lane/session/tmux primitive as the
  `lane-runtime` backend.
- Mosaic: import the prompt-isolation idea (`systemPromptOverride`,
  `noContextFiles`, explicit tools/model/thinking), but implement it in
  Spawn-owned `profile-bootstrap` and `headless-runner`.
- Mosaic: import worktree isolation as a requirement for write-capable runs,
  but keep lifecycle and cleanup in Spawn.
- Mosaic/tintinweb: import compact status/widget UX direction, not pane-heavy
  full-session defaults.
- tintinweb/Nico subagents: import background-first status/result retrieval and
  result-watcher ideas, but avoid schedules, shared RPC, and broad inherited
  prompt/context behavior in the MVP.

Rejected for MVP:

- schedules and recurring jobs
- cross-extension RPC as a core primitive
- default pane/window creation for headless fanout
- parent prompt/context inheritance by default
- depending on Mosaic internals for execution

### `lane-runtime`

Owns creation, stop, read, jump, and promotion of lane backends. It wraps the
current `spawn_lane` primitive for tmux/Pi sessions and later adds headless
session promotion. It does not choose orchestration policy.

Backends:

- `headless`: no pane by default; promotable when transcript/session is known.
- `pi-session`: jumpable Pi session; can be parented or root.
- `pane`: tmux-backed visual lane.
- `command`: command/shell process lane.

### `agent-profile`

Defines profile policy. Defaults:

- `research`: read-only, prompt replacement, no parent context, cheap/balanced
  model tier, no edits.
- `product`: read-only, prompt replacement, no coding AGENTS.md/baseline prompt,
  no edits.
- `coding`: edit-capable only with explicit code-change pipeline steps and
  worktree isolation by default.
- `review`: read-only by default, prompt replacement, no edits.
- `orchestrator`: planning/synthesis only, can call Spawn tools, cannot edit.

### `profile-bootstrap`

Creates independent child sessions with explicit system prompt, active tools,
model, thinking, skills, extensions, context files, and prompt inheritance
policy. This is Spawn-owned; Mosaic's implementation is a reference pattern,
not a runtime dependency.

### `headless-runner`

Runs non-interactive profile sessions through the Pi SDK with prompt
replacement, context files disabled by default, explicit active tools, and
session files retained for local inspection. Write-capable runs use worktree
isolation before execution.

### `result-watcher`

Observes headless run promises and session metadata, then updates run status and
trace entries without opening panes. This imports the useful subagents idea of
async result watching while keeping the watcher small, local, and owned by
Spawn.

### `run-registry` / `trace-ledger`

Stores project-local records. Privacy defaults to metadata and short summaries;
full prompts/transcripts stay local and require explicit inspect/result
verbosity. The ledger is keyed by `originId` and `runId`.

Minimal run record:

- identity: `id`, `originId`, `parentRunId`, `kind`, `profile`
- status: queued/running/completed/blocked/failed/stopped
- policy: budget preset, model tier, edit/isolation policy, context policy
- lane: backend, jump reference, session/pane/worktree paths when present
- observability: started/completed times, tokens, tool count, turns, errors
- artifacts: summaries, result refs, prompt refs, transcript refs

### `budget-scheduler`

Admission control in front of orchestration. It enforces:

- max concurrent runs and queue length
- max depth/recursive spawn attempts
- per-run and total token estimates
- tool, turn, and runtime caps
- allowed model tiers and downgrade/escalation behavior
- edit isolation requirements

Balanced default: two concurrent background runs, queue overflow asks/blocks,
cheap/balanced model tiers, worktree isolation for write-capable runs.

### `orchestrator`

Compiles a goal into an executable pipeline:

1. analyze request, unknowns, risks, and acceptance criteria
2. choose mode: side-spawn, handoff, research fanout, implementation, review
3. choose profiles and lane backends under budget
4. admit runs through the scheduler
5. monitor results and acceptance criteria
6. spawn follow-ups only if depth/budget allows
7. finish with trace summary or blocked reasons

Policy stays here, not in `lane-runtime`.

### `spawn-ui`

One compact widget/dashboard shows origin, runs, status, budget, failures, and
jump actions. It prevents pane explosion: a 10-agent pipeline creates one
dashboard row group unless the user or failure mode requests inspectable lanes.

## MVP boundary

The first vertical slice should implement:

- pure core modules for profile policy, budget admission, pipeline planning, and
  trace records
- compact spec-backed tool contracts for `orchestrate`, `lane_status`, and
  `lane_result`
- integration adapter that can map admitted side-spawn/handoff steps to the
  current `spawn_lane` primitive
- headless async research planning with budget-limited concurrency
- worktree-required coding steps in the plan, even if execution initially
  uses the Spawn-owned headless runner/profile bootstrap
- a lightweight result watcher for headless status/result settlement
- dashboard/status data model before any pane-heavy UI

Deferred:

- schedules/recurring jobs
- remote dashboards
- full prompt/transcript sync outside local explicit inspection
- automatic dirty-worktree merge flows

## Scenario coverage

- Interactive research: plan a `research` run as `pi-session` or promotable
  headless; ledger exposes jump ref.
- Headless parallel research: five read-only runs admit under balanced policy as
  two running and three queued; no panes by default.
- Budget pressure: overflow queues, downgrades within allowed tiers, or returns
  ask/block reasons.
- Prompt isolation: `product` and `research` profiles replace prompts and do
  not inherit coding baseline/context.
- Failure promotion: run records keep promotion/jump state and error reason.
- Pane prevention: planner defaults fanout to `headless`, dashboard owns
  visibility.
- Acceptance-driven completion: pipeline records criteria and verification
  steps.
- Origin trace: every run is keyed to the original ask and parent run.
- Runaway prevention: depth admission blocks recursive spawn attempts.
- Cross-project lanes: default relation is root unless a parent session is
  explicit.

## Verification target

Current foundation tests:

```bash
bun test pi/agent/extensions/spawn-orchestrator/*.test.ts
bunx biome check pi/agent/extensions/spawn-orchestrator docs/spawn-orchestrator.md
```

When the foundation is wired into active settings, also run the repo-level Pi
verification and targeted end-to-end spawn checks.
