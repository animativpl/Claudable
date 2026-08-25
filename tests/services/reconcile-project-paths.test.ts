import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `Project.repoPath` trzyma absolutną ścieżkę hosta, zapisaną raz przy
// tworzeniu projektu. Po przeniesieniu instalacji do kontenera, gdzie
// PROJECTS_DIR=/data/projects, każdy wcześniejszy wiersz wskazuje na katalog,
// którego w kontenerze nie ma — a to repoPath jest źródłem prawdy dla
// katalogu roboczego agenta, dla preview i dla `fs.rm(..., {recursive, force})`
// przy usuwaniu projektu. Objaw jest cichy: lista projektów renderuje się
// z bazy, więc aplikacja wygląda zdrowo, a agent i preview padają.

const findMany = vi.fn();
const update = vi.fn();

vi.mock('@/lib/db/client', () => ({
  prisma: { project: { findMany, update } },
}));

let projectsDir: string;
let savedProjectsDir: string | undefined;

beforeEach(async () => {
  savedProjectsDir = process.env.PROJECTS_DIR;
  projectsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-paths-'));
  process.env.PROJECTS_DIR = projectsDir;
  vi.resetModules();
  findMany.mockReset();
  update.mockReset();
  update.mockResolvedValue({});
});

afterEach(async () => {
  if (savedProjectsDir === undefined) delete process.env.PROJECTS_DIR;
  else process.env.PROJECTS_DIR = savedProjectsDir;
  await fs.rm(projectsDir, { recursive: true, force: true });
});

describe('reconcileProjectPaths', () => {
  it('przepisuje repoPath, gdy stara ścieżka zniknęła, a katalog leży w PROJECTS_DIR', async () => {
    await fs.mkdir(path.join(projectsDir, 'moved'), { recursive: true });
    findMany.mockResolvedValueOnce([
      { id: 'moved', repoPath: '/dawna/sciezka/hosta/moved' },
    ]);

    const { reconcileProjectPaths } = await import('@/lib/services/project');
    const count = await reconcileProjectPaths();

    expect(count).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'moved' },
      data: { repoPath: path.join(projectsDir, 'moved') },
    });
  });

  it('nie rusza projektu, którego repoPath nadal istnieje', async () => {
    const stillThere = path.join(projectsDir, 'kept');
    await fs.mkdir(stillThere, { recursive: true });
    findMany.mockResolvedValueOnce([{ id: 'kept', repoPath: stillThere }]);

    const { reconcileProjectPaths } = await import('@/lib/services/project');
    const count = await reconcileProjectPaths();

    expect(count).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  // Wariant "zawsze licz z PROJECTS_DIR" zepsułby przypadek, w którym pliki
  // NIE przeniosły się razem z katalogiem — wtedy repoPath jest jedyną
  // poprawną wskazówką i nadpisanie go skasowałoby informację.
  it('nie rusza projektu, którego katalogu nie ma w żadnym z dwóch miejsc', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'gone', repoPath: '/dawna/sciezka/hosta/gone' },
    ]);

    const { reconcileProjectPaths } = await import('@/lib/services/project');
    const count = await reconcileProjectPaths();

    expect(count).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  // Jeden zły wiersz nie może unieważnić rekoncyliacji pozostałych.
  // `resolveProjectRoot` rzuca przy id z `/`, `\\`, `.` lub `..`, a wyjątek
  // rzucony w pętli uciekał do zewnętrznego `catch`: logował się raz i zwracał
  // 0, zostawiając wszystkie dalsze projekty nierozliczone. Awaria cicha.
  it('rozlicza pozostałe projekty, gdy jeden ma id nie do rozwiązania', async () => {
    await fs.mkdir(path.join(projectsDir, 'moved'), { recursive: true });
    findMany.mockResolvedValueOnce([
      { id: '../escape', repoPath: '/dawna/sciezka/hosta/escape' },
      { id: 'moved', repoPath: '/dawna/sciezka/hosta/moved' },
    ]);

    const { reconcileProjectPaths } = await import('@/lib/services/project');
    const count = await reconcileProjectPaths();

    expect(count).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'moved' },
      data: { repoPath: path.join(projectsDir, 'moved') },
    });
  });

  it('zwraca zero i nie wybucha, gdy odczyt padnie (np. baza jeszcze nie istnieje)', async () => {
    findMany.mockRejectedValueOnce(new Error('no such table: projects'));

    const { reconcileProjectPaths } = await import('@/lib/services/project');

    await expect(reconcileProjectPaths()).resolves.toBe(0);
  });
});
