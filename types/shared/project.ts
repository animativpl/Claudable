/**
 * Shared Project Types
 * Used by both client and server
 */

/**
 * Unified Project Status
 * Consolidates frontend and backend status types
 */
export type ProjectStatus =
  | 'idle'
  | 'running'
  | 'stopped'
  | 'error'
  | 'preview_running'
  | 'building'
  | 'initializing'
  | 'active'
  | 'failed';

export type { TemplateId as TemplateType } from '@/lib/templates/meta';

/**
 * Service Connection Status
 */
export interface ServiceConnection {
  connected: boolean;
  status: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Base Project Interface
 * Contains fields common to both client and server representations
 */
export interface BaseProject {
  id: string;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  previewUrl?: string | null;
  previewPort?: number | null;
  initialPrompt?: string | null;
  selectedModel?: string | null;
}

/**
 * Project Settings
 */
export interface ProjectSettings {
  selectedModel?: string | null;
  theme?: 'light' | 'dark' | 'system';
  autoSave?: boolean;
}
