import { invoke } from '@tauri-apps/api/core';
import type { AIConfig, AIMessage, AISettings } from '@/types';
import {
  validateBaseUrl,
  validateContextWindow,
  validateCompressionThreshold,
} from '@/utils/validation';

export interface AiChatInput {
  terminalId: string;
  message: string;
  /** Client-generated id; a later `cancel(requestId)` aborts this stream. */
  requestId: string;
  history?: { role: string; content: string }[];
  /** Snapshot of recent terminal output to include as context. */
  terminalContext?: string;
}

export interface AiSuggestInput {
  terminalId: string;
  prompt: string;
  /** Client-generated id; a later `cancel(requestId)` aborts this stream. */
  requestId: string;
}

export interface AiExplainInput {
  terminalId: string;
  output: string;
  diagnose?: boolean;
  /** Client-generated id; a later `cancel(requestId)` aborts this stream. */
  requestId: string;
}

export interface AiAutocompleteInput {
  terminalId: string;
  partialCmd: string;
  /** Client-generated id; a later `cancel(requestId)` aborts this stream. */
  requestId: string;
  /** Snapshot of recent terminal output to include as context. */
  terminalContext?: string;
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
    if (!input.message.trim()) throw new Error('Message is required');
    if (!input.terminalId) throw new Error('Terminal ID is required');
    return invoke<void>('ai_chat', { input });
  },

  /** Natural-language → shell command suggestion (streamed). */
  suggest(input: AiSuggestInput): Promise<void> {
    if (!input.prompt.trim()) throw new Error('Prompt is required');
    if (!input.terminalId) throw new Error('Terminal ID is required');
    return invoke<void>('ai_suggest', { input });
  },

  /** Explain output or diagnose an error (streamed). */
  explain(input: AiExplainInput): Promise<void> {
    if (!input.output.trim()) throw new Error('Output is required');
    if (!input.terminalId) throw new Error('Terminal ID is required');
    return invoke<void>('ai_explain', { input });
  },

  /** Real-time shell command autocomplete (streamed, non-persistent). */
  autocomplete(input: AiAutocompleteInput): Promise<void> {
    if (!input.partialCmd.trim()) throw new Error('Partial command is required');
    if (!input.terminalId) throw new Error('Terminal ID is required');
    return invoke<void>('ai_autocomplete', { input });
  },

  /** Abort an in-flight AI stream by the id passed to chat/suggest/explain/autocomplete. */
  cancel(requestId: string): Promise<void> {
    return invoke<void>('ai_cancel', { requestId });
  },

  /** Persist AI provider settings. */
  saveSettings(settings: AISettings): Promise<void> {
    if (settings.baseUrl) {
      const result = validateBaseUrl(settings.baseUrl);
      if (!result.valid) throw new Error(result.error);
    }
    if (settings.contextWindow !== undefined) {
      const result = validateContextWindow(settings.contextWindow);
      if (!result.valid) throw new Error(result.error);
    }
    if (settings.compressionThreshold !== undefined) {
      const result = validateCompressionThreshold(settings.compressionThreshold);
      if (!result.valid) throw new Error(result.error);
    }
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

  /** Clear all AI messages for a terminal (reset conversation). */
  clearMessages(terminalId: string): Promise<void> {
    return invoke<void>('ai_clear_messages', { terminalId });
  },
};
