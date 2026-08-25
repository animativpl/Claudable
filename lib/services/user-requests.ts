import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';

export interface ActiveRequestSummary {
  hasActiveRequests: boolean;
  activeCount: number;
}

export async function getActiveRequests(projectId: string): Promise<ActiveRequestSummary> {
  const count = await prisma.userRequest.count({
    where: {
      projectId,
      status: {
        in: ['pending', 'processing', 'active', 'running'],
      },
    },
  });

  return {
    hasActiveRequests: count > 0,
    activeCount: count,
  };
}

export type UserRequestStatus =
  | 'pending'
  | 'processing'
  | 'active'
  | 'running'
  | 'completed'
  | 'failed';

interface UpsertUserRequestOptions {
  id: string;
  projectId: string;
  instruction: string;
  cliPreference?: string | null;
}

async function handleNotFound(error: unknown, context: string): Promise<void> {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  ) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[UserRequests] ${context}: record not found`);
    }
    return;
  }

  throw error;
}

/**
 * Create or update a user request record.
 * Uses the client-provided requestId as the primary key.
 */
export async function upsertUserRequest({
  id,
  projectId,
  instruction,
  cliPreference,
}: UpsertUserRequestOptions) {
  return prisma.userRequest.upsert({
    where: { id },
    create: {
      id,
      projectId,
      instruction,
      status: 'pending',
      ...(cliPreference !== undefined ? { cliPreference } : {}),
    },
    update: {
      instruction,
      ...(cliPreference !== undefined ? { cliPreference } : {}),
    },
  });
}

async function updateStatus(
  id: string,
  status: UserRequestStatus,
  options: { errorMessage?: string | null; setCompletionTimestamp?: boolean } = {}
) {
  try {
    const data: Prisma.UserRequestUpdateInput = {
      status,
    };

    if (options.setCompletionTimestamp ?? (status === 'completed' || status === 'failed')) {
      data.completedAt = new Date();
    } else if (status === 'pending' || status === 'processing' || status === 'running' || status === 'active') {
      data.completedAt = null;
    }

    if ('errorMessage' in options) {
      data.errorMessage = options.errorMessage ?? null;
    } else if (status !== 'failed') {
      data.errorMessage = null;
    }

    await prisma.userRequest.update({
      where: { id },
      data,
    });
  } catch (error) {
    await handleNotFound(error, `update status to ${status}`);
  }
}

export async function markUserRequestAsRunning(id: string): Promise<void> {
  await updateStatus(id, 'running');
}

export async function markUserRequestAsProcessing(id: string): Promise<void> {
  await updateStatus(id, 'processing');
}

export async function markUserRequestAsCompleted(id: string): Promise<void> {
  await updateStatus(id, 'completed', {
    errorMessage: null,
    setCompletionTimestamp: true,
  });
}

export async function markUserRequestAsFailed(
  id: string,
  errorMessage?: string,
): Promise<void> {
  await updateStatus(id, 'failed', {
    errorMessage: errorMessage ?? 'Request failed',
    setCompletionTimestamp: true,
  });
}

export const RECONCILABLE_STATUSES = ['pending', 'processing', 'active', 'running'];

export interface StaleRequestClient {
  userRequest: {
    updateMany(args: {
      where: { status: { in: string[] } };
      data: { status: string; errorMessage: string; completedAt: Date };
    }): Promise<{ count: number }>;
  };
}

/**
 * Statusy zgłoszeń pisze wyłącznie proces wykonujący agenta. Jeśli padnie
 * w trakcie, wiersz zostaje w `processing` na zawsze i UI pokazuje run,
 * którego nie ma. Przy starcie każdy niedomknięty run jest z definicji
 * martwy — nie ma go kto kontynuować.
 */
export async function reconcileStaleRequests(client: StaleRequestClient = prisma): Promise<number> {
  try {
    const result = await client.userRequest.updateMany({
      where: { status: { in: RECONCILABLE_STATUSES } },
      data: {
        status: 'failed',
        errorMessage: 'Interrupted by a server restart',
        completedAt: new Date(),
      },
    });
    if (result.count > 0) {
      console.log(`[UserRequests] Reconciled ${result.count} request(s) interrupted by a restart`);
    }
    return result.count;
  } catch (error) {
    console.error('[UserRequests] Failed to reconcile stale requests:', error);
    return 0;
  }
}
