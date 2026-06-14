import { invoke } from '@tauri-apps/api/core';

/**
 * Generic key-value store backed by the Rust `settings` table. Used for
 * appearance preferences (terminal font family/size, etc.) that aren't owned
 * by a dedicated service.
 */
export const settingsService = {
  get(key: string): Promise<string | null> {
    return invoke<string | null>('settings_get', { key });
  },
  set(key: string, value: string): Promise<void> {
    return invoke<void>('settings_set', { key, value });
  },
};

/** Setting keys used for terminal appearance. */
export const SETTING_KEYS = {
  fontFamily: 'terminal_font_family',
  fontSize: 'terminal_font_size',
} as const;
