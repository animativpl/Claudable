export interface RunDevSpec {
  /** Nazwa w logu startowym, np. "Next.js" */
  label: string;
  /** Binarka odpalana przez npx, np. "next" albo "astro" */
  binary: string;
  /** Argumenty przed --port, np. ["dev"] */
  preArgs: string[];
  /** Argumenty po --port, np. ["--hostname", "0.0.0.0"] */
  postArgs: string[];
}

/**
 * Jeden generator dla wszystkich template'ów. Emituje ESM, bo template
 * z `"type": "module"` nie uruchomi wrappera z `require()`. Parser argumentów
 * i resolver portu istnieją tu raz, a nie raz na framework.
 */
export function renderRunDevScript(spec: RunDevSpec): string {
  // Port jest znany w czasie działania, nie generowania — stąd marker.
  const argTemplate = JSON.stringify([...spec.preArgs, '--port', '__PORT__', ...spec.postArgs]);

  return [
    '#!/usr/bin/env node',
    "import { spawn } from 'node:child_process';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    '',
    "const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');",
    "const isWindows = process.platform === 'win32';",
    '',
    'function parseCliArgs(argv) {',
    '  const passthrough = [];',
    '  let preferredPort;',
    '  for (let i = 0; i < argv.length; i += 1) {',
    '    const arg = argv[i];',
    "    if (arg === '--port' || arg === '-p') {",
    '      const value = argv[i + 1];',
    "      if (value && !value.startsWith('-')) {",
    '        const parsed = Number.parseInt(value, 10);',
    '        if (!Number.isNaN(parsed)) preferredPort = parsed;',
    '        i += 1;',
    '        continue;',
    '      }',
    "    } else if (arg.startsWith('--port=')) {",
    "      const parsed = Number.parseInt(arg.slice('--port='.length), 10);",
    '      if (!Number.isNaN(parsed)) preferredPort = parsed;',
    '      continue;',
    '    }',
    '    passthrough.push(arg);',
    '  }',
    '  return { preferredPort, passthrough };',
    '}',
    '',
    'function resolvePort(preferredPort) {',
    '  const candidates = [preferredPort, process.env.PORT, process.env.PREVIEW_PORT_START, 3100];',
    '  for (const candidate of candidates) {',
    '    if (candidate === undefined || candidate === null) continue;',
    "    const numeric = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate), 10);",
    '    if (!Number.isNaN(numeric) && numeric > 0 && numeric <= 65535) return numeric;',
    '  }',
    '  return 3100;',
    '}',
    '',
    'const { preferredPort, passthrough } = parseCliArgs(process.argv.slice(2));',
    'const port = resolvePort(preferredPort);',
    'const url = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${port}`;',
    '',
    'process.env.PORT = String(port);',
    'process.env.NEXT_PUBLIC_APP_URL = url;',
    '',
    `console.log(\`🚀 Starting ${spec.label} dev server on \${url}\`);`,
    '',
    `const args = ${argTemplate}.map((arg) => (arg === '__PORT__' ? String(port) : arg));`,
    `const child = spawn('npx', ['${spec.binary}', ...args, ...passthrough], {`,
    '  cwd: projectRoot,',
    "  stdio: 'inherit',",
    '  shell: isWindows,',
    "  env: { ...process.env, PORT: String(port), NEXT_PUBLIC_APP_URL: url, NEXT_TELEMETRY_DISABLED: '1' },",
    '});',
    '',
    "child.on('exit', (code) => {",
    "  if (typeof code === 'number' && code !== 0) {",
    `    console.error(\`❌ ${spec.label} dev server exited with code \${code}\`);`,
    '    process.exit(code);',
    '  }',
    '});',
    '',
    "child.on('error', (error) => {",
    `  console.error('❌ Failed to start the ${spec.label} dev server');`,
    '  console.error(error instanceof Error ? error.message : error);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}
