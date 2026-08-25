import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAgentDefinitions, parseAgentMarkdown } from '@/lib/services/cli/agents-loader';

const AGENT_MD = `---
name: reviewer
description: Reviews a diff and reports findings.
tools: Read, Grep, Bash
model: opus
---
You are a reviewer. Report findings, do not fix them.
`;

describe('parseAgentMarkdown', () => {
  it('czyta frontmatter i treść promptu', () => {
    const parsed = parseAgentMarkdown(AGENT_MD);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('reviewer');
    expect(parsed!.definition.description).toBe('Reviews a diff and reports findings.');
    expect(parsed!.definition.tools).toEqual(['Read', 'Grep', 'Bash']);
    expect(parsed!.definition.model).toBe('opus');
    expect(parsed!.definition.prompt).toContain('You are a reviewer.');
  });

  it('pomija plik bez frontmatteru', () => {
    expect(parseAgentMarkdown('Just a note.')).toBeNull();
  });

  it('pomija plik bez nazwy albo bez opisu', () => {
    expect(parseAgentMarkdown('---\ndescription: no name\n---\nbody')).toBeNull();
    expect(parseAgentMarkdown('---\nname: nameless\n---\nbody')).toBeNull();
  });

  it('pomija nieznany model zamiast go przepuszczać', () => {
    const parsed = parseAgentMarkdown('---\nname: a\ndescription: d\nmodel: gpt-4\n---\nbody');
    expect(parsed!.definition.model).toBeUndefined();
  });
});

describe('loadAgentDefinitions', () => {
  it('zbiera definicje z wielu katalogów, późniejszy wygrywa', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
    const userDir = path.join(base, 'user', 'agents');
    const projectDir = path.join(base, 'project', 'agents');
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(userDir, 'reviewer.md'), AGENT_MD);
    await fs.writeFile(path.join(userDir, 'notes.txt'), 'ignored');
    await fs.writeFile(
      path.join(projectDir, 'reviewer.md'),
      '---\nname: reviewer\ndescription: Project override.\n---\nProject prompt.\n'
    );

    const agents = await loadAgentDefinitions([userDir, projectDir]);
    expect(Object.keys(agents)).toEqual(['reviewer']);
    expect(agents.reviewer.description).toBe('Project override.');
  });

  it('znosi nieistniejący katalog', async () => {
    await expect(loadAgentDefinitions(['/nope/nowhere'])).resolves.toEqual({});
  });

  it('pomija definicję kolidującą z wbudowanym subagentem', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-builtin-'));
    const dir = path.join(base, 'agents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'general-purpose.md'),
      '---\nname: general-purpose\ndescription: Custom override attempt.\n---\nbody'
    );
    await fs.writeFile(
      path.join(dir, 'reviewer.md'),
      '---\nname: reviewer\ndescription: Fine, no collision.\n---\nbody'
    );

    const agents = await loadAgentDefinitions([dir]);
    expect(agents).not.toHaveProperty('general-purpose');
    expect(agents).toHaveProperty('reviewer');
  });
});
