import { invoke } from '@tauri-apps/api/core';
import { settingsService, SETTING_KEYS } from './settingsService';

/**
 * SOCKS proxy configuration (需求 3). All four settings live in the same
 * `settings` table as everything else; this service keeps the read/write
 * details in one place and wraps the Rust `proxy_reload` command so the
 * frontend can rebuild the live HTTP client after a change.
 */
export interface ProxyConfig {
  /** e.g. `socks5://127.0.0.1:1080`. Empty string = direct connection. */
  socksUrl: string;
  /** Route AI (LLM) traffic through the proxy when set. */
  applyAi: boolean;
  /** Route other app-layer HTTP traffic through the proxy when set. */
  applyHttp: boolean;
}

export const DEFAULT_PROXY: ProxyConfig = {
  socksUrl: '',
  applyAi: true,
  applyHttp: true,
};

const TRUE = '1';
const FALSE = '0';

/** Read the saved proxy config, falling back to defaults when unset. */
export async function loadProxyConfig(): Promise<ProxyConfig> {
  const [socksUrl, applyAi, applyHttp] = await Promise.all([
    settingsService.get(SETTING_KEYS.proxySocksUrl),
    settingsService.get(SETTING_KEYS.proxyApplyAi),
    settingsService.get(SETTING_KEYS.proxyApplyHttp),
  ]);
  return {
    socksUrl: (socksUrl ?? '').trim(),
    applyAi: applyAi == null ? DEFAULT_PROXY.applyAi : applyAi === TRUE,
    applyHttp: applyHttp == null ? DEFAULT_PROXY.applyHttp : applyHttp === TRUE,
  };
}

/**
 * Persist the proxy config to the settings table, then ask Rust to rebuild
 * the shared HTTP client so the change takes effect immediately. Writes and
 * the reload are sequential — if a write fails we surface it before reload.
 */
export async function saveProxyConfig(cfg: ProxyConfig): Promise<void> {
  await settingsService.set(SETTING_KEYS.proxySocksUrl, cfg.socksUrl.trim());
  await settingsService.set(SETTING_KEYS.proxyApplyAi, cfg.applyAi ? TRUE : FALSE);
  await settingsService.set(SETTING_KEYS.proxyApplyHttp, cfg.applyHttp ? TRUE : FALSE);
  await invoke<void>('proxy_reload');
}
