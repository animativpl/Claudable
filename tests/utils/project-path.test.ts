import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECTS_DIR_ABSOLUTE, resolveProjectRoot, resolveSafeProjectPath } from '@/lib/utils/project-path';

describe('resolveProjectRoot', () => {
  it('używa repoPath, gdy jest absolutny', () => {
    expect(resolveProjectRoot('p1', '/srv/projects/p1')).toBe('/srv/projects/p1');
  });

  it('rozwiązuje relatywny repoPath względem cwd', () => {
    expect(resolveProjectRoot('p1', './data/projects/p1')).toBe(path.resolve(process.cwd(), 'data/projects/p1'));
  });

  it('bez repoPath schodzi do katalogu projektów, nie do cwd/projects', () => {
    expect(resolveProjectRoot('p1')).toBe(path.join(PROJECTS_DIR_ABSOLUTE, 'p1'));
    expect(resolveProjectRoot('p1', null)).toBe(path.join(PROJECTS_DIR_ABSOLUTE, 'p1'));
  });

  it('przepuszcza realny projectId aplikacji (project-<timestamp>-<random>)', () => {
    expect(resolveProjectRoot('project-1700000000000-abc123def')).toBe(
      path.join(PROJECTS_DIR_ABSOLUTE, 'project-1700000000000-abc123def')
    );
  });

  it('odrzuca projectId z przejściem katalogów przez ../', () => {
    expect(() => resolveProjectRoot('../../../tmp/pwn')).toThrow(/invalid project id/i);
  });

  it('odrzuca projectId równy ".."', () => {
    expect(() => resolveProjectRoot('..')).toThrow(/invalid project id/i);
  });

  it('odrzuca projectId równy "."', () => {
    expect(() => resolveProjectRoot('.')).toThrow(/invalid project id/i);
  });

  it('odrzuca projectId z separatorem "/"', () => {
    expect(() => resolveProjectRoot('a/b')).toThrow(/invalid project id/i);
  });

  it('odrzuca projectId z separatorem "\\\\"', () => {
    expect(() => resolveProjectRoot('a\\b')).toThrow(/invalid project id/i);
  });
});

describe('resolveSafeProjectPath', () => {
  const root = '/srv/projects/p1';

  it('przepuszcza ścieżkę wewnątrz katalogu', () => {
    expect(resolveSafeProjectPath(root, 'assets/logo.png')).toBe('/srv/projects/p1/assets/logo.png');
  });

  it('przepuszcza sam katalog', () => {
    expect(resolveSafeProjectPath(root, '.')).toBe(root);
  });

  it('blokuje wyjście przez ..', () => {
    expect(() => resolveSafeProjectPath(root, '../../etc/passwd')).toThrow(/outside/i);
  });

  it('blokuje wyjście przez zagnieżdżone ..', () => {
    expect(() => resolveSafeProjectPath(root, 'assets/../../../secrets.env')).toThrow(/outside/i);
  });

  it('blokuje ścieżkę absolutną', () => {
    expect(() => resolveSafeProjectPath(root, '/etc/passwd')).toThrow(/outside/i);
  });

  it('odrzuca katalog rodzeństwa o nazwie będącej przedłużeniem bazy', () => {
    expect(() => resolveSafeProjectPath('/srv/projects/p1', '../p1-evil/secrets.env')).toThrow(/outside/i);
  });
});
