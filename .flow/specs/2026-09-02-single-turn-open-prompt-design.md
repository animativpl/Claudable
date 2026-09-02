# Design record — single-turn open prompt (supersedes persistent-session design)

2026-09-02. Supersedes `.flow/specs/2026-09-02-persistent-agent-session-design.md`,
which spec.md decision 11 pointed at. That record's cause A (shutdown-orphan)
and chosen architecture for cause B (persistent cross-project `Query`) were
both wrong in ways a red-team pass and a follow-up verification pass caught
before implementation — this record keeps that one as a historical account of
what was deliberated and why it changed, and replaces decision 11's target
with the design below.

## Why the previous design changed

`writing-plans`' required red-team pass on the 10-task plan built from the
persistent-session design returned a **RETHINK** verdict, having read the
actual compiled `@anthropic-ai/claude-agent-sdk/sdk.mjs` bundle instead of
trusting the `.d.ts` doc comments the original design was built on:

- **Cause A was factually wrong.** The SDK already tracks every subprocess it
  spawns and kills it with `SIGTERM` on the host process's `process.exit()`
  (a module-level tracker, `class _2` / instance `sy`, registered via
  `process.on('exit', ...)`). `instrumentation-node.ts`'s `shutdown()` already
  calls `process.exit(0)`. The agent subprocess is already killed today, by
  the same mechanism and in the same tick the previous design's registry
  would have added. The registry (Tasks 2-4 of the discarded plan) mostly
  duplicated existing behavior.
- **The one thing a custom `spawnClaudeCodeProcess` hook could have added —
  process-*group* kill, reaching Bash-tool-spawned grandchildren — turned out
  unreachable by construction.** A follow-up verification pass (reading
  `sdk.mjs` further) found the CLI's Bash tool spawns its own persistent shell
  with `detached: true`, in its own process group, deliberately isolated by
  Anthropic's own CLI. No process-tree kill starting from the `claude`
  subprocess Claudable spawns can ever reach it — the previous design's whole
  premise for Part A (kill the group, catch the grandchildren) was not
  achievable the way it was built, or any other way from Claudable's side.
- **The custom spawn hook would have broken stderr capture and risked a pipe
  deadlock** — the SDK only wires stderr draining inside its own default
  local spawn path; a custom `spawnClaudeCodeProcess` receives no such wiring
  and nothing in the previous design's `spawnAndRegister` drained fd 2.
- **`perTaskStopAffordance` was irrelevant to the actual reported bug.** A
  second verification pass found it referenced exactly 4 times in the
  bundle, always as pass-through into the CLI init handshake and the
  `interrupt()` RPC options — never anywhere near the kill/cleanup logic. The
  single line that actually decides whether background tasks survive a
  turn's end checks only `isSingleUserTurn` (`typeof prompt === 'string'`),
  not any per-task-stop-affordance flag. Declaring `perTaskStopAffordance:
  true` while never wiring `stopTask()` (which the previous design did) would
  have been a genuine lie to the SDK's contract for zero actual benefit —
  Claudable never calls `interrupt()` at all (no Stop UI, a scope explicitly
  rejected earlier in this same design pass).
