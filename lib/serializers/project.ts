import type { Project as ProjectEntity } from '@/types/backend';
import type { Project } from '@/types';

export function serializeProject(project: ProjectEntity): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,
    status: project.status,
    previewUrl: project.previewUrl ?? null,
    previewPort: project.previewPort ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    lastActiveAt: project.lastActiveAt ? project.lastActiveAt.toISOString() : null,
    initialPrompt: project.initialPrompt ?? null,
    selectedModel: project.selectedModel ?? null,
  };
}

export function serializeProjects(projects: ProjectEntity[]): Project[] {
  return projects.map((project) => serializeProject(project));
}
