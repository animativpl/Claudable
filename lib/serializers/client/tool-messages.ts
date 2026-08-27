import type { ChatMessage } from '@/types/chat';
import { normalizeChatContent } from '@/lib/serializers/client/chat';
import { randomId } from '@/lib/utils/random-id';
import { normalizeAction, inferActionFromToolName, pickFirstString, extractPathFromInput, type ToolAction } from '@/lib/tool-actions';

export const extractToolCallId = (
  metadata?: Record<string, unknown> | null
): string | null => {
  if (!metadata) return null;

  const directCandidates = [
    metadata.toolCallId,
    metadata.tool_call_id,
    metadata.toolCallID,
    metadata.tool_callID,
  ];

  for (const candidate of directCandidates) {
    const value = pickFirstString(candidate);
    if (value) {
      return value;
    }
  }

  const nested =
    (metadata.tool_call ?? metadata.toolCall ?? metadata.tool ?? null) as
      | Record<string, unknown>
      | undefined;
  if (nested && typeof nested === 'object') {
    const nestedCandidates = [
      nested.id,
      nested.toolCallId,
      nested.tool_call_id,
      nested.tool_callID,
    ];
    for (const candidate of nestedCandidates) {
      const value = pickFirstString(candidate);
      if (value) {
        return value;
      }
    }
  }

  return null;
};

export const deriveToolInfoFromMetadata = (
  metadata?: Record<string, unknown> | null
): { action?: ToolAction; filePath?: string; cleanContent?: string; toolName?: string; command?: string } => {
  if (!metadata) {
    return {};
  }

  const meta = metadata as Record<string, unknown>;
  const toolName = pickFirstString(meta.toolName) ?? pickFirstString(meta.tool_name);
  const action =
    normalizeAction(meta.action) ??
    normalizeAction(meta.operation) ??
    inferActionFromToolName(toolName);

  const directPath =
    pickFirstString(meta.filePath) ??
    pickFirstString(meta.file_path) ??
    pickFirstString(meta.targetPath) ??
    pickFirstString(meta.target_path) ??
    pickFirstString(meta.path) ??
    pickFirstString(meta.target);

  const toolInput = meta.toolInput ?? meta.tool_input ?? meta.input;
  let filePath = directPath ?? extractPathFromInput(toolInput, action);

  if (!filePath) {
    const command =
      pickFirstString(meta.command) ??
      (toolInput && typeof toolInput === 'object' ? pickFirstString((toolInput as Record<string, unknown>).command) : undefined);
    if (command) {
      filePath = command;
    }
  }

  const cleanContent =
    pickFirstString(meta.summary) ??
    pickFirstString(meta.description) ??
    pickFirstString(meta.resultSummary) ??
    pickFirstString(meta.result_summary) ??
    pickFirstString(meta.diff) ??
    pickFirstString(meta.diffInfo) ??
    pickFirstString(meta.diff_info) ??
    pickFirstString(meta.message) ??
    pickFirstString(meta.content);

  return {
    action: action ?? inferActionFromToolName(toolName),
    filePath,
    cleanContent,
    toolName,
    command: pickFirstString(meta.command) ?? (toolInput && typeof toolInput === 'object' ? pickFirstString((toolInput as Record<string, unknown>).command) : undefined),
  };
};

export const parseToolPlaceholder = (content?: string | null) => {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  let toolName: string | undefined;
  let target: string | undefined;
  let summary: string | undefined;

  const bracketMatch = trimmed.match(/^\[Tool:\s*([^\]\n]+)\s*\](.*)$/i);
  if (bracketMatch) {
    toolName = bracketMatch[1]?.trim();
    const trailing = bracketMatch[2]?.trim();
    if (trailing) {
      target = trailing;
    }
  }

  const usingToolMatch = trimmed.match(/^Using tool:\s*([^\n]+?)(?:\s+on\s+(.+))?$/i);
  if (usingToolMatch) {
    toolName = toolName ?? usingToolMatch[1]?.trim();
    const maybeTarget = usingToolMatch[2]?.trim();
    if (maybeTarget) {
      target = maybeTarget;
    }
  }

  const toolResultMatch = trimmed.match(/^Tool result:\s*(.+)$/i);
  if (toolResultMatch) {
    summary = toolResultMatch[1]?.trim() || undefined;
  }

  if (!toolName && !target && !summary) {
    return null;
  }

  return {
    toolName,
    target,
    summary,
    action: inferActionFromToolName(toolName) ?? (target ? normalizeAction('run') ?? 'Executed' : 'Executed'),
  };
};

