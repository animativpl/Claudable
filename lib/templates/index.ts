import { scaffoldAstroApp } from './astro';
import { scaffoldNextApp } from './nextjs';
import { DEFAULT_TEMPLATE_ID, TEMPLATE_META, type TemplateId, type TemplateMeta } from './meta';

export type { TemplateId, TemplateMeta } from './meta';
export { DEFAULT_TEMPLATE_ID, TEMPLATE_META, TEMPLATE_META_LIST, normalizeTemplateType } from './meta';

export interface ProjectTemplate extends TemplateMeta {
  scaffold(projectPath: string, projectId: string): Promise<void>;
}

export const TEMPLATES: Record<TemplateId, ProjectTemplate> = {
  nextjs: { ...TEMPLATE_META.nextjs, scaffold: scaffoldNextApp },
  astro: { ...TEMPLATE_META.astro, scaffold: scaffoldAstroApp },
};

/**
 * Nieznane albo brakujące id schodzi do domyślnego template'u — istniejące
 * projekty nie mają zapisanego typu, a wybuch przy ich otwieraniu byłby
 * gorszy niż założenie Next.js, którym i tak wszystkie są.
 */
export function getTemplate(id?: string | null): ProjectTemplate {
  if (id && id in TEMPLATES) {
    return TEMPLATES[id as TemplateId];
  }
  return TEMPLATES[DEFAULT_TEMPLATE_ID];
}
