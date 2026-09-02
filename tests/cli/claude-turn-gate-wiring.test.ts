import os from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  markUserRequestAsRunning: vi.fn(async () => {}),
  markUserRequestAsCompleted: vi.fn(async () => {}),
  markUserRequestAsFailed: vi.fn(async () => {}),
  getProjectById: vi.fn(async () => ({ id: 'project-1', name: 'Project One' })),
  updateProject: vi.fn(async () => {}),
  createMessage: vi.fn(async () => ({ id: 'message-1' })),
  publish: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }));
vi.mock('@/lib/services/user-requests', () => ({
  markUserRequestAsRunning: mocks.markUserRequestAsRunning,
  markUserRequestAsCompleted: mocks.markUserRequestAsCompleted,
  markUserRequestAsFailed: mocks.markUserRequestAsFailed,
}));
vi.mock('@/lib/services/project', () => ({
  getProjectById: mocks.getProjectById,
  updateProject: mocks.updateProject,
}));
vi.mock('@/lib/services/message', () => ({ createMessage: mocks.createMessage }));
vi.mock('@/lib/services/stream', () => ({ streamManager: { publish: mocks.publish } }));
vi.mock('@/lib/services/cli/agents-loader', () => ({ loadAgentDefinitions: async () => ({}) }));
vi.mock('@/lib/services/cli/mcp-servers-loader', () => ({ loadUserScopeMcpServers: async () => ({}) }));

import { executeClaude } from '@/lib/services/cli/claude';

type ChannelItem =
  | { kind: 'message'; message: SDKMessage }
  | { kind: 'error'; error: unknown }
  | { kind: 'end' };

/**
 * A hand-driven stand-in for the SDK's response stream, so a test can decide
 * exactly when each message arrives — and, crucially, whether more arrive
 * after `result`.
 */
function createChannel() {
  const buffer: ChannelItem[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  return {
    push(message: SDKMessage) {
      buffer.push({ kind: 'message', message });
      notify();
    },
    fail(error: unknown) {
      buffer.push({ kind: 'error', error });
      notify();
    },
    end() {
      buffer.push({ kind: 'end' });
      notify();
    },
    async *stream(): AsyncGenerator<SDKMessage> {
      for (;;) {
        while (buffer.length > 0) {
          const item = buffer.shift()!;
          if (item.kind === 'end') return;
          if (item.kind === 'error') throw item.error;
          yield item.message;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/**
 * Installs a `query()` that models the one behaviour of the real SDK this
 * task depends on: the response stream ends when the prompt stream ends
 * (stdin close -> CLI exit). A prompt that never returns keeps the turn open.
 */
function installFakeSdk() {
  const channel = createChannel();
  let promptEnded = false;

  mocks.query.mockImplementation((args: { prompt: unknown }) => {
    void (async () => {
      for await (const _turn of args.prompt as AsyncIterable<SDKUserMessage>) {
        // The user turn itself is irrelevant here; only when the stream ends is.
      }
      promptEnded = true;
      channel.end();
    })();
    return channel.stream();
  });

  return { channel, promptEnded: () => promptEnded };
}

const backgroundTasksChanged = (tasks: Array<{ task_id: string; ambient?: boolean }>) =>
  ({ type: 'system', subtype: 'background_tasks_changed', tasks }) as unknown as SDKMessage;

const resultMessage = () =>
  ({ type: 'result', subtype: 'success' }) as unknown as SDKMessage;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

const run = () =>
  executeClaude('project-1', os.tmpdir(), 'dispatch a background subagent', undefined, undefined, 'request-1');

describe('executeClaude background-task gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProjectById.mockResolvedValue({ id: 'project-1', name: 'Project One' });
  });

  it('holds the turn open past result until the live background task clears', async () => {
    const { channel } = installFakeSdk();
    const execution = run();
    let settled = false;
    void execution.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    channel.push(backgroundTasksChanged([{ task_id: 'task-1' }]));
    channel.push(resultMessage());
    await settle();

    expect(settled).toBe(false);
    expect(mocks.markUserRequestAsCompleted).not.toHaveBeenCalled();

    channel.push(backgroundTasksChanged([]));
    await execution;

    expect(mocks.markUserRequestAsCompleted).toHaveBeenCalledTimes(1);
  });

  it('completes a turn with no background tasks as soon as result arrives', async () => {
    const { channel } = installFakeSdk();
    const execution = run();

    channel.push(resultMessage());
    await execution;

    expect(mocks.markUserRequestAsCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markUserRequestAsFailed).not.toHaveBeenCalled();
  });

  it('keeps a request completed when the stream fails after result', async () => {
    const { channel } = installFakeSdk();
    const execution = run();

    channel.push(backgroundTasksChanged([{ task_id: 'task-1' }]));
    channel.push(resultMessage());
    await settle();
    channel.fail(new Error('transport closed unexpectedly'));

    await expect(execution).rejects.toThrow('transport closed unexpectedly');
    expect(mocks.markUserRequestAsCompleted).toHaveBeenCalledTimes(1);
    expect(mocks.markUserRequestAsFailed).not.toHaveBeenCalled();
  });

  it('closes the prompt stream when the turn fails before result', async () => {
    const { channel, promptEnded } = installFakeSdk();
    const execution = run();

    channel.fail(new Error('claude exited early'));

    await expect(execution).rejects.toThrow('claude exited early');
    await settle();

    expect(promptEnded()).toBe(true);
    expect(mocks.markUserRequestAsFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markUserRequestAsCompleted).not.toHaveBeenCalled();
  });
});
