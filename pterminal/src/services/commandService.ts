import { invoke } from '@tauri-apps/api/core';
import type { Command } from '@/types';
import { validateCommand, validateCommandLabel } from '@/utils/validation';

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
    const cmdResult = validateCommand(input.command);
    if (!cmdResult.valid) throw new Error(cmdResult.error);
    const labelResult = validateCommandLabel(input.label);
    if (!labelResult.valid) throw new Error(labelResult.error);
    return invoke<Command>('command_create', { input });
  },
  update(input: UpdateCommandInput): Promise<Command> {
    if (input.command) {
      const result = validateCommand(input.command);
      if (!result.valid) throw new Error(result.error);
    }
    if (input.label) {
      const result = validateCommandLabel(input.label);
      if (!result.valid) throw new Error(result.error);
    }
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
  /** Global custom completions (terminal_id NULL) — merged into autocomplete. */
  listGlobal(): Promise<Command[]> {
    return invoke<Command[]>('command_list_global');
  },
};
