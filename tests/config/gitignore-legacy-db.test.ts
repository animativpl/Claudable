import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// A legacy install that once used Prisma's own default `prisma/dev.db`
// location (before this project standardized on `data/cc.db`) can still have
// a stale `prisma/*.db` file sitting in the checkout, holding plaintext
// GitHub PATs. Without a .gitignore entry, `git add -A` there would stage
// and commit it. Verified against a real, isolated git repo seeded with the
// project's actual .gitignore, so this exercises real `git check-ignore`
// behavior rather than just grepping the file for lines.
const GITIGNORE = path.join(__dirname, '..', '..', '.gitignore');

let root: string;

function isIgnored(relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', relPath], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-legacy-db-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.copyFileSync(GITIGNORE, path.join(root, '.gitignore'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('.gitignore: legacy prisma/*.db files', () => {
  it('ignores a stale prisma/dev.db from a pre-data/cc.db install', () => {
    expect(isIgnored('prisma/dev.db')).toBe(true);
  });

  it('ignores prisma/*.db-journal', () => {
    expect(isIgnored('prisma/dev.db-journal')).toBe(true);
  });

  it('ignores prisma/*.db-wal', () => {
    expect(isIgnored('prisma/dev.db-wal')).toBe(true);
  });
});
