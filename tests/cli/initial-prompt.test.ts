import { describe, expect, it } from 'vitest';
import { buildInitialPrompt } from '@/lib/services/cli/initial-prompt';

describe('buildInitialPrompt', () => {
  it('dla astro zawiera instrukcję Astro i nie wspomina Next.js', () => {
    const prompt = buildInitialPrompt('astro', 'Build a blog');

    expect(prompt).toContain('Astro');
    expect(prompt).toContain('Build a blog');
    expect(prompt).not.toContain('Next.js');
  });

  it('dla nextjs zawiera instrukcję Next.js i nie wspomina Astro', () => {
    const prompt = buildInitialPrompt('nextjs', 'Build a blog');

    expect(prompt).toContain('Next.js');
    expect(prompt).toContain('Build a blog');
    expect(prompt).not.toContain('Astro');
  });
});
