/**
 * StreamManager - Server-Sent Events (SSE) Connection Management
 * Manages SSE connections per project and sends real-time messages.
 */

import type { RealtimeEvent } from '@/types';

/**
 * SSE Stream Manager
 * Supports multiple client connections per project.
 */
export class StreamManager {
  private streams: Map<string, Set<ReadableStreamDefaultController>>;
  private static instance: StreamManager;

  private constructor() {
    this.streams = new Map();
  }

  /**
   * Return Singleton instance
   */
  public static getInstance(): StreamManager {
    if (!StreamManager.instance) {
      StreamManager.instance = new StreamManager();
    }
    return StreamManager.instance;
  }

  /**
   * Add SSE connection to project
   */
  public addStream(projectId: string, controller: ReadableStreamDefaultController): void {
    if (!this.streams.has(projectId)) {
      this.streams.set(projectId, new Set());
    }
    this.streams.get(projectId)!.add(controller);
  }

  /**
   * Remove SSE connection from project
   */
  public removeStream(projectId: string, controller: ReadableStreamDefaultController): void {
    const projectStreams = this.streams.get(projectId);
    if (projectStreams) {
      projectStreams.delete(controller);

      if (projectStreams.size === 0) {
        this.streams.delete(projectId);
      }
    }
  }

  /**
   * Send event to all clients of a project
   */
  public publish(projectId: string, event: RealtimeEvent): void {
    const projectStreams = this.streams.get(projectId);
    if (!projectStreams || projectStreams.size === 0) {
      return;
    }
    const message = `data: ${JSON.stringify(event)}\n\n`;
    const encoder = new TextEncoder();
    const encodedMessage = encoder.encode(message);

    const deadControllers: ReadableStreamDefaultController[] = [];

    projectStreams.forEach((controller) => {
      try {
        controller.enqueue(encodedMessage);
      } catch (error) {
        console.error(`[StreamManager] Failed to send message:`, error);
        // Mark for removal after iteration
        deadControllers.push(controller);
      }
    });

    // Remove dead connections after iteration
    deadControllers.forEach((controller) => {
      this.removeStream(projectId, controller);
    });
  }
}

// Export Singleton instance (stable across HMR and route module reloads)
const g = globalThis as unknown as { __claudable_stream_mgr__?: StreamManager };
export const streamManager: StreamManager =
  g.__claudable_stream_mgr__ ?? (g.__claudable_stream_mgr__ = StreamManager.getInstance());
