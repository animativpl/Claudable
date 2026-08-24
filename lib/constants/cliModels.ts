import {
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_MODEL_DEFINITIONS,
  getClaudeModelDisplayName,
  normalizeClaudeModelId,
  type ClaudeModelDefinition,
} from './claudeModels';

/**
 * Claude Code jest jedynym agentem. Te funkcje trzymają parametr `cli`, bo
 * wołają je dziesiątki miejsc, ale nie rozgałęziają już na nim niczego.
 */
export function getDefaultModelForCli(_cli?: string | null): string {
  return CLAUDE_DEFAULT_MODEL;
}

export function normalizeModelId(_cli: string | null | undefined, model?: string | null): string {
  return normalizeClaudeModelId(model);
}

export function getModelDisplayName(_cli: string | null | undefined, modelId?: string | null): string {
  return getClaudeModelDisplayName(normalizeClaudeModelId(modelId));
}

export function getModelDefinitionsForCli(_cli?: string | null): ClaudeModelDefinition[] {
  return CLAUDE_MODEL_DEFINITIONS;
}
