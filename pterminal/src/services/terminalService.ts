import { invoke } from '@tauri-apps/api/core';
import type {
  LocalCompletion,
  SpawnTerminalInput,
  Terminal,
  TerminalSize,
} from '@/types';

export const terminalService = {
  /** Spawn a new PTY-backed terminal session and persist its config. */
  spawn(input: SpawnTerminalInput = {}): Promise<Terminal> {
    return invoke<Terminal>('terminal_spawn', { input });
  },

  /** Write keyboard input (or a full command) to a terminal's PTY. */
  write(id: string, data: string): Promise<void> {
    return invoke<void>('terminal_write', { id, data });
  },

  /** Resize the PTY to match the xterm.js viewport. */
  resize(id: string, size: TerminalSize): Promise<void> {
    return invoke<void>('terminal_resize', {
      id,
      cols: size.cols,
      rows: size.rows,
    });
  },

  /** Kill a live session (does not delete the persisted config). */
  kill(id: string): Promise<void> {
    return invoke<void>('terminal_kill', { id });
  },

  /** Whether a live PTY session exists for the given terminal id. */
  hasSession(id: string): Promise<boolean> {
    return invoke<boolean>('terminal_has_session', { id });
  },

  /** List all persisted terminal configurations. */
  list(): Promise<Terminal[]> {
    return invoke<Terminal[]>('terminal_list');
  },

  /** Update a terminal's name and/or cwd. */
  update(
    id: string,
    updates: { name?: string; cwd?: string }
  ): Promise<Terminal> {
    return invoke<Terminal>('terminal_update', {
      id,
      name: updates.name ?? null,
      cwd: updates.cwd ?? null,
    });
  },

  /** Delete a terminal config (and kill any live session). */
  remove(id: string): Promise<void> {
    return invoke<void>('terminal_delete', { id });
  },

  /** Toggle a terminal's pinned state (promotes it to the top of the list). */
  pin(input: { id: string; isPinned: boolean }): Promise<Terminal> {
    return invoke<Terminal>('terminal_pin', { input });
  },

  /** Set (or clear with null) a terminal's per-terminal font size override. */
  setFontSize(input: { id: string; fontSize: number | null }): Promise<Terminal> {
    return invoke<Terminal>('terminal_set_font_size', { input });
  },

  /** Fast non-AI autocomplete from PATH, builtins, subcommands, and files. */
  localCompletions(input: {
    terminalId: string;
    partialCmd: string;
    limit?: number;
  }): Promise<LocalCompletion[]> {
    return invoke<LocalCompletion[]>('terminal_local_completions', { input });
  },
};