export const stripToolPlaceholderLines = (input: string): string => {
  if (!input) return input;

  return input
    .replace(/^\s*\[Tool:[^\n]*\n?/gim, '')
    .replace(/^\s*Using tool:[^\n]*\n?/gim, '')
    .replace(/^\s*Tool result:[^\n]*\n?/gim, '')
    .trim();
};

export const randomMessageId = () => randomId('msg');

export const createToolMessageFromPlaceholder = (
  message: ChatMessage
): { toolMessage: ChatMessage; skipOriginal: boolean; sanitizedContent?: string } | null => {
  const contentText = normalizeChatContent(message.content);
  const details = parseToolPlaceholder(contentText);
  if (!details) return null;
  const { toolName, target, summary, action } = details;

  const baseMetadata =
    message.metadata && typeof message.metadata === 'object' ? { ...(message.metadata as Record<string, unknown>) } : {};

  const metadata: Record<string, unknown> = {
    ...baseMetadata,
    toolName,
    tool_name: toolName,
    filePath: target,
    file_path: target,
    summary,
    action,
  };

  const fallbackPath = target ?? summary ?? (toolName ? `Tool: ${toolName}` : undefined) ?? 'Tool action';

  const toolMessage: ChatMessage = {
    ...message,
    id: `${message.id || randomMessageId()}::tool`,
    role: 'tool',
    messageType: 'tool_use',
    content: summary ?? target ?? (toolName ? `[Tool: ${toolName}]` : contentText),
    metadata,
  };

  const sanitizedContent = stripToolPlaceholderLines(contentText);
  const skipOriginal = sanitizedContent.length === 0;

  if (!metadata.filePath) {
    metadata.filePath = fallbackPath;
    metadata.file_path = fallbackPath;
  }

  if (!metadata.summary && summary) {
    metadata.summary = summary;
  }

  return {
    toolMessage,
    skipOriginal,
    sanitizedContent: !skipOriginal && sanitizedContent !== contentText ? sanitizedContent : undefined,
  };
};

export const expandMessageWithToolPlaceholder = (message: ChatMessage): ChatMessage[] => {
  const conversion = message.messageType === 'tool_use' ? null : createToolMessageFromPlaceholder(message);
  if (!conversion) {
    return [message];
  }

  const { toolMessage, skipOriginal, sanitizedContent } = conversion;
  if (skipOriginal) {
    return [toolMessage];
  }

  const sanitizedMessage =
    sanitizedContent !== undefined ? { ...message, content: sanitizedContent } : message;

  return [toolMessage, sanitizedMessage];
};

export const hashString = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
};

export const expandMessagesList = (
  messages: ChatMessage[],
  ensureMessageId: (message: ChatMessage) => string
): ChatMessage[] => {
  const result: ChatMessage[] = [];
  const seen = new Set<string>();
  const seenByContent = new Map<string, string>(); // Track by content to detect near-duplicates

  messages.forEach((message) => {
    const expanded = expandMessageWithToolPlaceholder(message);
    expanded.forEach((entry) => {
      if (!entry.id) {
        entry.id = ensureMessageId(entry);
      }

      // Enhanced duplicate detection
      if (seen.has(entry.id)) {
        return; // Skip exact ID duplicates
      }

      // Check for content-based duplicates (for tool messages that might have different IDs)
      if (entry.role === 'tool' && entry.content) {
        const contentHash = hashString(entry.content).substring(0, 16);
        if (seenByContent.has(contentHash)) {
          const existingId = seenByContent.get(contentHash);
          if (existingId !== entry.id) {
            return; // Skip content duplicates
          }
        }
        seenByContent.set(contentHash, entry.id);
      }

      result.push(entry);
      seen.add(entry.id);
    });
  });

  return result;
};

export const metadataEquals = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export const areMessagesEqual = (prev: ChatMessage[], next: ChatMessage[]) => {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (a.id !== b.id) return false;
    if (a.role !== b.role) return false;
    if (a.messageType !== b.messageType) return false;
    if (a.content !== b.content) return false;
    if (a.updatedAt !== b.updatedAt) return false;
    if (a.requestId !== b.requestId) return false;
    if (a.isStreaming !== b.isStreaming) return false;
    if (a.isFinal !== b.isFinal) return false;
    if (a.isOptimistic !== b.isOptimistic) return false;
    if (!metadataEquals(a.metadata, b.metadata)) return false;
  }
  return true;
};

export const mergeMetadataObjects = (
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!existing && !incoming) {
    return null;
  }
  if (!existing) {
    return incoming ? { ...incoming } : null;
  }
  if (!incoming) {
    return { ...existing };
  }

  const existingAttachments = Array.isArray((existing as any)?.attachments)
    ? (existing as any).attachments
    : undefined;
  const incomingAttachments = Array.isArray((incoming as any)?.attachments)
    ? (incoming as any).attachments
    : undefined;

  const merged: Record<string, unknown> = { ...existing };

  Object.entries(incoming).forEach(([key, value]) => {
    const existingValue = merged[key];

    if (value === undefined) {
      return;
    }

    if (value === null) {
      if (existingValue !== undefined) {
        return;
      }
      merged[key] = value;
      return;
    }

    if (typeof value === 'string') {
      if (value.trim().length === 0 && typeof existingValue === 'string' && existingValue.trim().length > 0) {
        return;
      }
      merged[key] = value;
      return;
    }

    if (Array.isArray(value) && value.length === 0 && Array.isArray(existingValue) && existingValue.length > 0) {
      return;
    }

    merged[key] = value;
  });

  if (incomingAttachments && incomingAttachments.length > 0) {
    (merged as any).attachments = incomingAttachments;
  } else if (existingAttachments && existingAttachments.length > 0) {
    (merged as any).attachments = existingAttachments;
  }

  return merged;
};

