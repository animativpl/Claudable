# Design record — persistent per-project agent session + safe shutdown

2026-09-02. Resolves the open decision this record closes: spec.md decision 11.

## Problem

Reported symptom: AI agent sessions/subagents running inside Claudable-hosted
projects die unexpectedly, with no user action, and the only recovery is a
manual message telling the agent to check current file state and continue
("kontynuuj") instead of restarting from scratch. Investigated two candidate
causes; both turned out real and independent.

### A. Restart-orphan (container-restart-triggered)

Confirmed on the deployed instance (`ssh user@10.101.101.102`, container
`claudable-claudable-1`, `docker ps` restart-policy `no`):

- `docker logs -t` shows one clean cycle: `13:34:30 [Shutdown] SIGTERM:
  killed 0 preview process tree(s)` → process back up at `13:34:31`. Host
  `bash_history` shows this was a manual `docker restart` on the same
  container ID — not a crash loop, not an external watchdog (no cron/systemd
  timer, no Watchtower found on the host).
- `instrumentation-node.ts`'s `shutdown()` only calls
  `previewManager.killAllSync()`. The Claude Agent SDK's spawned subprocess
  (inside `executeClaude()`, `lib/services/cli/claude.ts`) is never
  registered anywhere and is never explicitly killed at shutdown.
- `reconcileStaleRequests()` (`lib/services/user-requests.ts:153-171`) blindly
  marks every non-terminal `UserRequest` as `failed: "Interrupted by a server
  restart"` at next startup, on the assumption that nothing survives a
  restart — an assumption nothing in the code enforces for agent processes
  (only for preview dev-servers, via `PreviewManager`).
- Pulled the live production DB (`docker cp` + local `sqlite3`): only 6
  `user_requests` rows total, all `completed`. Zero `failed`/`processing`
  rows — meaning this reconciliation path has *never* actually fired in
  production. The symptom the user described does not go through
  `UserRequest` at all, which pointed at cause B.

### B. Background-subagent death on every turn (no restart needed)

