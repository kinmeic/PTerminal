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
  lineHeight: 'terminal_line_height',
  // UI state persistence (需求 2)
  leftPanelVisible: 'ui_left_panel_visible',
  rightPanelVisible: 'ui_right_panel_visible',
  isDarkMode: 'ui_is_dark_mode',
  activeTerminalId: 'ui_active_terminal_id',
  leftWidth: 'ui_left_width',
  rightWidth: 'ui_right_width',
  // SOCKS proxy (需求 3)
  proxySocksUrl: 'proxy_socks_url',
  proxyApplyAi: 'proxy_apply_ai',
  proxyApplyHttp: 'proxy_apply_http',
  // Terminal autocomplete toggles
  terminalAutocompleteEnabled: 'terminal_autocomplete_enabled',
  autocompleteEnabled: 'ai_autocomplete_enabled',
} as const;
