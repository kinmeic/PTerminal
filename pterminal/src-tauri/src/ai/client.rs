use crate::ai::AiConfig;
use crate::db::{DbConn, DbPool};
use reqwest::{Client, Proxy, Url};
use std::net::IpAddr;
use std::time::Duration;

/// DB keys persisted by the frontend settings UI.
pub const KEY_PROXY_SOCKS_URL: &str = "proxy_socks_url";
pub const KEY_PROXY_APPLY_AI: &str = "proxy_apply_ai";
pub const KEY_PROXY_APPLY_HTTP: &str = "proxy_apply_http";

/// Per-request timeout for connection tests. Shorter than the streaming client's
/// 120s default since a connectivity probe should fail fast.
const TEST_TIMEOUT: Duration = Duration::from_secs(30);

/// User-configured SOCKS5 proxy. When `socks_url` is `Some`, requests that are
/// not bypassed (localhost / LAN) are routed through it. The two `apply_*`
/// flags exist so the user can scope which traffic uses the proxy; in practice
/// all app-layer HTTP currently flows through this single client, so they are
/// equivalent today, but kept separate for future per-service routing.
#[derive(Debug, Clone, Default)]
pub struct ProxyConfig {
    /// e.g. `socks5://127.0.0.1:1080` or `socks5h://...`. `None` = direct.
    pub socks_url: Option<String>,
    pub apply_ai: bool,
    pub apply_http: bool,
}

/// Build a shared HTTP client for LLM requests with a generous timeout.
/// When `proxy.socks_url` is set, traffic is routed through the SOCKS5 proxy
/// except for localhost and private/LAN destinations (需求 3).
pub fn build_client(proxy: &ProxyConfig) -> Client {
    let mut builder = Client::builder().timeout(Duration::from_secs(120));
    if let Some(url) = proxy.socks_url.as_deref().filter(|s| !s.trim().is_empty()) {
        if proxy.apply_ai || proxy.apply_http {
            match build_socks_proxy(url) {
                Ok(p) => builder = builder.proxy(p),
                Err(e) => log::error!("invalid SOCKS proxy url {url:?}: {e}; falling back to direct"),
            }
        }
    }
    builder.build().expect("failed to build reqwest client")
}

/// Load the proxy settings from the `settings` table. Defaults to a direct
/// connection (no proxy) when nothing is configured or the DB is unavailable.
/// Used both at app startup (to seed `AppState::http`) and when the user
/// changes settings (via the `proxy_reload` command).
pub fn load_proxy_config(db: &DbPool) -> ProxyConfig {
    let conn: Option<DbConn> = db.get().ok();
    let get = |key: &str| -> Option<String> {
        conn.as_ref().and_then(|c| {
            c.query_row(
                "SELECT value FROM settings WHERE key = ?1",
                rusqlite::params![key],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
        })
    };
    let socks_url = get(KEY_PROXY_SOCKS_URL)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let apply_ai = get(KEY_PROXY_APPLY_AI)
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let apply_http = get(KEY_PROXY_APPLY_HTTP)
        .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    ProxyConfig {
        socks_url,
        apply_ai,
        apply_http,
    }
}

/// Construct a per-request SOCKS5 proxy that bypasses localhost and private
/// IP ranges. Uses `Proxy::custom` because reqwest's `NoProxy` only matches
/// host suffixes, not CIDR ranges.
fn build_socks_proxy(socks_url: &str) -> anyhow::Result<Proxy> {
    let proxy_url: Url = socks_url.parse()?;
    Ok(Proxy::custom(move |target: &Url| {
        if is_bypass(target.host_str().unwrap_or("")) {
            return None;
        }
        Some(proxy_url.clone())
    }))
}

/// Whether a target host should bypass the proxy: localhost or a private/LAN
/// IP literal. Uses std's IP classification (no extra deps). Note this only
/// catches literal IPs and the string "localhost"; a hostname that *resolves*
/// to a private IP (e.g. `nas.local`) is NOT detected — acceptable for AI API
/// endpoints which are public hostnames.
fn is_bypass(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        Ok(IpAddr::V6(v6)) => v6.is_loopback() || v6.is_unspecified(),
        Err(_) => false,
    }
}

/// Join a base URL with an API path, tolerating users who include `/v1` in the
/// base URL (e.g. MiniMax `https://api.minimaxi.com/v1`) and those who don't
/// (e.g. OpenAI `https://api.openai.com`). The path passed here already starts
/// with `/v1/...`, so we strip a trailing `/v1` (and any slash) from the base
/// to avoid doubling it.
pub fn join_api_url(base: &str, path_with_v1: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    let without_v1 = trimmed.strip_suffix("/v1").unwrap_or(trimmed);
    format!("{without_v1}{path_with_v1}")
}

/// Outcome of a connectivity test against the configured provider.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    /// Human-readable status message (success summary or error detail).
    pub message: String,
}

/// Send a minimal non-streaming request to verify the provider is reachable
/// and the API key (if required) is accepted. Used by the settings "测试连接"
/// button — does NOT persist anything or stream.
///
/// Uses the shared app-wide `client` (connection pool / TLS reuse, same as
/// `run_stream`) with a per-request timeout that overrides the client's
/// default 120s so a dead endpoint fails fast.
pub async fn test_connection(client: &Client, cfg: &AiConfig) -> TestResult {
    match cfg.provider {
        crate::ai::Provider::OpenAI => {
            // DeepSeek API doesn't use /v1 prefix
            let path = if cfg.provider_id == "deepseek" {
                "/chat/completions"
            } else {
                "/v1/chat/completions"
            };
            let url = join_api_url(&cfg.base_url, path);
            let body = serde_json::json!({
                "model": cfg.model,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 1,
                "stream": false,
            });
            let mut req = client.post(&url).json(&body).timeout(TEST_TIMEOUT);
            if let Some(key) = &cfg.api_key {
                req = req.bearer_auth(key);
            }
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        TestResult {
                            ok: true,
                            message: format!("连接成功（{}，模型 {}）", status, cfg.model),
                        }
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        TestResult {
                            ok: false,
                            message: format!("HTTP {status}: {}", truncate(&body, 200)),
                        }
                    }
                }
                Err(e) => TestResult {
                    ok: false,
                    message: format!("请求失败：{e}"),
                },
            }
        }
        crate::ai::Provider::Anthropic => {
            let url = join_api_url(&cfg.base_url, "/v1/messages");
            let mut req = client
                .post(&url)
                .timeout(TEST_TIMEOUT)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&serde_json::json!({
                    "model": cfg.model,
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "hi"}],
                }));
            if let Some(key) = &cfg.api_key {
                req = req.header("x-api-key", key);
            }
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        TestResult {
                            ok: true,
                            message: format!("连接成功（{}，模型 {}）", status, cfg.model),
                        }
                    } else {
                        let body = resp.text().await.unwrap_or_default();
                        TestResult {
                            ok: false,
                            message: format!("HTTP {status}: {}", truncate(&body, 200)),
                        }
                    }
                }
                Err(e) => TestResult {
                    ok: false,
                    message: format!("请求失败：{e}"),
                },
            }
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max).collect();
        format!("{cut}…")
    }
}
