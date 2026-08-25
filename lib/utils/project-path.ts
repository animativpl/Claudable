import path from 'node:path';

const PROJECTS_DIR = process.env.PROJECTS_DIR || './data/projects';

export const PROJECTS_DIR_ABSOLUTE = path.isAbsolute(PROJECTS_DIR)
  ? PROJECTS_DIR
  : path.resolve(process.cwd(), PROJECTS_DIR);

/**
 * Jedyne miejsce liczące katalog projektu. Trzy kopie tej logiki rozjechały
 * się wcześniej na fallbacku `cwd/projects/<id>`, którego walidacja adaptera
 * nie akceptowała — użytkownik dostawał błąd bezpieczeństwa zamiast projektu.
 */
export function resolveProjectRoot(projectId: string, repoPath?: string | null): string {
  if (repoPath) {
    return path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath);
  }
  return path.join(PROJECTS_DIR_ABSOLUTE, projectId);
}

/**
 * Rozwiązuje ścieżkę względną wewnątrz katalogu projektu i odrzuca każdą,
 * która z niego wychodzi.
 */
export function resolveSafeProjectPath(projectRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(projectRoot);
  const resolved = path.resolve(normalizedRoot, relativePath);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Path escapes the project directory: resolved outside ${normalizedRoot}`);
  }
  return resolved;
}
