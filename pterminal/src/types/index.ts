// DTOs returned by Tauri commands. Field names mirror the Rust structs which
// serialize with #[serde(rename_all = "camelCase")].

export interface Terminal {
  id: string;
  name: string;
  cwd: string;
  shell?: string;
  env?: string; // JSON-serialized environment map
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  sortOrder: number;
  isPinned: boolean;
  pinOrder: number;
  /** Per-terminal font size override. Undefined = use the global default. */
  fontSize?: number;
}

export interface Command {
  id: string;
  terminalId?: string;
  label: string;
  command: string;
  isPinned: boolean;
  pinOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface SshShortcut {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  identityFile?: string;
  /** Optional password (stored in plaintext — internal/test hosts only). */
  password?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AIMessage {
  id: string;
  terminalId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  messageType?: 'chat' | 'command_suggest' | 'output_explain' | 'error_diagnose';
  metadata?: string; // JSON
  createdAt: number;
}

export interface AISettings {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  terminalContextLines?: number;
  contextWindow?: number;
  compressionThreshold?: number;
}

/** AI configuration as returned by the `ai_config` command. */
export interface AIConfig {
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  terminalContextLines: number;
  contextWindow: number;
  compressionThreshold: number;
}

export interface SpawnTerminalInput {
  /** Restore an existing terminal by id (re-attach a live PTY after restart). */
  id?: string;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  name?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

// Event payloads emitted from Rust.
export interface TerminalDataPayload {
  id: string;
  data: string;
}

export interface TerminalExitPayload {
  id: string;
  exitCode?: number;
}

/** Streaming event payload emitted by AI commands. */
export interface AIStreamPayload {
  requestId: string;
  terminalId: string;
  kind: string; // chat | command_suggest | output_explain | error_diagnose
  delta?: string;
  error?: string;
  done: boolean;
}
