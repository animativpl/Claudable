import fs from 'fs/promises';
import path from 'path';

/**
 * Scaffold nigdy nie nadpisuje pracy użytkownika: template'y bywają
 * uruchamiane ponownie na istniejącym katalogu projektu. Jeden egzemplarz dla
 * wszystkich template'ów, obok `renderRunDevScript`.
 */
export async function writeFileIfMissing(filePath: string, contents: string) {
  try {
    await fs.access(filePath);
    return;
  } catch {
    // plik nie istnieje — zapisujemy
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, 'utf8');
}
