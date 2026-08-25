import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

const ALLOWED_MODELS = new Set(['sonnet', 'opus', 'haiku', 'inherit']);

// Wbudowane subagenty, które SDK dostarcza niezależnie od `settingSources`
// (zmierzone w payloadzie init w Task 13). Plik definiujący jedną z tych
// nazw i tak by nie dodał nowego subagenta — tylko po cichu zderzył się
// z istniejącym, więc traktujemy to jako pominięcie, nie nadpisanie.
const BUILTIN_AGENT_NAMES = new Set(['general-purpose', 'statusline-setup', 'Explore', 'Plan']);

const splitList = (value: string): string[] =>
  value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);

/**
 * `settingSources` wnosi z dysku skille, hooki i CLAUDE.md, ale nie definicje
 * subagentów — te trafiają do sesji wyłącznie przez opcję `agents`. Terminal
 * je widzi, więc żeby zachować parytet, czytamy je sami.
 */
export function parseAgentMarkdown(source: string): { name: string; definition: AgentDefinition } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) {
    return null;
  }
  const [, frontmatter, body] = match;

  const fields = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key) fields.set(key, value);
  }

  const name = fields.get('name');
  const description = fields.get('description');
  if (!name || !description) {
    return null;
  }

  const rawModel = fields.get('model');
  const tools = fields.get('tools');
  const disallowedTools = fields.get('disallowedtools');

  const definition: AgentDefinition = {
    description,
    prompt: body.trim(),
    ...(tools ? { tools: splitList(tools) } : {}),
    ...(disallowedTools ? { disallowedTools: splitList(disallowedTools) } : {}),
    ...(rawModel && ALLOWED_MODELS.has(rawModel)
      ? { model: rawModel as AgentDefinition['model'] }
      : {}),
  };

  return { name, definition };
}

/**
 * Katalogi są przetwarzane w podanej kolejności — późniejszy nadpisuje
 * wcześniejszego, więc definicja z katalogu projektu wygrywa z globalną.
 * Nieczytelne pliki i katalogi, które nie istnieją, nie mogą wywrócić startu
 * sesji — ale pomijamy je z logiem, żeby "brak subagenta" dało się odróżnić
 * od "nie wiadomo, czego brakuje".
 */
export async function loadAgentDefinitions(dirs: string[]): Promise<Record<string, AgentDefinition>> {
  const agents: Record<string, AgentDefinition> = {};

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        // Katalog agents/ jest opcjonalny — jego brak to normalny stan, nie awaria.
        continue;
      }
      // Katalog istnieje, ale nie da się go odczytać (np. uprawnienia) — to
      // jest informacja, nie szum.
      console.warn(`[AgentsLoader] Skipped directory ${dir}: could not read it`, error);
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const filePath = path.join(dir, entry);

      let source: string;
      try {
        source = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        console.warn(`[AgentsLoader] Skipped ${filePath}: could not read file`, error);
        continue;
      }

      const parsed = parseAgentMarkdown(source);
      if (!parsed) {
        console.warn(`[AgentsLoader] Skipped ${filePath}: missing or invalid frontmatter (need name + description)`);
        continue;
      }

      if (BUILTIN_AGENT_NAMES.has(parsed.name)) {
        console.warn(`[AgentsLoader] Skipped ${filePath}: name "${parsed.name}" collides with a built-in subagent`);
        continue;
      }

      agents[parsed.name] = parsed.definition;
    }
  }

  return agents;
}
