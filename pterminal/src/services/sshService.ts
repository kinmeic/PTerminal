import { invoke } from '@tauri-apps/api/core';
import type { SshShortcut } from '@/types';

export interface CreateSshShortcutInput {
  name: string;
  host: string;
  port?: number;
  user: string;
  identityFile?: string;
  password?: string;
}

export interface UpdateSshShortcutInput {
  id: string;
  name?: string;
  host?: string;
  port?: number;
  user?: string;
  identityFile?: string;
  /** Empty string clears; some value sets; omit (undefined) leaves as is. */
  password?: string;
}

export const sshService = {
  create(input: CreateSshShortcutInput): Promise<SshShortcut> {
    return invoke<SshShortcut>('ssh_create', { input });
  },
  update(input: UpdateSshShortcutInput): Promise<SshShortcut> {
    return invoke<SshShortcut>('ssh_update', { input });
  },
  remove(id: string): Promise<void> {
    return invoke<void>('ssh_delete', { id });
  },
  list(): Promise<SshShortcut[]> {
    return invoke<SshShortcut[]>('ssh_list');
  },
};
