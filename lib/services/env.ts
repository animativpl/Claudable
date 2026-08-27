import fs from 'fs/promises';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { encrypt, decrypt } from '@/lib/crypto';
import type { EnvVar } from '@prisma/client';
import type { Project } from '@/types/backend';
import { getProjectById } from '@/lib/services/project';
import { resolveProjectRoot } from '@/lib/utils/project-path';

export interface EnvVarRecord {
  id: string;
  key: string;
  value: string;
  scope: string;
  var_type: string;
  is_secret: boolean;
  description?: string | null;
}

interface CreateEnvVarInput {
  key: string;
  value: string;
  scope?: string;
  varType?: string;
  isSecret?: boolean;
  description?: string | null;
}

function envFilePath(project: Project): string {
  const repoRoot = resolveProjectRoot(project.id, project.repoPath);
  return path.join(repoRoot, '.env');
}

async function ensureProject(projectId: string): Promise<Project> {
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  return project;
}

function mapEnvVar(model: EnvVar): EnvVarRecord {
  return {
    id: model.id,
    key: model.key,
    value: decrypt(model.valueEncrypted),
    scope: model.scope,
    var_type: model.varType,
    is_secret: model.isSecret,
    description: model.description,
  };
}

export async function listEnvVars(projectId: string): Promise<EnvVarRecord[]> {
  const records = await prisma.envVar.findMany({
    where: { projectId },
    orderBy: { key: 'asc' },
  });
  const result: EnvVarRecord[] = [];
  for (const record of records) {
    try {
      result.push(mapEnvVar(record));
    } catch (error) {
      console.warn(`[EnvService] Failed to decrypt env var ${record.key}:`, error);
    }
  }
  return result;
}

export async function createEnvVar(
  projectId: string,
  input: CreateEnvVarInput,
): Promise<EnvVarRecord> {
  await ensureProject(projectId);
  try {
    const created = await prisma.envVar.create({
      data: {
        projectId,
        key: input.key,
        valueEncrypted: encrypt(input.value),
        scope: input.scope ?? 'runtime',
        varType: input.varType ?? 'string',
        isSecret: input.isSecret ?? true,
        description: input.description,
      },
    });

    await syncDbToEnvFile(projectId);
    return mapEnvVar(created);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error(`Environment variable "${input.key}" already exists`);
    }
    throw error;
  }
}

export async function updateEnvVar(
  projectId: string,
  key: string,
  value: string,
): Promise<boolean> {
  await ensureProject(projectId);
  try {
    await prisma.envVar.update({
      where: {
        projectId_key: {
          projectId,
          key,
        },
      },
      data: {
        valueEncrypted: encrypt(value),
      },
    });

    await syncDbToEnvFile(projectId);
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return false;
    }
    throw error;
  }
}

export async function deleteEnvVar(projectId: string, key: string): Promise<boolean> {
  await ensureProject(projectId);
  try {
    await prisma.envVar.delete({
      where: {
        projectId_key: {
          projectId,
          key,
        },
      },
    });

    await syncDbToEnvFile(projectId);
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return false;
    }
    throw error;
  }
}

export async function syncDbToEnvFile(projectId: string): Promise<number> {
  const project = await ensureProject(projectId);
  const repoEnvPath = envFilePath(project);

  const envVars = await prisma.envVar.findMany({
    where: { projectId },
    orderBy: { key: 'asc' },
  });

  const entries = envVars.reduce<{ key: string; value: string }[]>((acc, envVar) => {
    try {
      acc.push({ key: envVar.key, value: decrypt(envVar.valueEncrypted) });
    } catch (error) {
      console.warn(`[EnvService] Failed to decrypt env var ${envVar.key}:`, error);
    }
    return acc;
  }, []);

  const header =
    '# Environment Variables\n# This file is automatically synchronized with Project Settings\n\n';

  const contents =
    header +
    entries
      .map(({ key, value }) => {
        if (value === undefined || value === null) {
          return `${key}=`;
        }
        if (/[ \t#"$']/u.test(value)) {
          return `${key}="${value.replace(/"/g, '\\"')}"`;
        }
        return `${key}=${value}`;
      })
      .join('\n') +
    (entries.length > 0 ? '\n' : '');

  await fs.mkdir(path.dirname(repoEnvPath), { recursive: true });
  await fs.writeFile(repoEnvPath, contents, 'utf8');

  return entries.length;
}
