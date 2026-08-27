import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types/chat';
import {
  extractToolCallId,
  deriveToolInfoFromMetadata,
  parseToolPlaceholder,
  stripToolPlaceholderLines,
  createToolMessageFromPlaceholder,
  expandMessageWithToolPlaceholder,
  expandMessagesList,
  hashString,
  metadataEquals,
  areMessagesEqual,
  mergeMetadataObjects,
  mergeMessageRecord,
  ensureMessageIdentity,
  integrateMessages,
} from '@/lib/serializers/client/tool-messages';

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'msg_1',
  projectId: 'proj_1',
  role: 'assistant',
  messageType: 'chat',
  content: 'hello',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('extractToolCallId', () => {
  it('reads a direct toolCallId field', () => {
    expect(extractToolCallId({ toolCallId: 'call_1' })).toBe('call_1');
  });

  it('reads a nested tool_call.id field when no direct field is present', () => {
    expect(extractToolCallId({ tool_call: { id: 'call_2' } })).toBe('call_2');
  });

  it('returns null when metadata is absent or has no id', () => {
    expect(extractToolCallId(null)).toBeNull();
    expect(extractToolCallId({})).toBeNull();
  });
});

describe('deriveToolInfoFromMetadata', () => {
  it('derives action and file path from metadata fields', () => {
    const info = deriveToolInfoFromMetadata({ toolName: 'Edit', filePath: 'app/page.tsx' });
    expect(info.toolName).toBe('Edit');
    expect(info.filePath).toBe('app/page.tsx');
    expect(info.action).toBe('Edited');
  });

  it('returns an empty object when metadata is absent', () => {
    expect(deriveToolInfoFromMetadata(null)).toEqual({});
  });
});

describe('parseToolPlaceholder', () => {
  it('parses a [Tool: X] target line', () => {
    const parsed = parseToolPlaceholder('[Tool: Read] app/page.tsx');
    expect(parsed?.toolName).toBe('Read');
    expect(parsed?.target).toBe('app/page.tsx');
    expect(parsed?.action).toBe('Read');
  });

  it('parses a "Using tool: X on Y" line', () => {
    const parsed = parseToolPlaceholder('Using tool: Bash on npm test');
    expect(parsed?.toolName).toBe('Bash');
    expect(parsed?.target).toBe('npm test');
  });

  it('returns null for plain, non-placeholder content', () => {
    expect(parseToolPlaceholder('just a regular message')).toBeNull();
    expect(parseToolPlaceholder(null)).toBeNull();
  });
});

describe('stripToolPlaceholderLines', () => {
  it('removes placeholder lines but keeps the rest of the content', () => {
    const input = '[Tool: Read] app/page.tsx\nActual assistant reply';
    expect(stripToolPlaceholderLines(input)).toBe('Actual assistant reply');
  });
});

describe('createToolMessageFromPlaceholder / expandMessageWithToolPlaceholder', () => {
  it('converts a placeholder-only message into a tool message and drops the original', () => {
    const message = makeMessage({ content: '[Tool: Read] app/page.tsx' });
    const expanded = expandMessageWithToolPlaceholder(message);
    expect(expanded).toHaveLength(1);
    expect(expanded[0].role).toBe('tool');
    expect(expanded[0].messageType).toBe('tool_use');
    expect(expanded[0].id).toBe('msg_1::tool');
  });

  it('leaves a multi-line message with an embedded placeholder-like prefix untouched, since parseToolPlaceholder only matches a single-line whole message', () => {
    // Locks in real (if surprising) current behaviour: the bracket/using-tool/tool-result
    // regexes all end in `(.*)$` with no /s or /m flag, so they only match when the ENTIRE
    // trimmed content is one line. A newline anywhere makes parseToolPlaceholder return null,
    // so the message passes through unchanged instead of being split.
    const message = makeMessage({ content: '[Tool: Read] app/page.tsx\nHere is the summary' });
    const expanded = expandMessageWithToolPlaceholder(message);
    expect(expanded).toEqual([message]);
  });

  it('leaves non-placeholder messages untouched', () => {
    const message = makeMessage({ content: 'plain text' });
    expect(expandMessageWithToolPlaceholder(message)).toEqual([message]);
  });

  it('returns skipOriginal true and no sanitizedContent when called directly on a placeholder-only message', () => {
    const message = makeMessage({ content: '[Tool: Read] app/page.tsx' });
    const conversion = createToolMessageFromPlaceholder(message);
    expect(conversion).not.toBeNull();
    expect(conversion?.skipOriginal).toBe(true);
    expect(conversion?.sanitizedContent).toBeUndefined();
    expect(conversion?.toolMessage.metadata).toMatchObject({ toolName: 'Read', filePath: 'app/page.tsx' });
  });

  it('returns null when called directly on non-placeholder content', () => {
    expect(createToolMessageFromPlaceholder(makeMessage({ content: 'plain text' }))).toBeNull();
  });
});

