import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('loadGlobalSettings', () => {
  const originalSettingsDir = process.env.SETTINGS_DIR;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    if (originalSettingsDir === undefined) {
      delete process.env.SETTINGS_DIR;
    } else {
      process.env.SETTINGS_DIR = originalSettingsDir;
    }
  });

  it('ignores a stray default_cli key left over from before it was removed', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'global-settings-'));
    process.env.SETTINGS_DIR = tempDir;
    await fs.writeFile(
      path.join(tempDir, 'global-settings.json'),
      JSON.stringify({
        default_cli: 'claude',
        cli_settings: { claude: { model: 'claude-sonnet-5' } },
      }),
      'utf8'
    );

    vi.resetModules();
    const { loadGlobalSettings } = await import('@/lib/services/settings');
    const settings = await loadGlobalSettings();

    expect(settings).not.toHaveProperty('default_cli');
    expect(settings.cli_settings.claude?.model).toBe('claude-sonnet-5');
  });
});
