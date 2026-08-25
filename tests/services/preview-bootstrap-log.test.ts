import { describe, expect, it } from 'vitest';
import { bootstrapLogMessage } from '@/lib/services/preview';

// Ścieżka preview scaffolduje przez rejestr template'ów
// (`getTemplate(project.templateType).scaffold(...)`), ale log tuż przed tym
// wywołaniem miał nazwę frameworka wpisaną na sztywno — projekt Astro
// zgłaszał w logu, że bootstrapuje się Next.js. Nazwa musi pochodzić z tego
// samego miejsca co scaffold.
describe('bootstrapLogMessage', () => {
  it('nazywa framework template\'u projektu', () => {
    expect(bootstrapLogMessage('astro', 'proj-1')).toBe(
      'Bootstrapping minimal Astro app for project proj-1'
    );
    expect(bootstrapLogMessage('nextjs', 'proj-1')).toBe(
      'Bootstrapping minimal Next.js app for project proj-1'
    );
  });

  it('brak i nieznany typ schodzą do domyślnego template\'u, jak sam scaffold', () => {
    expect(bootstrapLogMessage(null, 'proj-2')).toBe(
      'Bootstrapping minimal Next.js app for project proj-2'
    );
    expect(bootstrapLogMessage('vue', 'proj-2')).toBe(
      'Bootstrapping minimal Next.js app for project proj-2'
    );
  });
});
