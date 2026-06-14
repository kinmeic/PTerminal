import { invoke } from '@tauri-apps/api/core';
import type { Command } from '@/types';

export interface CreateCommandInput {
  terminalId?: string;
  label: string;
  command: string;
}

export interface UpdateCommandInput {
  id: string;
  label?: string;
  command?: string;
  terminalId?: string;
}

export interface PinCommandInput {
  id: string;
  isPinned: boolean;
  pinOrder?: number;
}

export const commandService = {
  create(input: CreateCommandInput): Promise<Command> {
    return invoke<Command>('command_create', { input });
  },
  update(input: UpdateCommandInput): Promise<Command> {
    return invoke<Command>('command_update', { input });
  },
  remove(id: string): Promise<void> {
    return invoke<void>('command_delete', { id });
  },
  pin(input: PinCommandInput): Promise<Command> {
    return invoke<Command>('command_pin', { input });
  },
  list(terminalId: string): Promise<Command[]> {
    return invoke<Command[]>('command_list', { terminalId });
  },
};
