export type TemplateId = 'nextjs' | 'astro';

export interface TemplateMeta {
  id: TemplateId;
  label: string;
  description: string;
}

/** Bez importów `fs` — ten plik musi być importowalny z komponentu klienckiego. */
export const TEMPLATE_META: Record<TemplateId, TemplateMeta> = {
  nextjs: {
    id: 'nextjs',
    label: 'Next.js',
    description: 'React with the App Router, server components and API routes',
  },
  astro: {
    id: 'astro',
    label: 'Astro',
    description: 'Content-first static site generator with island hydration',
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
