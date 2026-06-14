use crate::ai::AiConfig;
use reqwest::Client;
use std::time::Duration;

/// Per-request timeout for connection tests. Shorter than the streaming client's
/// 120s default since a connectivity probe should fail fast.
const TEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Build a shared HTTP client for LLM requests with a generous timeout.
pub fn build_client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("failed to build reqwest client")
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
            let url = join_api_url(&cfg.base_url, "/v1/chat/completions");
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
