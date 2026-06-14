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
            "ollama" | "openai-compatible" | "custom" => Some(Provider::OpenAI),
            _ => None,
        }
    }
}

/// Resolved AI configuration loaded from the `settings` table.
#[derive(Debug, Clone)]
pub struct AiConfig {
    pub provider: Provider,
    pub api_key: Option<String>,
    pub model: String,
    pub base_url: String,
    /// How many lines of terminal output to include as context when the user
    /// sends an AI chat message. 0 disables context inclusion.
    pub terminal_context_lines: u32,
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

    let provider_str = get("ai_provider").unwrap_or_else(|| "ollama".to_string());
    let provider = Provider::from_str(&provider_str).unwrap_or(Provider::OpenAI);
    let api_key = get("ai_api_key");
    let model = get("ai_model").unwrap_or_else(|| {
        if provider == Provider::Anthropic {
            "claude-3-5-sonnet-latest".to_string()
        } else if provider_str == "ollama" {
            "llama3.2".to_string()
        } else {
            "gpt-4o-mini".to_string()
        }
    });
    let base_url = get("ai_base_url").unwrap_or_else(|| {
        match provider {
            Provider::Anthropic => "https://api.anthropic.com".to_string(),
            Provider::OpenAI => {
                if provider_str == "ollama" {
                    "http://localhost:11434".to_string()
                } else {
                    "https://api.openai.com".to_string()
                }
            }
        }
    });
    let terminal_context_lines = get("ai_terminal_context_lines")
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(50);

    AiConfig {
        provider,
        api_key,
        model,
        base_url,
        terminal_context_lines,
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
}
