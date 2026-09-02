#!/usr/bin/env node
// THROWAWAY VERIFICATION, not production code. Confirms the mechanism Task
// 2/3 wire into executeClaude() for real: a prompt AsyncGenerator that
// yields one user message and keeps waiting until a `background_tasks_changed`
// level signal reports no live (non-ambient) tasks AND `result` has arrived,
// keeps a genuinely backgrounded Task-tool subagent alive past the main
// turn's `result`, and that returning the generator afterward closes the
// session cleanly. Run twice: once on a fresh session, once resuming it —
// see the file header note on why the resumed case matters.
//
// Run manually: node scripts/spike-open-prompt.mjs
// Needs real Claude credentials — same ones this shell already has.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Both legs share ONE cwd: Claude Code stores session transcripts keyed by
// (encoded) cwd, so resuming a session id under a DIFFERENT cwd than it was
// created in either errors or silently starts a fresh session — either way
// the second leg would prove nothing about resumed-session behavior, which
// is the whole reason it exists (see file header).
const cwd = mkdtempSync(path.join(tmpdir(), 'spike-'));
const SLEEP_SECONDS = 180; // long enough that model latency to `result` can't
// beat it and produce a flaky false negative on `markerPresentAtResult`.
const GATE_TIMEOUT_MS = 5 * 60 * 1000;

async function runOnce(label, { resumeSessionId } = {}) {
  // Unique per run so the second leg doesn't see the first leg's leftover
  // marker file and misread it as "already present at result".
  const markerFile = path.join(cwd, `background-task-done-${label.replace(/\s+/g, '-')}.txt`);
  const instruction =
    `Use the Task tool to dispatch a background subagent (general-purpose) ` +
    `whose ONLY job is: sleep ${SLEEP_SECONDS} seconds, then write the exact ` +
    `text DONE (no newline) to the file ${markerFile} using the Write tool. ` +
    `Dispatch it in the background, then immediately reply "dispatched" ` +
    `without waiting for it to finish.`;

  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const gateTimeout = setTimeout(() => {
    console.error(`[${label}] gate timed out after ${GATE_TIMEOUT_MS}ms — still-live task ids: ${[...liveTaskIds]}`);
    releaseGate();
  }, GATE_TIMEOUT_MS);
  gateTimeout.unref?.();

  async function* prompt() {
    yield {
      type: 'user',
      message: { role: 'user', content: instruction },
      parent_tool_use_id: null,
    };
    await gate;
  }

  const response = query({
    prompt: prompt(),
    options: {
      cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });

  let sessionId;
  const liveTaskIds = new Set();
  let sawBackgroundedTask = false;
  let resultSeen = false;
  let markerPresentAtResult = false;

  try {
    for await (const message of response) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      } else if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
        liveTaskIds.clear();
        for (const t of message.tasks) {
          if (!t.ambient) {
            liveTaskIds.add(t.task_id);
            sawBackgroundedTask = true;
          }
        }
      } else if (message.type === 'result') {
        // Latch at the FIRST result only. An agent whose settingSources pull in
        // a CLAUDE.md encouraging autonomous multi-step behavior can emit
        // multiple result messages on one open generator before the gate
        // condition is met, none of them a newly pushed user message. Only the
        // first one is the moment that actually tests the premise.
        if (!resultSeen) {
          markerPresentAtResult = existsSync(markerFile);
          console.log(`[${label}] result received; marker already present: ${markerPresentAtResult}`);
        } else {
          console.log(`[${label}] additional result received (autonomous continuation, not a new pushed message)`);
        }
        resultSeen = true;
      }
      if (resultSeen && liveTaskIds.size === 0) {
        releaseGate();
      }
    }
  } catch (error) {
    clearTimeout(gateTimeout);
    console.error(`[${label}] threw:`, error);
    return { ok: false, sessionId };
  }
  clearTimeout(gateTimeout);

  const survived =
    existsSync(markerFile) && readFileSync(markerFile, 'utf8').trim() === 'DONE';
  console.log(
    `[${label}] sawBackgroundedTask=${sawBackgroundedTask} markerPresentAtResult=${markerPresentAtResult} finalSurvived=${survived}`
  );
  if (markerPresentAtResult) {
    // Inconclusive, not a disproof: the background task simply finished
    // before `result` arrived (model was slower than SLEEP_SECONDS this
    // run). Re-run rather than treating this as a failed premise.
    console.error(`[${label}] INCONCLUSIVE — marker was already present at result. Re-run (consider raising SLEEP_SECONDS).`);
    return { ok: null, sessionId };
  }
  // Genuinely proves the premise only if: the task was actually reported as
  // backgrounded (not silently run in the foreground before result), it had
  // NOT yet finished at the moment result arrived, and it did finish
  // eventually.
  const ok = sawBackgroundedTask && survived;
  if (!ok) {
    console.error(`[${label}] FAILED`);
  }
  return { ok, sessionId };
}

const first = await runOnce('fresh session');
const second = first.sessionId
  ? await runOnce('resumed session', { resumeSessionId: first.sessionId })
  : { ok: false, sessionId: undefined };

console.log('\n=== RESULT ===');
console.log(`fresh session:   ${first.ok}`);
console.log(`resumed session: ${second.ok}`);
if (first.ok === null || second.ok === null) {
  console.error('\nINCONCLUSIVE run(s) above — re-run before drawing any conclusion.');
  process.exit(2);
}
const confirmed = first.ok === true && second.ok === true;
if (!confirmed) {
  console.error(
    '\nDESIGN PREMISE NOT CONFIRMED. Stop here — do not proceed to Task 2. ' +
      'Report this output and escalate.'
  );
}
process.exit(confirmed ? 0 : 1);
