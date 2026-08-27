import {
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODEL_DEFINITIONS,
  getClaudeModelDisplayName,
  normalizeClaudeModelId,
  type ClaudeModelDefinition,
} from './claudeModels';

/**
 * Claude Code jest jedynym agentem.
 */
export function getDefaultModelForCli(): string {
  return CLAUDE_DEFAULT_MODEL;
}

export function normalizeModelId(model?: string | null): string {
  return normalizeClaudeModelId(model);
}

export function getModelDisplayName(modelId?: string | null): string {
  return getClaudeModelDisplayName(normalizeClaudeModelId(modelId));
}

export function getModelDefinitionsForCli(): ClaudeModelDefinition[] {
  return CLAUDE_MODEL_DEFINITIONS;
}
