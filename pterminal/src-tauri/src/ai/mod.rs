pub mod client;
pub mod prompt;
pub mod stream;

use crate::db::{DbConn, DbPool};
use serde::{Deserialize, Serialize};

/// A chat message in the unified format used across providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // system | user | assistant
    pub content: String,
}

/// Which LLM provider backend to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    OpenAI,
    Anthropic,
}

impl Provider {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "openai" => Some(Provider::OpenAI),
            "anthropic" | "claude" => Some(Provider::Anthropic),
            // ollama + other OpenAI-compatible endpoints use the OpenAI path
            "ollama" | "deepseek" | "moonshot" | "openai-compatible" | "custom" => {
                Some(Provider::OpenAI)
            }
            _ => None,
        }
    }
}

/// Resolved AI configuration loaded from the `settings` table.
#[derive(Debug, Clone)]
pub struct AiConfig {
    /// Raw provider id saved by the UI (e.g. openai, ollama, deepseek).
    /// `provider` below is the protocol family used for requests.
    pub provider_id: String,
    pub provider: Provider,
    pub api_key: Option<String>,
    pub model: String,
    pub base_url: String,
    /// How many lines of terminal output to include as context when the user
    /// sends an AI chat message. 0 disables context inclusion.
    pub terminal_context_lines: u32,
    /// Maximum context window size in tokens (for compression decisions).
    pub context_window: u32,
    /// Threshold (0.0–1.0) at which to trigger compression. When estimated
    /// tokens exceed context_window * threshold, history is compressed.
    pub compression_threshold: f32,
}

/// Load AI settings from the `settings` table, falling back to Ollama defaults.
pub fn load_config(db: &DbPool) -> AiConfig {
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

    let provider_str = get("ai_provider")
        .unwrap_or_else(|| "ollama".to_string())
        .trim()
        .to_ascii_lowercase();
    let provider = Provider::from_str(&provider_str).unwrap_or(Provider::OpenAI);
    let api_key = get("ai_api_key");
    let model = get("ai_model").unwrap_or_else(|| default_model(&provider_str, provider));
    let base_url = get("ai_base_url").unwrap_or_else(|| match provider {
        Provider::Anthropic => "https://api.anthropic.com".to_string(),
        Provider::OpenAI => default_base_url(&provider_str).to_string(),
    });
    let terminal_context_lines = get("ai_terminal_context_lines")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(50);
    let context_window = get("ai_context_window")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(200000);
    let compression_threshold = get("ai_compression_threshold")
        .and_then(|s| s.parse::<f32>().ok())
        .unwrap_or(0.75);

    AiConfig {
        provider_id: provider_str,
        provider,
        api_key,
        model,
        base_url,
        terminal_context_lines,
        context_window,
        compression_threshold,
    }
}

/// Persist AI settings into the `settings` table (upsert).
pub fn save_config(db: &DbPool, cfg: &AiConfigSettings) -> anyhow::Result<()> {
    let conn: DbConn = db.get()?;
    let upsert = |key: &str, value: &str| -> anyhow::Result<()> {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    };
    if let Some(p) = &cfg.provider {
        upsert("ai_provider", p)?;
    }
    if let Some(k) = &cfg.api_key {
        upsert("ai_api_key", k)?;
    }
    if let Some(m) = &cfg.model {
        upsert("ai_model", m)?;
    }
    if let Some(u) = &cfg.base_url {
        upsert("ai_base_url", u)?;
    }
    if let Some(n) = cfg.terminal_context_lines {
        upsert("ai_terminal_context_lines", &n.to_string())?;
    }
    if let Some(n) = cfg.context_window {
        upsert("ai_context_window", &n.to_string())?;
    }
    if let Some(n) = cfg.compression_threshold {
        upsert("ai_compression_threshold", &n.to_string())?;
    }
    Ok(())
}

/// Raw settings input from the frontend (all fields optional).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigSettings {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub terminal_context_lines: Option<u32>,
    pub context_window: Option<u32>,
    pub compression_threshold: Option<f32>,
}

fn default_model(provider: &str, protocol: Provider) -> String {
    match provider {
        "ollama" => "llama3.2".to_string(),
        "deepseek" => "deepseek-chat".to_string(),
        "moonshot" => "moonshot-v1-8k".to_string(),
        _ if protocol == Provider::Anthropic => "claude-3-5-sonnet-latest".to_string(),
        _ => "gpt-4o-mini".to_string(),
    }
}

fn default_base_url(provider: &str) -> &'static str {
    match provider {
        "ollama" => "http://localhost:11434",
        "deepseek" => "https://api.deepseek.com",
        "moonshot" => "https://api.moonshot.cn",
        _ => "https://api.openai.com",
    }
}
