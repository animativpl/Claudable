import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE_ID, TEMPLATES, getTemplate, normalizeTemplateType } from '@/lib/templates';

const execFileAsync = promisify(execFile);

const scaffoldInto = async (id: 'nextjs' | 'astro') => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `tpl-${id}-`));
  await TEMPLATES[id].scaffold(dir, 'proj-test');
  return dir;
};

const readJson = async (dir: string, file: string) =>
  JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));

describe('normalizeTemplateType', () => {
  it('przepuszcza znane template\'y', () => {
    expect(normalizeTemplateType('nextjs')).toBe('nextjs');
    expect(normalizeTemplateType('astro')).toBe('astro');
  });

  it('znosi różnice w wielkości liter i spacje', () => {
    expect(normalizeTemplateType(' Astro ')).toBe('astro');
  });

  it('nieznane i puste schodzą do nextjs', () => {
    expect(normalizeTemplateType('vue')).toBe('nextjs');
    expect(normalizeTemplateType(null)).toBe('nextjs');
    expect(normalizeTemplateType(undefined)).toBe('nextjs');
  });
});

describe('getTemplate', () => {
  it('domyślnym template jest nextjs', () => {
    expect(DEFAULT_TEMPLATE_ID).toBe('nextjs');
    expect(getTemplate(null).id).toBe('nextjs');
    expect(getTemplate(undefined).id).toBe('nextjs');
  });

  it('nieznane id schodzi do domyślnego, nie wybucha', () => {
    expect(getTemplate('vue').id).toBe('nextjs');
  });
});

describe('template nextjs', () => {
  it('scaffolduje uruchamialny projekt', async () => {
    const dir = await scaffoldInto('nextjs');
    for (const file of [
      'package.json', 'tsconfig.json', 'next.config.js',
      'app/layout.tsx', 'app/page.tsx', 'app/globals.css',
      'scripts/run-dev.mjs', 'CLAUDE.md',
    ]) {
      await expect(fs.access(path.join(dir, file))).resolves.toBeUndefined();
    }
  });

  it('uruchamia dev przez wygenerowany wrapper', async () => {
    const dir = await scaffoldInto('nextjs');
    const pkg = await readJson(dir, 'package.json');
    expect(pkg.scripts.dev).toBe('node scripts/run-dev.mjs');
    expect(pkg.name).toBe('proj-test');
  });

  it('zostawia agentowi instrukcje w CLAUDE.md', async () => {
    const dir = await scaffoldInto('nextjs');
    const claudeMd = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toMatch(/Next\.js/);
    expect(claudeMd).toMatch(/preview/i);
  });

  it('nie nadpisuje istniejących plików', async () => {
    const dir = await scaffoldInto('nextjs');
    await fs.writeFile(path.join(dir, 'app/page.tsx'), 'export default function X() { return null; }');
    await TEMPLATES.nextjs.scaffold(dir, 'proj-test');
    const page = await fs.readFile(path.join(dir, 'app/page.tsx'), 'utf8');
    expect(page).toContain('function X');
  });
});

// Te trzy asercje pilnują błędu, który w duplikowanym wrapperze pojawił się
// natychmiast: `require()` w pakiecie ESM to błąd czasu wykonania, więc
// sprawdzanie samej obecności stringu w kodzie by go nie wyłapało.
describe('wygenerowany wrapper dev', () => {
  it.each(['nextjs', 'astro'] as const)('%s: jest ESM, bez require', async (id) => {
    const dir = await scaffoldInto(id);
    const runDev = await fs.readFile(path.join(dir, 'scripts/run-dev.mjs'), 'utf8');
    expect(runDev).toMatch(/^import /m);
    expect(runDev).not.toMatch(/\brequire\(/);
    expect(runDev).not.toMatch(/__dirname/);
  });

  it.each(['nextjs', 'astro'] as const)('%s: parsuje się jako moduł', async (id) => {
    const dir = await scaffoldInto(id);
    await expect(
      execFileAsync(process.execPath, ['--check', path.join(dir, 'scripts/run-dev.mjs')])
    ).resolves.toBeTruthy();
  });

  it.each(['nextjs', 'astro'] as const)('%s: binduje wszystkie interfejsy', async (id) => {
    const dir = await scaffoldInto(id);
    const runDev = await fs.readFile(path.join(dir, 'scripts/run-dev.mjs'), 'utf8');
    expect(runDev).toContain('0.0.0.0');
  });
});

describe('template astro', () => {
  it('jest w rejestrze', () => {
    expect(getTemplate('astro').id).toBe('astro');
    expect(TEMPLATES.astro.label).toBe('Astro');
  });

  it('scaffolduje uruchamialny projekt', async () => {
    const dir = await scaffoldInto('astro');
    for (const file of [
      'package.json', 'astro.config.mjs', 'tsconfig.json',
      'src/pages/index.astro', 'src/layouts/Layout.astro',
      'scripts/run-dev.mjs', 'CLAUDE.md',
    ]) {
      await expect(fs.access(path.join(dir, file))).resolves.toBeUndefined();
    }
  });

  it('jest pakietem ESM zależnym od astro, nie od nexta', async () => {
    const dir = await scaffoldInto('astro');
    const pkg = await readJson(dir, 'package.json');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.dev).toBe('node scripts/run-dev.mjs');
    expect(pkg.dependencies.astro).toMatch(/^\^\d+\.0\.0$/);
    expect(pkg.dependencies).not.toHaveProperty('next');
    // astro check bez @astrojs/check pada przy pierwszym użyciu
    expect(pkg.devDependencies).toHaveProperty('@astrojs/check');
  });

  it('deklaruje minimum Node, którego wymaga Astro', async () => {
    // `astro` w bin/astro.mjs twardo odmawia startu poniżej 22.12.0
    // (`errorNodeUnsupported()`), więc projekt użytkownika ma to powiedzieć
    // przy `npm install`, a nie paść dopiero w logu dev-servera.
    const dir = await scaffoldInto('astro');
    const pkg = await readJson(dir, 'package.json');
    expect(pkg.engines?.node).toBe('>=22.12.0');
  });

  it('mówi agentowi, że to Astro, a nie Next', async () => {
    const dir = await scaffoldInto('astro');
    const claudeMd = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toMatch(/Astro/);
    expect(claudeMd).not.toMatch(/Next\.js/);
  });
});