- **The persistent cross-project session (holding one `Query` alive across
  many chat messages) is what created every hard, unsolved correctness
  problem the red-team found**, none of which exist in the current
  one-`query()`-per-message code: cross-turn message misattribution (nothing
  drained the session between turns, so a surviving background task's output
  landed on the *next* message's `requestId`), concurrent-turn corruption
  (`act/route.ts` has no per-project concurrency guard, and two overlapping
  messages would now share one iterator), frozen per-turn options (model/
  subagents/MCP servers only re-read once per session instead of once per
  message), and the idle-eviction machinery needed to bound it all.

## What actually causes the reported bug, confirmed

`executeClaude()` calls `query({ prompt: instruction, options: {...} })`
where `instruction` is a plain string
(`lib/services/cli/claude.ts:532`). A follow-up verification pass read the
exact mechanism in `sdk.mjs`:

```
{isSingleUserTurn:typeof e==="string"}                          // query() entry
if(this.isSingleUserTurn) ... this.transport.endInput()          // on first `result`
```

A string prompt makes `isSingleUserTurn` true, and stdin closes the instant
the *first* `result` message arrives — regardless of whether a
Task-tool-dispatched background subagent is still running. That is the whole
mechanism. Nothing else needs to change to fix it: keep the prompt from being
a plain string, and don't close it until it's actually safe to.

The same pass confirmed the clean way to close it later: `streamInput()`
internally does `for await (let n of e) {...}` over the prompt iterable and,
**once that loop ends on its own** (the generator returns), calls
`this.transport.endInput()` — the exact same call the string-prompt path
makes, just triggered by the generator returning instead of by the first
`result`. No explicit `query.close()`, no separate signal — ending the
async generator function is the whole mechanism.

## Chosen design

**Drop Part A entirely** (no registry, no custom `spawnClaudeCodeProcess`, no
extra `shutdown()` wiring). The SDK's own exit-tracking already keeps
`reconcileStaleRequests()`'s "every unclosed run is dead at restart"
assumption true for what Claudable can affect; the Bash-tool-grandchild edge
case is architecturally unreachable from Claudable's side and specific to a
non-Docker deployment, which is not this session's evidence (the confirmed
production incident was a Docker container restart, already fully handled by
container teardown).

**Part B shrinks to one self-contained change in `executeClaude()`:** replace
the string `prompt` with a small async generator that:
1. yields one `SDKUserMessage` for the instruction,
2. is read by the *same* message-consumption loop `executeClaude()` already
   runs (no new loop, no new file) — that loop already sees every message
   type; it additionally tracks `task_started` messages with
   `is_backgrounded: true` (recording their `task_id`) and removes them from
   that set on a matching `task_notification`,
3. once the loop has seen `result` *and* that pending-background-task set is
   empty, signals the generator (a resolved promise/deferred created before
   `query()` is called) to return.

`executeClaude()`'s public signature, its use of `resume: sessionId`, its
per-message `buildClaudeQueryOptions()` call, and its stderr callback wiring
are all **unchanged** — this is an addition to existing per-message code, not
a rewrite of its control flow. No `perTaskStopAffordance`.

**Part C (auto-resume on restart) is kept, with the previous design's real
bugs fixed rather than the feature dropped:**
- A stale request whose project can no longer be found is marked `failed`
  (not silently dropped, leaving a permanently non-terminal row).
- The resume attempt is wrapped so a failure falls back to `failed:
  "Interrupted by a server restart"`, matching what the original design
  already specified but the previous plan's Task 9 didn't implement.
- The top-level trigger has a `.catch`, so a DB error at boot cannot become
  an unhandled rejection that kills the server during startup.
- The request's status is flipped before the resume attempt starts, so a
  crash-loop restart cannot re-trigger the same resume indefinitely.

## Open risks

1. Coordinating the prompt generator's return with the consumption loop's
   `task_started`/`task_notification` bookkeeping is new code, even though
   small — it should get its own unit test (constructing the tracking logic
   as a small pure function/class, not inline in the 900-line
   `executeClaude`) rather than only being exercised by a live SDK call.
2. This design has not been run against the real SDK either. Unlike the
   previous design, there is no single unverified premise it depends
   on — every claim above is sourced from reading `sdk.mjs` directly — but a
   small live spike (same shape as the previous plan's Task 1, much cheaper
   now that it only has one thing to prove) is still worth keeping as the
   first task, since a compiled bundle read is not the same as observing the
   real behavior end to end.

## Rejected scope

- A user-facing "Stop" button/endpoint — still out of scope, unchanged from
  the previous record.
- Any process-group/registry mechanism for the agent subprocess — actively
  rejected this pass, not merely deferred, given it's unreachable for the
  one case (Bash-tool grandchildren) it would have targeted.
