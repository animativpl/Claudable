/**
 * Service Integration Helper
 * Common utilities for integrating external services (GitHub)
 * This module breaks circular dependencies between service modules
 */

import { getProjectById } from '@/lib/services/project';
import { getProjectService } from '@/lib/services/project-services';

/**
 * Get GitHub repository information from project services
 */
export async function getProjectGitHubRepo(projectId: string): Promise<{
  owner: string;
  repoName: string;
  fullName: string;
} | null> {
  const githubService = await getProjectService(projectId, 'github');
  const githubData = githubService?.serviceData as Record<string, unknown> | undefined;

  if (githubData && typeof githubData.owner === 'string' && typeof githubData.repo_name === 'string') {
    return {
      owner: githubData.owner,
      repoName: githubData.repo_name,
      fullName: `${githubData.owner}/${githubData.repo_name}`,
    };
  }

  return null;
}

/**
 * Validate project exists
 */
export async function validateProjectExists(projectId: string): Promise<void> {
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error('Project not found');
  }
}
