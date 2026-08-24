import fs from 'fs/promises';
import path from 'path';
import { getDefaultModelForCli, normalizeModelId } from '@/lib/constants/cliModels';

const DATA_DIR = process.env.SETTINGS_DIR || path.join(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'global-settings.json');

export type CLISettings = Record<string, Record<string, unknown>>;

export interface GlobalSettings {
  cli_settings: CLISettings;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  cli_settings: {
    claude: {
      model: getDefaultModelForCli('claude'),
    },
  },
};

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readSettingsFile(): Promise<GlobalSettings | null> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<GlobalSettings>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    // Legacy files may still carry a `default_cli` key; it is ignored on read.
    const cliSettings =
      typeof parsed.cli_settings === 'object' && parsed.cli_settings !== null
        ? parsed.cli_settings
        : {};

    return {
      cli_settings: {
        ...DEFAULT_SETTINGS.cli_settings,
        ...cliSettings,
      },
    };
  } catch (error) {
    return null;
  }
}

async function writeSettings(settings: GlobalSettings): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  const existing = await readSettingsFile();
  if (existing) {
    const merged: GlobalSettings = {
      cli_settings: {
        ...DEFAULT_SETTINGS.cli_settings,
        ...(existing.cli_settings ?? {}),
      },
    };
    return merged;
  }

  await writeSettings(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export function normalizeCliSettings(settings: unknown): CLISettings | undefined {
  if (!settings || typeof settings !== 'object') {
    return undefined;
  }

  const normalized: CLISettings = {};
  for (const [cli, config] of Object.entries(settings)) {
    if (config && typeof config === 'object') {
      normalized[cli] = {
        ...(config as Record<string, unknown>),
      };
      const model = normalized[cli].model as string | undefined;
      if (model) {
        normalized[cli].model = normalizeModelId(cli, model);
      }
    }
  }
  return normalized;
}

export async function updateGlobalSettings(partial: Partial<GlobalSettings>): Promise<GlobalSettings> {
  const current = await loadGlobalSettings();

  const cliSettings = normalizeCliSettings(partial.cli_settings);

  const next: GlobalSettings = {
    cli_settings: { ...current.cli_settings },
  };

  if (cliSettings) {
    for (const [cli, config] of Object.entries(cliSettings)) {
      next.cli_settings[cli] = {
        ...(current.cli_settings[cli] ?? {}),
        ...config,
      };
    }
  }

  await writeSettings(next);
  return next;
}
