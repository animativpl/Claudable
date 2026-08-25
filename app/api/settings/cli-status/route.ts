/**
 * Agent Status API Route
 * GET /api/settings/cli-status - Czy agent ma czym się uwierzytelnić
 */

import { NextResponse } from 'next/server';
import { describeCredentialStatus } from '@/lib/services/cli/credential-status';
import { CLAUDE_MODEL_DEFINITIONS } from '@/lib/constants/claudeModels';

export async function GET() {
  const credentials = await describeCredentialStatus();

  return NextResponse.json({
    claude: {
      installed: credentials.hasCredentials,
      available: credentials.hasCredentials,
      configured: credentials.hasCredentials,
      checking: false,
      source: credentials.source,
      configDir: credentials.configDir,
      models: CLAUDE_MODEL_DEFINITIONS.map((definition) => definition.id),
      ...(credentials.hasCredentials
        ? {}
        : { error: `No Claude credentials in ${credentials.configDir} and no ANTHROPIC_API_KEY` }),
    },
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
