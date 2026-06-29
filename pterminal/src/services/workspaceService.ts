import { invoke } from '@tauri-apps/api/core';
import type { Workspace, WorkspacePathStatus } from '@/types';

/**
 * Backing service for the WORKSPACES section of the left sidebar. A workspace
 * is just a folder pinned to the sidebar; terminals created under it are normal
 * `Terminal` rows carrying its `workspaceId`. Closing a workspace cascades its
 * terminals (see `workspace_delete` on the Rust side).
 */
export const workspaceService = {
  /** Open (or re-open) a folder as a workspace. Idempotent on path. */
  create(path: string): Promise<Workspace> {
    return invoke<Workspace>('workspace_create', { input: { path } });
  },

  /** List all open workspaces in sidebar order. */
  list(): Promise<Workspace[]> {
    return invoke<Workspace[]>('workspace_list');
  },

  /** Remove a workspace AND cascade-delete every terminal grouped under it. */
  remove(id: string): Promise<void> {
    return invoke<void>('workspace_delete', { id });
  },

  /** Batch existence check for the folders backing each workspace. Polled by the
   *  sidebar to grey-out workspaces whose folder was deleted on disk. */
  checkPaths(ids: string[]): Promise<WorkspacePathStatus[]> {
    return invoke<WorkspacePathStatus[]>('workspace_check_paths', { ids });
  },
};
