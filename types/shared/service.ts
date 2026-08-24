/**
 * Shared Service Types
 */

export type ServiceProvider = 'github';

export type ServiceStatus = 'connected' | 'disconnected' | 'error';

export interface ServiceConnectionData {
  provider: ServiceProvider;
  status: ServiceStatus;
  connectedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * GitHub Service Data
 */
export interface GitHubServiceData {
  repo_url: string;
  repo_name: string;
  clone_url: string;
  default_branch: string;
  owner: string;
  last_pushed_at?: string;
}
