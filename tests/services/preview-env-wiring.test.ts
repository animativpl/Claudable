import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Znalezisko z drugiej rundy review Task 17: `preview-dev-env.test.ts` i
// `preview-install-env.test.ts` sprawdzają `buildDevServerEnv`/`buildInstallEnv`
// w izolacji, ale nic nie pilnowało, że `preview.ts` faktycznie ich woła przy
// spawnie procesu, zamiast wracać do gołego `{ ...process.env }` w miejscu
// wywołania. Dokładnie tak przeciekł scrub numer dwa w pierwszej rundzie tego
// zadania — scrub istniał i był przetestowany, jedna ścieżka spawnu po prostu
// go nie wołała. Ten test pilnuje samego podłączenia, nie budowniczych.
//
// Zaktualizowane w Task 19 fixup: scrub dla ścieżki agenta (`childEnv` w
// `cli/claude-options.ts`) filtrował dawniej tylko prefiks `CLAUDE_*` i nie
// odcinał `NODE_ENV`/`__NEXT_PRIVATE_*`, mimo że proces agenta uruchamia
// `npm install` i buildy w projekcie użytkownika przez Bash — dokładnie ta
// sama trasa wycieku, dla której `scrubPlatformEnv` w `preview.ts` powstał.
// Naprawa wydzieliła jeden pomocnik (`scrubProcessEnv` w
// `lib/utils/env-scrub.ts`, przyjmujący allowlistę) używany przez oba
// miejsca. To przesunęło kanoniczny spread `{ ...process.env }` z
// `preview.ts` do modułu współdzielonego — więc oryginalne "dokładnie jedno
// miejsce W preview.ts" przestało być prawdą (i przestałoby być prawdą także
// dla `claude-options.ts`, gdyby test go nie obejmował). Test sprawdza teraz
// trzy pliki naraz: `env-scrub.ts` ma dokładnie jedno miejsce (kanoniczny
// scrub), a `preview.ts` i `claude-options.ts` mają zero — każdy proces
// potomny MUSI przejść przez `scrubProcessEnv`, żaden plik wywołujący nie ma
// prawa zrobić własnego surowego `{ ...process.env }`.
//
// Świadomie AST przez `typescript` (i tak zależność projektu), nie
// dopasowanie tekstu/regex: liczenie wystąpień w surowym tekście źródła jest
// kruche na formatowanie (przeniesienie spacji, złamanie linii,
// `{...process.env}` bez spacji wewnątrz nawiasów) — test failujący po
// czysto kosmetycznej zmianie uczy ludzi go obchodzić, zamiast naprawiać
// przyczynę. Parsowanie AST daje tę samą gwarancję niezależnie od stylu
// zapisu.
function countProcessEnvSpreads(relativePath: string): number {
  const filePath = path.join(__dirname, '..', '..', ...relativePath.split('/'));
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  const isProcessEnv = (node: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env';

  let spreadCount = 0;
  const visit = (node: ts.Node) => {
    if (ts.isSpreadAssignment(node) && isProcessEnv(node.expression)) {
      spreadCount++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return spreadCount;
}

describe('process.env spread stays inside the shared scrub', () => {
  it('lib/utils/env-scrub.ts owns the one canonical process.env spread', () => {
    expect(countProcessEnvSpreads('lib/utils/env-scrub.ts')).toBe(1);
  });

  it('preview.ts never spreads process.env directly (must call scrubProcessEnv)', () => {
    expect(countProcessEnvSpreads('lib/services/preview.ts')).toBe(0);
  });

  it('claude-options.ts never spreads process.env directly (must call scrubProcessEnv)', () => {
    expect(countProcessEnvSpreads('lib/services/cli/claude-options.ts')).toBe(0);
  });
});
