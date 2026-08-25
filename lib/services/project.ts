/**
 * Project Service - Project management logic
 */

import { prisma } from '@/lib/db/client';
import type { Project, CreateProjectInput, UpdateProjectInput } from '@/types/backend';
import fs from 'fs/promises';
import { normalizeModelId, getDefaultModelForCli } from '@/lib/constants/cliModels';
import { resolveProjectRoot } from '@/lib/utils/project-path';
import { normalizeTemplateType } from '@/lib/templates/meta';

/**
 * Retrieve all projects
 */
export async function getAllProjects(): Promise<Project[]> {
  const projects = await prisma.project.findMany({
    orderBy: {
      lastActiveAt: 'desc',
    },
  });
  return projects.map(project => ({
    ...project,
    selectedModel: normalizeModelId(null, project.selectedModel ?? undefined),
  })) as Project[];
}

/**
 * Retrieve project by ID
 */
export async function getProjectById(id: string): Promise<Project | null> {
  const project = await prisma.project.findUnique({
    where: { id },
  });
  if (!project) return null;
  return {
    ...project,
    selectedModel: normalizeModelId(null, project.selectedModel ?? undefined),
  } as Project;
}

/**
 * Create new project
 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  // Create project directory
  const projectPath = resolveProjectRoot(input.project_id);
  await fs.mkdir(projectPath, { recursive: true });

  // Create project in database
  const project = await prisma.project.create({
    data: {
      id: input.project_id,
      name: input.name,
      description: input.description,
      initialPrompt: input.initialPrompt,
      repoPath: projectPath,
      selectedModel: normalizeModelId(null, input.selectedModel ?? getDefaultModelForCli(null)),
      status: 'idle',
      templateType: normalizeTemplateType(input.templateType),
      lastActiveAt: new Date(),
      previewUrl: null,
      previewPort: null,
    },
  });

  console.log(`[ProjectService] Created project: ${project.id}`);
  return {
    ...project,
    selectedModel: normalizeModelId(null, project.selectedModel ?? undefined),
  } as Project;
}

/**
 * Update project
 */
export async function updateProject(
  id: string,
  input: UpdateProjectInput
): Promise<Project> {
  const normalizedModel = input.selectedModel
    ? normalizeModelId(null, input.selectedModel)
    : undefined;

  const project = await prisma.project.update({
    where: { id },
    data: {
      ...input,
      ...(input.selectedModel
        ? { selectedModel: normalizedModel }
        : {}),
      updatedAt: new Date(),
    },
  });

  console.log(`[ProjectService] Updated project: ${id}`);
  return {
    ...project,
    selectedModel: normalizeModelId(null, project.selectedModel ?? undefined),
  } as Project;
}

/**
 * Delete project
 */
export async function deleteProject(id: string): Promise<void> {
  // Delete project directory
  const project = await getProjectById(id);
  if (project?.repoPath) {
    try {
      await fs.rm(project.repoPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[ProjectService] Failed to delete project directory:`, error);
    }
  }

  // Delete project from database (related data automatically deleted via Cascade)
  await prisma.project.delete({
    where: { id },
  });

  console.log(`[ProjectService] Deleted project: ${id}`);
}

/**
 * Update project activity time
 */
export async function updateProjectActivity(id: string): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: {
      lastActiveAt: new Date(),
    },
  });
}

/**
 * Update project status
 */
export async function updateProjectStatus(
  id: string,
  status: 'idle' | 'running' | 'stopped' | 'error'
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: {
      status,
      updatedAt: new Date(),
    },
  });
  console.log(`[ProjectService] Updated project status: ${id} -> ${status}`);
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `repoPath` trzyma absolutną ścieżkę hosta, zapisaną raz przy tworzeniu
 * projektu. Zmiana montowania — na przykład przeniesienie instalacji do
 * kontenera, gdzie `PROJECTS_DIR=/data/projects` — unieważnia ją po cichu:
 * lista projektów renderuje się z bazy, więc aplikacja wygląda zdrowo, a
 * agent (`repoPath` jest jego katalogiem roboczym), preview i usuwanie
 * projektu pracują na katalogu, którego nie ma. Ostatnie jest najgroźniejsze:
 * `deleteProject` woła `fs.rm(repoPath, { recursive: true, force: true })`.
 *
 * Rozstrzygamy dowodem, nie założeniem: przepisujemy wyłącznie wtedy, gdy
 * stara ścieżka zniknęła, a katalog o tym id leży w `PROJECTS_DIR`. Odwrotnie
 * nie ruszamy — gdy pliki NIE przeniosły się razem z katalogiem, `repoPath`
 * jest jedyną poprawną wskazówką i nadpisanie skasowałoby ją.
 *
 * Ta sama figura co `reconcileStalePreviews`: stan w bazie kłamie po zmianie
 * otoczenia, więc weryfikujemy go przy starcie.
 */
export async function reconcileProjectPaths(): Promise<number> {
  try {
    const projects = await prisma.project.findMany({
      select: { id: true, repoPath: true },
    });

    let rewritten = 0;
    for (const project of projects) {
      if (!project.repoPath) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await directoryExists(project.repoPath)) continue;

      const candidate = resolveProjectRoot(project.id);
      // eslint-disable-next-line no-await-in-loop
      if (!(await directoryExists(candidate))) continue;

      // eslint-disable-next-line no-await-in-loop
      await prisma.project.update({
        where: { id: project.id },
        data: { repoPath: candidate },
      });
      console.log(
        `[ProjectService] Repointed project ${project.id}: ${project.repoPath} -> ${candidate}`
      );
      rewritten += 1;
    }

    return rewritten;
  } catch (error) {
    console.error('[ProjectService] Failed to reconcile project paths:', error);
    return 0;
  }
}
