#!/usr/bin/env node

/**
 * Development environment bootstrapper.
 * - Ensures .env exists
 * - Finds an available localhost port for the Next.js dev server
 * - Syncs NEXT_PUBLIC_APP_URL, PORT, WEB_PORT and the preview port range in .env
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const rootDir = path.join(__dirname, '..');
const envFile = path.join(rootDir, '.env');
const envLocalFile = path.join(rootDir, '.env.local');
const rootDataDir = path.join(rootDir, 'data');
const projectsDir = path.join(rootDataDir, 'projects');
// HOME kontenera (obraz ustawia HOME=/data/home). Brakujące katalogi
// bind-mountu tworzy demon Dockera jako root i takie zostają na hoście, więc
// muszą powstać wcześniej i pod użytkownikiem.
const homeDataDir = path.join(rootDataDir, 'home');
const prismaDataDir = path.join(rootDir, 'prisma', 'data');
const sqlitePath = path.join(rootDataDir, 'cc.db');

const MAX_PORT = 65_535;
// Preview servers (per-project) dynamic pool
const FALLBACK_PORT_START = 3_100;
const FALLBACK_PORT_END = 3_131;
const DEFAULT_RANGE_SPAN = FALLBACK_PORT_END - FALLBACK_PORT_START;
// Claudable (root web app) default port and small scan span to avoid preview pool
const DEFAULT_WEB_PORT = 3_000;
const DEFAULT_WEB_SCAN_SPAN = 99; // scan up to 3099 at most
const DEFAULT_WEB_MAX = DEFAULT_WEB_PORT + DEFAULT_WEB_SCAN_SPAN;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function writeFileSafe(filePath, contents) {
  if (!contents.endsWith('\n')) {
    contents += '\n';
  }
  fs.writeFileSync(filePath, contents, 'utf8');
}

function upsertEnvValue(contents, key, value) {
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
  if (pattern.test(contents)) {
    return contents.replace(pattern, `${key}=${value}`);
  }

  if (contents.length && !contents.endsWith('\n')) {
    contents += '\n';
  }

  return contents + `${key}=${value}\n`;
}

function hasEnvKey(contents, key) {
  if (!contents) return false;
  const pattern = new RegExp(`^${escapeRegExp(key)}=`, 'm');
  return pattern.test(contents);
}

// Klucze, które ten skrypt pisał kiedyś do `.env.local`. Dziś liczy je do
// `.env`, ale zastana instalacja wciąż trzyma zamrożoną kopię — a `.env.local`
// bije `.env` u własnego loadera Nexta (`next build`, `next start`) i w
// `scripts/migrate-drop-legacy.js` (`override: true`). Bez tego sprzątania
// stare `PREVIEW_PORT_END=3999` wygrywa z zakresem policzonym niżej.
const LEGACY_ENV_LOCAL_KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'PORT',
  'WEB_PORT',
  'PREVIEW_PORT_START',
  'PREVIEW_PORT_END',
];

const ENV_KEY_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)=/;

function pruneLegacyEnvLocal() {
  const contents = readFileSafe(envLocalFile);
  if (!contents.trim()) return;

  const lines = contents.split('\n');
  const kept = lines.filter((line) => {
    const match = line.match(ENV_KEY_LINE);
    return !(match && LEGACY_ENV_LOCAL_KEYS.includes(match[1]));
  });
  if (kept.length === lines.length) return;

  const relative = path.relative(rootDir, envLocalFile);
  if (kept.some((line) => ENV_KEY_LINE.test(line))) {
    writeFileSafe(envLocalFile, kept.join('\n'));
    console.log(`\u{1F9F9} Dropped stale keys from ${relative}; .env is the source now.`);
  } else {
    fs.unlinkSync(envLocalFile);
    console.log(`\u{1F9F9} Removed stale ${relative}; .env is the source now.`);
  }
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '');
  }
}

function extractPort(contents, keys) {
  for (const key of keys) {
    const pattern = new RegExp(
      `^${escapeRegExp(key)}=["']?([0-9]{2,5})["']?$`,
      'm'
    );
    const match = contents.match(pattern);
    if (match) {
      const port = Number.parseInt(match[1], 10);
      if (!Number.isNaN(port) && port > 0 && port <= MAX_PORT) {
        return port;
      }
    }
  }
  return null;
}

function parsePortValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric) || numeric <= 0 || numeric > MAX_PORT) {
    return null;
  }
  return numeric;
}

function checkPort(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const cleanup = (available) => {
      socket.removeAllListeners();
      try {
        socket.end();
        socket.destroy();
      } catch (_) {
        // no-op
      }
      resolve(available);
    };

    socket.once('connect', () => cleanup(false));
    socket.once('error', () => cleanup(true));
    socket.setTimeout(500, () => cleanup(true));
  });
}

async function isPortAvailable(port) {
  const results = await Promise.allSettled([
    checkPort('127.0.0.1', port),
    checkPort('::1', port),
  ]);

  // Treat IPv6 errors (e.g., not supported) as available
  return results.every((result) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return true;
  });
}

async function findAvailablePort(rangeStart, rangeEnd, preferredPort) {
  if (rangeStart > rangeEnd) {
    throw new Error(
      `Invalid port range: start ${rangeStart} is greater than end ${rangeEnd}.`
    );
  }

  const normalizedPreferred = Math.min(
    Math.max(preferredPort ?? rangeStart, rangeStart),
    rangeEnd
  );

  for (let port = normalizedPreferred; port <= rangeEnd; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }

  for (let port = rangeStart; port < normalizedPreferred; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }

  throw new Error(
    `Could not find an available port between ${rangeStart} and ${rangeEnd}.`
  );
}

async function ensureEnvironment(options = {}) {
  console.log('🔧 Setting up development environment...');

  const { preferredPort: preferredOverride } = options ?? {};

  let envContents = readFileSafe(envFile);

  // Ensure required directories/files exist
  ensureDirectory(rootDataDir);
  ensureDirectory(projectsDir);
  ensureDirectory(homeDataDir);
  ensureDirectory(prismaDataDir);
  ensureFile(sqlitePath);

  const envDefaults = {};
  if (!hasEnvKey(envContents, 'DATABASE_URL')) {
    envDefaults.DATABASE_URL = '"file:../data/cc.db"';
  }
  if (!hasEnvKey(envContents, 'PROJECTS_DIR')) {
    envDefaults.PROJECTS_DIR = '"./data/projects"';
  }
  if (!hasEnvKey(envContents, 'ENCRYPTION_KEY')) {
    envDefaults.ENCRYPTION_KEY = `"${crypto.randomBytes(32).toString('hex')}"`;
  }

  const portStartCandidates = [
    parsePortValue(process.env.PREVIEW_PORT_START),
    extractPort(envContents, ['PREVIEW_PORT_START']),
  ];

  let portRangeStart =
    portStartCandidates.find((value) => value !== null) ?? FALLBACK_PORT_START;

  const portEndCandidates = [
    parsePortValue(process.env.PREVIEW_PORT_END),
    extractPort(envContents, ['PREVIEW_PORT_END']),
  ];

  let portRangeEnd =
    portEndCandidates.find((value) => value !== null) ?? FALLBACK_PORT_END;

  if (portRangeEnd < portRangeStart) {
    portRangeEnd = Math.min(
      MAX_PORT,
      portRangeStart + DEFAULT_RANGE_SPAN
    );
  }

  const overridePreferred =
    preferredOverride !== undefined && preferredOverride !== null
      ? parsePortValue(String(preferredOverride))
      : null;

  const sanitizeWebCandidate = (val) => {
    if (val === null || val === undefined) return null;
    if (val >= portRangeStart && val <= portRangeEnd) return null;
    if (val < DEFAULT_WEB_PORT || val > DEFAULT_WEB_MAX) {
      return DEFAULT_WEB_PORT;
    }
    return val;
  };

  const preferredPortCandidates = [
    sanitizeWebCandidate(overridePreferred),
    sanitizeWebCandidate(parsePortValue(process.env.WEB_PORT)),
    sanitizeWebCandidate(parsePortValue(process.env.PORT)),
    sanitizeWebCandidate(extractPort(envContents, ['PORT', 'WEB_PORT'])),
  ];

  let preferredPort =
    preferredPortCandidates.find((value) => value !== null) ?? DEFAULT_WEB_PORT;

  // Compute scan window for WEB app: stay below preview range when possible
  let webRangeStart = preferredPort;
  let webRangeEnd = Math.min(
    preferredPort + DEFAULT_WEB_SCAN_SPAN,
    portRangeStart > preferredPort ? portRangeStart - 1 : preferredPort + DEFAULT_WEB_SCAN_SPAN
  );
  if (webRangeEnd < webRangeStart) {
    webRangeEnd = webRangeStart;
  }

  const port = await findAvailablePort(webRangeStart, webRangeEnd, preferredPort);
  const url = `http://localhost:${port}`;

  if (port !== preferredPort) {
    console.log(
      `⚠️  Port ${preferredPort} is busy. Switching to available port ${port} within ${webRangeStart}-${webRangeEnd}.`
    );
  } else {
    console.log(
      `✅ Using port ${port} (range ${webRangeStart}-${webRangeEnd}).`
    );
  }

  const envUpdates = {
    PORT: String(port),
    WEB_PORT: String(port),
    NEXT_PUBLIC_APP_URL: `"${url}"`,
    PREVIEW_PORT_START: String(portRangeStart),
    PREVIEW_PORT_END: String(portRangeEnd),
  };

  let updatedEnv = envContents || '# Auto-generated defaults - customize as needed\n';
  for (const [key, value] of Object.entries(envDefaults)) {
    updatedEnv = upsertEnvValue(updatedEnv, key, value);
  }
  for (const [key, value] of Object.entries(envUpdates)) {
    updatedEnv = upsertEnvValue(updatedEnv, key, value);
  }
  writeFileSafe(envFile, updatedEnv);
  console.log(`📝 Updated ${path.relative(rootDir, envFile)}`);

  pruneLegacyEnvLocal();

  // `.env.local` is no longer generated. Every key this script used to write
  // there was computed from `.env` and written to `.env` too, so the copy only
  // looked like an override: `scripts/run-web.js` loads `.env` first without
  // `override`, and dotenv keeps the value it already has. Next.js loads `.env`
  // on its own, so the duplicates bought nothing and hid the real source.
  console.log('✅ Environment ready!');
  return { port, url };
}

if (require.main === module) {
  ensureEnvironment().catch((error) => {
    console.error('❌ Failed to set up environment.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = { ensureEnvironment, FALLBACK_PORT_START, FALLBACK_PORT_END };
