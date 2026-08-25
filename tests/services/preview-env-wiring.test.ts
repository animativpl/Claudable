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
// Test liczy węzły AST postaci `{ ...process.env }` (SpreadAssignment, którego
// wyrażeniem jest `process.env`) w całym pliku źródłowym `preview.ts`. Dziś
// jest dokładnie jedno takie miejsce: wewnątrz `scrubClaudeSessionEnv`. Gdyby
// ktoś przywrócił surowe `{ ...process.env }` w `installDependencies` albo w
// `start()` zamiast wołać `buildInstallEnv`/`buildDevServerEnv`, ten test
// złapie drugie wystąpienie — niezależnie od tego, które dokładnie miejsce to
// zrobiło.
//
// Świadomie AST przez `typescript` (i tak zależność projektu), nie
// dopasowanie tekstu/regex: liczenie wystąpień w surowym tekście źródła jest
// kruche na formatowanie (przeniesienie spacji, złamanie linii,
// `{...process.env}` bez spacji wewnątrz nawiasów) — test failujący po
// czysto kosmetycznej zmianie uczy ludzi go obchodzić, zamiast naprawiać
// przyczynę. Parsowanie AST daje tę samą gwarancję niezależnie od stylu
// zapisu.
describe('preview.ts wiring: process.env spread stays inside the scrub', () => {
  it('spreads process.env in exactly one place in the source (the scrub)', () => {
    const filePath = path.join(__dirname, '..', '..', 'lib', 'services', 'preview.ts');
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true
    );

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

    expect(spreadCount).toBe(1);
  });
});
