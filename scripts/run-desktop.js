#!/usr/bin/env node

/**
 * Electron + Next.js development launcher.
 * - Launches the Next.js dev server and then attaches the Electron process.
 */

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const { parseCliArgs, startWebDevServer } = require('./run-web');
const { waitForUrl } = require('../electron/wait-for-url');

const rootDir = path.join(__dirname, '..');
const isWindows = os.platform() === 'win32';

async function start() {
  const argv = process.argv.slice(2);
  const { preferredPort, passthrough } = parseCliArgs(argv);

  const { child: nextProcess, port, url } = await startWebDevServer({
    preferredPort,
    passthrough,
    stdio: 'inherit',
  });

  const electronBinary = path.join(
    rootDir,
    'node_modules',
    '.bin',
    isWindows ? 'electron.cmd' : 'electron'
  );

  await waitForUrl(url).catch((error) => {
    console.warn('⚠️  Warning while checking Next.js dev server readiness:', error.message);
  });

  const electronEnv = {
    ...process.env,
    NODE_ENV: 'development',
    ELECTRON_START_URL: url,
    NEXT_PUBLIC_APP_URL: url,
    WEB_PORT: String(port),
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: '1',
  };

  console.log('🪟 Launching Electron renderer…');

  const electronArgs = [path.join(rootDir, 'electron', 'main.js'), ...passthrough];
  const electronProcess = spawn(electronBinary, electronArgs, {
    cwd: rootDir,
    env: electronEnv,
    stdio: 'inherit',
    shell: isWindows,
  });

  const shutdown = (exitCode = 0) => {
    if (!nextProcess.killed) {
      nextProcess.kill('SIGTERM');
    }
    if (!electronProcess.killed) {
      electronProcess.kill('SIGTERM');
    }
    process.exit(exitCode);
  };

  electronProcess.on('exit', (code) => {
    if (typeof code === 'number' && code !== 0) {
      console.error(`❌ Electron process exited with code ${code}.`);
    }
    shutdown(code ?? 0);
  });

  electronProcess.on('error', (error) => {
    console.error('❌ An error occurred while running Electron.');
    console.error(error instanceof Error ? error.message : error);
    shutdown(1);
  });

  nextProcess.on('exit', (code) => {
    if (typeof code === 'number' && code !== 0) {
      console.error(`❌ Next.js dev server exited with code ${code}.`);
    }
    if (!electronProcess.killed) {
      electronProcess.kill('SIGTERM');
    }
  });

  const handleSignal = (signal) => {
    console.log(`\n🛑 Received signal: ${signal}. Shutting down processes.`);
    shutdown(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

start().catch((error) => {
  console.error('\n❌ Failed to start the desktop development environment.');
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