From `@anthropic-ai/claude-agent-sdk`'s own type docs
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1631-1644`,
`Options.perTaskStopAffordance`):

> Closed-input exception: on a one-shot run (the string `prompt` form and
> `-p`, which close stdin), hold-back tasks are still killed when the held
> result is released, regardless of this declaration — with stdin closed, a
> `stop_task` control could never be delivered, so the fail-closed kill
> stands. The CLI also fails closed on absence: without the declaration, an
> interrupt kills background tasks.

`executeClaude()` calls `query({ prompt: instruction, ... })` where
`instruction` is a plain `string` (`lib/services/cli/claude.ts:532`) — the
exact "one-shot run, closed stdin" case. This means: **every single turn**,
any background subagent/task still running when the main turn's result is
released gets killed by the SDK/CLI itself, independent of Claudable's
server health, container restarts, or anything else. `perTaskStopAffordance`
cannot fix this in a one-shot invocation — it only spares background tasks
on an *open-input* (interactive stream-json) session.

Confirmed this is a real usage pattern, not theoretical: `executeClaude()`
loads `.claude/agents` subagent definitions
(`loadAgentDefinitions`/`agents-loader.ts`) into every session, and the
deployed project's own message history (`metadataJson` on a stored message)
contains a `SendMessage` tool call to a peer session instructing it to
"check git status... continue exactly where you left off per your original
brief (Task 3: ...) — do not restart from scratch" — direct evidence of a
real multi-agent build that was killed mid-task and had to be manually
resumed.

## Approaches considered

1. **Fix only the shutdown-orphan gap (A), leave one-shot invocation as-is.**
   Rejected as the sole fix once B was found: it would make server-restart
   handling honest, but would do nothing for the dominant, restart-independent
   failure mode the user actually described ("padają nawet bez restartu
   kontenera").
2. **Keep per-message spawn, but delay closing the prompt's input until
   background tasks settle.** Considered as a smaller alternative to a fully
   persistent session — pass `prompt` as an `AsyncIterable` for a single
   message instead of a string, and hold off ending the iterable until any
   background `task_notification`s also complete, instead of ending it right
   after the visible turn's result. Rejected: this still needs the same
   bookkeeping a persistent session needs (tracking outstanding background
   tasks, deciding when it's safe to close), while gaining none of the
   benefit of actually reusing the process for the next message. Once you're
   keeping stdin open past the visible turn, there is no real simplification
   left over just holding the session open across turns.
3. **Persistent per-project `Query`, chosen.** One long-lived Agent SDK
   session per project, created on the first message via an open
   `AsyncIterable` prompt that is never closed, fed via `query.streamInput()`
   for every subsequent message instead of spawning a fresh process +
   `resume: sessionId`. `perTaskStopAffordance: true` becomes meaningful
   because input genuinely stays open. Registered in a new
   `lib/services/cli/agent-session-registry.ts`, mirroring the existing
   `PreviewManager` pattern exactly (`Map`, `killAllSync()` reusing
   `killProcessTree` from `lib/services/process-tree.ts`) — so `A` is closed
   by construction: `instrumentation-node.ts`'s `shutdown()` gets one more
   `killAllSync()` call, synchronous, same tick, same shape as the existing
   preview call.

## Chosen design

- **`spawnClaudeCodeProcess`** (`Options`, already used for A) captures the
  real child process and registers it keyed by `projectId` in
  `agent-session-registry.ts`.
- **First message for a project:** `query({ prompt: <open AsyncIterable>,
  options: { ...buildClaudeQueryOptions(...), perTaskStopAffordance: true }
  })`. The returned `Query` is held in the registry alongside the process
  handle.
- **Subsequent messages:** looked up in the registry by `projectId`; pushed
  into the same session via `query.streamInput()` instead of a new spawn.
- **Turn/message correlation:** the consumption loop now spans multiple
  turns instead of ending after one message. It must track which `requestId`
  the current turn belongs to using the SDK's turn-boundary message (the
  result message that already ends the `for await` loop in the current
  one-shot code) rather than assuming loop-exit means the request is done —
  the loop no longer exits between turns.
- **Idle eviction:** a project with no activity for an idle window gets its
  session `.close()`'d and evicted from the registry, so opened-then-abandoned
  projects don't accumulate live subprocesses forever. Timeout value is an
  **open product decision** — no default chosen here (see Open risks).
- **Shutdown:** `instrumentation-node.ts`'s `shutdown()` calls
  `agentSessionRegistry.killAllSync()` alongside `previewManager.killAllSync()`,
  same synchronous, single-tick shape.
- **Startup reconciliation, expanded scope (per approval mid-brainstorm):**
  `reconcileStaleRequests()` no longer only marks stale `UserRequest`s
  `failed`. For each stale request, it attempts to auto-resume via the
  project's saved `activeClaudeSessionId` (`resume: sessionId`) with a
  synthesized continuation message ("check current file state before
  continuing — do not restart from scratch," mirroring what the real deployed
  incident needed a human to type manually). Falls back to `failed:
  "Interrupted by a server restart"` when resume itself fails (e.g. session
  no longer resumable).

## Open risks — not resolved by this record

1. **Unverified assumption:** that keeping the `AsyncIterable` prompt open
   actually avoids the "closed-input" classification and lets
   `perTaskStopAffordance` spare background tasks. Read from SDK type docs,
   not exercised. The plan's first task must be a throwaway spike that proves
   this against the real `@anthropic-ai/claude-agent-sdk` package before
   anything else is built on top of it.
2. **Idle-timeout value** for evicting an inactive project's persistent
   session is undecided — needs a default chosen during planning/implementation,
   flagged here rather than picked silently.
3. **Turn/message correlation** inside one long-lived consumption loop is the
   trickiest implementation surface — needs the SDK's exact turn-boundary
   message type identified precisely before the loop can be restructured
   safely.

## Rejected scope

- A user-facing "Stop" button/endpoint for the AI chat — explicitly out of
  scope; this record is about session lifecycle correctness, not new
  product-visible controls.
