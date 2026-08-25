export type TemplateId = 'nextjs' | 'astro';

export interface TemplateMeta {
  id: TemplateId;
  label: string;
  description: string;
  /**
   * Instrukcja dla agenta, wstrzykiwana do initial prompta przy pierwszym
   * uruchomieniu projektu. To nie jest tekst dla użytkownika — `description`
   * jest widoczny w UI, to pole nie.
   */
  initialPromptPreamble: string;
}

/** Bez importów `fs` — ten plik musi być importowalny z komponentu klienckiego. */
export const TEMPLATE_META: Record<TemplateId, TemplateMeta> = {
  nextjs: {
    id: 'nextjs',
    label: 'Next.js',
    description: 'React with the App Router, server components and API routes',
    initialPromptPreamble:
      'Create a new Next.js 15 application using the App Router, TypeScript, and Tailwind CSS, with the following requirements:',
  },
  astro: {
    id: 'astro',
    label: 'Astro',
    description: 'Content-first static site generator with island hydration',
    initialPromptPreamble:
      'Create a new Astro application using TypeScript, with the following requirements:',
  },
};

export const TEMPLATE_META_LIST: TemplateMeta[] = Object.values(TEMPLATE_META);

export const DEFAULT_TEMPLATE_ID: TemplateId = 'nextjs';

export function normalizeTemplateType(value?: string | null): TemplateId {
  const candidate = value?.trim().toLowerCase();
  if (candidate && candidate in TEMPLATE_META) {
    return candidate as TemplateId;
  }
  return DEFAULT_TEMPLATE_ID;
}
