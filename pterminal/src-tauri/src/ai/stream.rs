use crate::ai::client::join_api_url;
use crate::ai::{ChatMessage, Provider};
use futures_util::StreamExt;
use reqwest::Client;
use std::pin::Pin;

/// Boxed, Send stream of text deltas.
pub type DeltaStream =
    Pin<Box<dyn futures_util::Stream<Item = anyhow::Result<StreamEvent>> + Send>>;

/// A single text chunk yielded by the stream.
pub enum StreamEvent {
    Delta(String),
    Done,
    Error(String),
}

/// Request a streaming chat completion and yield text deltas.
///
/// Dispatches to the OpenAI-compatible or Anthropic protocol based on `provider`.
pub async fn stream_chat(
    client: &Client,
    cfg: &crate::ai::AiConfig,
    messages: Vec<ChatMessage>,
) -> anyhow::Result<DeltaStream> {
    match cfg.provider {
        Provider::OpenAI => stream_openai(client, cfg, messages).await,
        Provider::Anthropic => stream_anthropic(client, cfg, messages).await,
    }
}

// ---- OpenAI-compatible (also Ollama, OpenAI, etc.) ------------------------

async fn stream_openai(
    client: &Client,
    cfg: &crate::ai::AiConfig,
    messages: Vec<ChatMessage>,
) -> anyhow::Result<DeltaStream> {
    let url = join_api_url(&cfg.base_url, "/v1/chat/completions");
    let body = serde_json::json!({
        "model": cfg.model,
        "messages": messages,
        "stream": true,
    });

    let mut req = client.post(&url).json(&body);
    if let Some(key) = &cfg.api_key {
        req = req.bearer_auth(key);
    }
    let response = req.send().await?.error_for_status()?;
    let byte_stream = response.bytes_stream();

    // Parse the SSE byte stream into delta events.
    let stream = byte_stream
        .map(|chunk_result| match chunk_result {
            Ok(c) => parse_openai_chunk(&c),
            Err(e) => Ok(Some(StreamEvent::Error(e.to_string()))),
        })
        .filter_map(|item: Result<Option<StreamEvent>, anyhow::Error>| async move {
            match item {
                Ok(Some(ev)) => Some(Ok(ev)),
                Ok(None) => None,
                Err(e) => Some(Err(e)),
            }
        });

    Ok(Box::pin(stream))
}

/// Parse one SSE chunk buffer; may contain multiple `data:` lines.
fn parse_openai_chunk(bytes: &[u8]) -> anyhow::Result<Option<StreamEvent>> {
    let text = String::from_utf8_lossy(bytes);
    let mut combined_delta = String::new();
    let mut saw_done = false;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let data = match line.strip_prefix("data:") {
            Some(d) => d.trim(),
            None => continue,
        };
        if data == "[DONE]" {
            saw_done = true;
            continue;
        }
        // Extract the delta content from the JSON.
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(delta) = v
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("delta"))
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
            {
                combined_delta.push_str(delta);
            }
            // Ollama streams newline-delimited JSON with "message.content".
            if let Some(delta) = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
            {
                combined_delta.push_str(delta);
            }
        }
    }

    if saw_done && combined_delta.is_empty() {
        Ok(Some(StreamEvent::Done))
    } else if !combined_delta.is_empty() {
        Ok(Some(StreamEvent::Delta(combined_delta)))
    } else {
        Ok(None)
    }
}

// ---- Anthropic Claude ------------------------------------------------------

async fn stream_anthropic(
    client: &Client,
    cfg: &crate::ai::AiConfig,
    messages: Vec<ChatMessage>,
) -> anyhow::Result<DeltaStream> {
    let url = join_api_url(&cfg.base_url, "/v1/messages");
    // Anthropic separates the system prompt from the message list.
    let (system, convo): (String, Vec<ChatMessage>) = {
        let mut sys = String::new();
        let mut conv = Vec::new();
        for m in messages {
            if m.role == "system" {
                if !sys.is_empty() {
                    sys.push_str("\n\n");
                }
                sys.push_str(&m.content);
            } else {
                conv.push(m);
            }
        }
        (sys, conv)
    };

    let body = serde_json::json!({
        "model": cfg.model,
        "max_tokens": 2048,
        "system": system,
        "messages": convo,
        "stream": true,
    });

    let response = client
        .post(&url)
        .header("x-api-key", cfg.api_key.as_deref().unwrap_or(""))
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?
        .error_for_status()?;
    let byte_stream = response.bytes_stream();

    let stream = byte_stream
        .map(|chunk_result| match chunk_result {
            Ok(c) => parse_anthropic_chunk(&c),
            Err(e) => Ok(Some(StreamEvent::Error(e.to_string()))),
        })
        .filter_map(|item: Result<Option<StreamEvent>, anyhow::Error>| async move {
            match item {
                Ok(Some(ev)) => Some(Ok(ev)),
                Ok(None) => None,
                Err(e) => Some(Err(e)),
            }
        });

    Ok(Box::pin(stream))
}

/// Parse Anthropic SSE events (`content_block_delta` carries text deltas).
fn parse_anthropic_chunk(bytes: &[u8]) -> anyhow::Result<Option<StreamEvent>> {
    let text = String::from_utf8_lossy(bytes);
    let mut combined_delta = String::new();
    let mut saw_stop = false;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let data = match line.strip_prefix("data:") {
            Some(d) => d.trim(),
            None => continue,
        };
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
            match v.get("type").and_then(|t| t.as_str()) {
                Some("content_block_delta") => {
                    if let Some(text) = v
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                    {
                        combined_delta.push_str(text);
                    }
                }
                Some("message_stop") => saw_stop = true,
                _ => {}
            }
        }
    }

    if saw_stop && combined_delta.is_empty() {
        Ok(Some(StreamEvent::Done))
    } else if !combined_delta.is_empty() {
        Ok(Some(StreamEvent::Delta(combined_delta)))
    } else {
        Ok(None)
    }
}