export const mergeMessageRecord = (existing: ChatMessage, incoming: ChatMessage): ChatMessage => {
  const incomingContent = normalizeChatContent(incoming.content);
  const existingContent = normalizeChatContent(existing.content);
  const shouldKeepExistingContent =
    incomingContent.trim().length === 0 && existingContent.trim().length > 0;

  const resolvedCreatedAt = (() => {
    if (!existing.createdAt) return incoming.createdAt ?? existing.createdAt;
    if (!incoming.createdAt) return existing.createdAt;
    return new Date(incoming.createdAt).getTime() < new Date(existing.createdAt).getTime()
      ? incoming.createdAt
      : existing.createdAt;
  })();

  const resolvedUpdatedAt = (() => {
    const existingTime = existing.updatedAt ?? existing.createdAt;
    const incomingTime = incoming.updatedAt ?? incoming.createdAt;
    if (!existingTime) return incomingTime ?? existingTime;
    if (!incomingTime) return existingTime;
    return new Date(incomingTime).getTime() >= new Date(existingTime).getTime()
      ? incomingTime
      : existingTime;
  })();

  const mergedMetadata = mergeMetadataObjects(
    existing.metadata as Record<string, unknown> | null | undefined,
    incoming.metadata as Record<string, unknown> | null | undefined
  );

  const merged: ChatMessage = {
    ...existing,
    ...incoming,
    content: shouldKeepExistingContent ? existing.content : incoming.content,
    metadata: mergedMetadata,
    createdAt: resolvedCreatedAt ?? existing.createdAt,
    updatedAt: resolvedUpdatedAt,
    requestId: incoming.requestId ?? existing.requestId,
    isOptimistic: incoming.isOptimistic ?? existing.isOptimistic,
    isStreaming: incoming.isStreaming ?? existing.isStreaming,
    isFinal: incoming.isFinal ?? existing.isFinal,
  };

  const unchanged =
    merged.content === existing.content &&
    merged.updatedAt === existing.updatedAt &&
    merged.isStreaming === existing.isStreaming &&
    merged.isFinal === existing.isFinal &&
    merged.isOptimistic === existing.isOptimistic &&
    merged.requestId === existing.requestId &&
    metadataEquals(merged.metadata, existing.metadata);

  return unchanged ? existing : merged;
};

export const ensureMessageIdentity = (message: ChatMessage): ChatMessage => {
  if (message.id) {
    return message;
  }
  return { ...message, id: randomMessageId() };
};

export const integrateMessages = (
  previous: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] => {
  if (incoming.length === 0) {
    return previous;
  }

  const map = new Map<string, ChatMessage>();

  previous.forEach((original) => {
    const message = ensureMessageIdentity(original);
    map.set(message.id, message);
  });

  incoming.forEach((rawMessage) => {
    let message = ensureMessageIdentity(rawMessage);

    if (!message.isOptimistic && message.requestId) {
      let preservedAttachments: any[] | undefined;

      Array.from(map.entries()).forEach(([key, existing]) => {
        if (existing.requestId === message.requestId && existing.isOptimistic) {
          const existingAttachments = Array.isArray((existing.metadata as any)?.attachments)
            ? (existing.metadata as any).attachments
            : undefined;
          if (
            existingAttachments &&
            existingAttachments.length > 0 &&
            (!preservedAttachments || preservedAttachments.length === 0)
          ) {
            preservedAttachments = [...existingAttachments];
          }
          map.delete(key);
        }
      });

      if (
        preservedAttachments &&
        preservedAttachments.length > 0 &&
        (!Array.isArray((message.metadata as any)?.attachments) ||
          ((message.metadata as any)?.attachments?.length ?? 0) === 0)
      ) {
        message = {
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            attachments: preservedAttachments,
          },
        };
      }
    }

    const existing = map.get(message.id);
    if (existing) {
      const merged = mergeMessageRecord(existing, message);
      map.set(merged.id ?? message.id, merged);
    } else {
      map.set(message.id, message);
    }
  });

  const sorted = Array.from(map.values()).sort((a, b) => {
    const timeDiff =
      new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return (a.id ?? '').localeCompare(b.id ?? '');
  });

  return areMessagesEqual(previous, sorted) ? previous : sorted;
};