describe('expandMessagesList', () => {
  it('expands placeholders and drops exact-id duplicates', () => {
    const message = makeMessage({ id: 'dup', content: 'hi' });
    const result = expandMessagesList([message, message], (m) => m.id!);
    expect(result).toHaveLength(1);
  });

  it('drops tool messages with duplicate content under different ids', () => {
    const a = makeMessage({ id: 'a', role: 'tool', content: 'same output' });
    const b = makeMessage({ id: 'b', role: 'tool', content: 'same output' });
    const result = expandMessagesList([a, b], (m) => m.id!);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});

describe('hashString', () => {
  it('is deterministic for equal inputs', () => {
    expect(hashString('same value')).toBe(hashString('same value'));
  });

  it('differs for different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('metadataEquals / areMessagesEqual', () => {
  it('treats deep-equal metadata objects as equal', () => {
    expect(metadataEquals({ a: 1 }, { a: 1 })).toBe(true);
    expect(metadataEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('treats identical message lists as equal by reference', () => {
    const list = [makeMessage()];
    expect(areMessagesEqual(list, list)).toBe(true);
  });

  it('detects a content change between otherwise-identical lists', () => {
    const a = [makeMessage({ content: 'one' })];
    const b = [makeMessage({ content: 'two' })];
    expect(areMessagesEqual(a, b)).toBe(false);
  });
});

describe('mergeMetadataObjects', () => {
  it('lets incoming values override existing ones', () => {
    expect(mergeMetadataObjects({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it('does not let an empty incoming string clobber a non-empty existing one', () => {
    expect(mergeMetadataObjects({ summary: 'real summary' }, { summary: '' })).toEqual({
      summary: 'real summary',
    });
  });

  it('prefers non-empty incoming attachments over existing ones', () => {
    const merged = mergeMetadataObjects(
      { attachments: [{ name: 'old.png' }] },
      { attachments: [{ name: 'new.png' }] }
    );
    expect((merged as any).attachments).toEqual([{ name: 'new.png' }]);
  });
});

describe('mergeMessageRecord', () => {
  it('keeps existing content when the incoming update has empty content', () => {
    const existing = makeMessage({ content: 'streamed so far' });
    const incoming = makeMessage({ content: '' });
    const merged = mergeMessageRecord(existing, incoming);
    expect(merged.content).toBe('streamed so far');
  });

  it('returns the incoming content when it is non-empty', () => {
    const existing = makeMessage({ content: 'old' });
    const incoming = makeMessage({ content: 'new' });
    const merged = mergeMessageRecord(existing, incoming);
    expect(merged.content).toBe('new');
  });
});

describe('ensureMessageIdentity', () => {
  it('leaves a message with an id untouched', () => {
    const message = makeMessage({ id: 'has_id' });
    expect(ensureMessageIdentity(message)).toBe(message);
  });

  it('assigns a new id to a message with no id', () => {
    const message = makeMessage({ id: '' });
    const result = ensureMessageIdentity(message);
    expect(result.id).toBeTruthy();
  });
});

describe('integrateMessages', () => {
  it('returns the same reference when nothing changed', () => {
    const previous = [makeMessage()];
    expect(integrateMessages(previous, [])).toBe(previous);
  });

  it('replaces an optimistic message with the confirmed one sharing its requestId', () => {
    const optimistic = makeMessage({
      id: 'optimistic_1',
      requestId: 'req_1',
      isOptimistic: true,
      content: 'sending...',
    });
    const confirmed = makeMessage({
      id: 'confirmed_1',
      requestId: 'req_1',
      isOptimistic: false,
      content: 'sent',
    });

    const result = integrateMessages([optimistic], [confirmed]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('confirmed_1');
    expect(result[0].content).toBe('sent');
  });

  it('preserves attachments from a replaced optimistic message when the confirmed one has none', () => {
    const optimistic = makeMessage({
      id: 'optimistic_2',
      requestId: 'req_2',
      isOptimistic: true,
      metadata: { attachments: [{ name: 'photo.png' }] } as any,
    });
    const confirmed = makeMessage({
      id: 'confirmed_2',
      requestId: 'req_2',
      isOptimistic: false,
    });

    const result = integrateMessages([optimistic], [confirmed]);

    expect(result).toHaveLength(1);
    expect((result[0].metadata as any)?.attachments).toEqual([{ name: 'photo.png' }]);
  });

  it('merges an update for an existing message id instead of duplicating it', () => {
    const existing = makeMessage({ id: 'msg_stream', content: 'partial', isStreaming: true });
    const update = makeMessage({ id: 'msg_stream', content: 'complete', isStreaming: false, isFinal: true });

    const result = integrateMessages([existing], [update]);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('complete');
    expect(result[0].isFinal).toBe(true);
  });

  it('sorts merged messages by createdAt', () => {
    const first = makeMessage({ id: 'a', createdAt: '2026-01-01T00:00:01.000Z' });
    const second = makeMessage({ id: 'b', createdAt: '2026-01-01T00:00:00.000Z' });

    const result = integrateMessages([], [first, second]);

    expect(result.map((m) => m.id)).toEqual(['b', 'a']);
  });
});
