import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Obraz runtime bierze `node_modules` z tracingu `next build --standalone`,
// a ten nie widzi `scripts/`, więc `dotenv` w kontenerze nie istnieje —
// `docker compose exec claudable npm run db:backup` padał na
// `Cannot find module 'dotenv'`. Odtwarzamy ten warunek uruchamiając kopię
// skryptu w katalogu tymczasowym: rozwiązywanie modułów idzie w górę drzewa,
// a /tmp nie prowadzi do `node_modules` tego repozytorium.
const SOURCE = path.join(__dirname, '..', '..', 'scripts', 'migrate-drop-legacy.js');

let root: string;
let scriptPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-standalone-'));
  scriptPath = path.join(root, 'migrate-drop-legacy.js');
  fs.copyFileSync(SOURCE, scriptPath);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('migrate-drop-legacy bez dotenv w node_modules', () => {
  it('robi backup, gdy DATABASE_URL jest już w środowisku', () => {
    const dbPath = path.join(root, 'cc.db');
    fs.writeFileSync(dbPath, 'nie-pusta-baza');

    const output = execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(scriptPath)}).runBackupCli()`],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      }
    );

    expect(output).toContain('backup: ');
    const backupDir = path.join(root, 'backups');
    const backups = fs.readdirSync(backupDir);
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(backupDir, backups[0]), 'utf8')).toBe('nie-pusta-baza');
  });
});
