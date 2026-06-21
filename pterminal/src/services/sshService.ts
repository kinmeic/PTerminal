import { invoke } from '@tauri-apps/api/core';
import type { SshShortcut } from '@/types';
import { validateSshShortcut } from '@/utils/validation';

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
    const result = validateSshShortcut(input.name, input.host, input.user, input.port ?? 22);
    if (!result.valid) throw new Error(result.error);
    return invoke<SshShortcut>('ssh_create', { input });
  },
  update(input: UpdateSshShortcutInput): Promise<SshShortcut> {
    if (input.name || input.host || input.user || input.port !== undefined) {
      const result = validateSshShortcut(
        input.name ?? 'placeholder',
        input.host ?? 'placeholder',
        input.user ?? 'placeholder',
        input.port ?? 22
      );
      if (!result.valid) throw new Error(result.error);
    }
    return invoke<SshShortcut>('ssh_update', { input });
  },
  remove(id: string): Promise<void> {
    return invoke<void>('ssh_delete', { id });
  },
  list(): Promise<SshShortcut[]> {
    return invoke<SshShortcut[]>('ssh_list');
  },
};
