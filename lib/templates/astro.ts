import fs from 'fs/promises';
import path from 'path';
import { renderRunDevScript } from './run-dev';
import { writeFileIfMissing } from './write-file';

export async function scaffoldAstroApp(projectPath: string, projectId: string) {
  await fs.mkdir(projectPath, { recursive: true });

  const packageJson = {
    name: projectId,
    private: true,
    version: '0.1.0',
    type: 'module',
    // Astro 7 odmawia startu poniżej tej wersji Node (`bin/astro.mjs`
    // sprawdza `>=22.12.0` i kończy `errorNodeUnsupported()`). Deklarujemy to
    // tam, gdzie obowiązuje, żeby npm powiedział o tym przy instalacji.
    engines: {
      node: '>=22.12.0',
    },
    scripts: {
      dev: 'node scripts/run-dev.mjs',
      build: 'astro build',
      preview: 'astro preview',
      check: 'astro check',
    },
    dependencies: {
      astro: '^7.0.0',
    },
    devDependencies: {
      '@astrojs/check': '^0.9.0',
      typescript: '^5.7.2',
    },
  };

  await writeFileIfMissing(
    path.join(projectPath, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  );

  // Astro przy zajętym porcie po cichu bierze następny wolny, więc platforma
  // zapisałaby adres podglądu wskazujący w pustkę. `strictPort` nie istnieje
  // w configu Astro — to opcja Vite'a, przekazywana kluczem `vite`.
  await writeFileIfMissing(
    path.join(projectPath, 'astro.config.mjs'),
    `import { defineConfig } from 'astro/config';

export default defineConfig({
  vite: {
    server: {
      // The platform assigns this project's port. Fail on a taken port
      // instead of quietly moving to the next one, which would leave the
      // preview pointing at nothing.
      strictPort: true,
    },
  },
});
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'tsconfig.json'),
    `{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "node_modules"]
}
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'src/layouts/Layout.astro'),
    `---
interface Props {
  title: string;
}

const { title } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>

<style is:global>
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-height: 100vh;
    font-family: system-ui, sans-serif;
  }
</style>
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'src/pages/index.astro'),
    `---
import Layout from '../layouts/Layout.astro';
---

<Layout title="Astro app">
  <main
    style="display:grid;place-items:center;min-height:100vh;gap:2rem;padding:2rem;text-align:center"
  >
    <h1 style="font-size:3rem;font-weight:600;margin:0">Get started by editing</h1>
    <code style="font-family:monospace;padding:12px 20px;background:rgba(0,0,0,0.05);border-radius:8px">
      src/pages/index.astro
    </code>
  </main>
</Layout>
`
  );

  await writeFileIfMissing(
    path.join(projectPath, 'scripts/run-dev.mjs'),
    renderRunDevScript({
      label: 'Astro',
      binary: 'astro',
      preArgs: ['dev'],
      postArgs: ['--host', '0.0.0.0'],
    })
  );

  await writeFileIfMissing(
    path.join(projectPath, 'CLAUDE.md'),
    `# Project conventions

This is an Astro application.

- Pages are files under \`src/pages\`; routing comes from the file tree.
- Shared page shells live in \`src/layouts\`. Components go in \`src/components\`.
- Component frontmatter (between \`---\` fences) runs at build time on the
  server. Client-side interactivity needs an explicit \`client:*\` directive.
- Keep every file directly under this project root. Never scaffold a
  framework into a subdirectory — run generators against the current
  directory instead.
- The platform installs dependencies and runs the preview dev server for
  you. You do not need to start one, and a second dev server on another
  port will not be reachable.
- The live preview URL is in \`NEXT_PUBLIC_APP_URL\`. Read it rather than
  assuming a port.
`
  );
}
