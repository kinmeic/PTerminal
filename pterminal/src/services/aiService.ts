import { invoke } from '@tauri-apps/api/core';
import type { AIConfig, AIMessage, AISettings } from '@/types';

export interface AiChatInput {
  terminalId: string;
  message: string;
  history?: { role: string; content: string }[];
  /** Snapshot of recent terminal output to include as context. */
  terminalContext?: string;
}

export interface AiSuggestInput {
  terminalId: string;
  prompt: string;
}

export interface AiExplainInput {
  terminalId: string;
  output: string;
  diagnose?: boolean;
}

/** Paginated AI messages: the loaded page plus the total matching count. */
export interface AiMessagesResult {
  messages: AIMessage[];
  total: number;
}

export interface AiTestResult {
  ok: boolean;
  message: string;
}

export const aiService = {
  /** General chat turn. Response streams via `ai-delta` / `ai-done` events. */
  chat(input: AiChatInput): Promise<void> {
    return invoke<void>('ai_chat', { input });
  },

  /** Natural-language → shell command suggestion (streamed). */
  suggest(input: AiSuggestInput): Promise<void> {
    return invoke<void>('ai_suggest', { input });
  },

  /** Explain output or diagnose an error (streamed). */
  explain(input: AiExplainInput): Promise<void> {
    return invoke<void>('ai_explain', { input });
  },

  /** Persist AI provider settings. */
  saveSettings(settings: AISettings): Promise<void> {
    return invoke<void>('ai_settings', { settings });
  },

  /** Load the current AI configuration (api key masked). */
  config(): Promise<AIConfig> {
    return invoke<AIConfig>('ai_config');
  },

  /** List persisted AI messages for a terminal (most recent page + total count). */
  messages(terminalId: string): Promise<AiMessagesResult> {
    return invoke<AiMessagesResult>('ai_messages', { terminalId });
  },

  /** Send a minimal request to verify the provider is reachable. */
  test(): Promise<AiTestResult> {
    return invoke<AiTestResult>('ai_test');
  },
};
