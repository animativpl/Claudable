import { TEMPLATE_META, type TemplateId } from '@/lib/templates/meta';

/**
 * Buduje initial prompt dla pierwszego uruchomienia projektu. Instrukcja
 * frameworka pochodzi z rejestru template'ów (`TEMPLATE_META`), nie jest tu
 * zaszyta — inaczej agent dostaje polecenie dla innego frameworka niż ten,
 * który faktycznie wyskaffoldowano.
 */
export function buildInitialPrompt(templateId: TemplateId, initialPrompt: string): string {
  const { initialPromptPreamble } = TEMPLATE_META[templateId];

  return `
${initialPromptPreamble}
${initialPrompt}

Set up the basic project structure and implement the requested features.
`.trim();
}
