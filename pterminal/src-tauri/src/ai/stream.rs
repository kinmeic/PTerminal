use crate::ai::client::join_api_url;
use crate::ai::{ChatMessage, Provider};
use futures_util::StreamExt;
use reqwest::Client;
use std::collections::VecDeque;
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
    // DeepSeek API doesn't use /v1 prefix
    let path = if cfg.provider_id == "deepseek" {
        "/chat/completions"
    } else {
        "/v1/chat/completions"
    };
    let url = join_api_url(&cfg.base_url, path);
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
    let stream = frame_stream(response.bytes_stream(), parse_openai_frame);

    Ok(Box::pin(stream))
}

/// Parse one complete SSE frame; may contain multiple `data:` lines.
fn parse_openai_frame(text: &str) -> anyhow::Result<Vec<StreamEvent>> {
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

    Ok(events_from_delta_and_done(combined_delta, saw_done))
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
    let stream = frame_stream(response.bytes_stream(), parse_anthropic_frame);

    Ok(Box::pin(stream))
}

/// Parse one complete Anthropic SSE frame (`content_block_delta` carries text deltas).
fn parse_anthropic_frame(text: &str) -> anyhow::Result<Vec<StreamEvent>> {
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

    Ok(events_from_delta_and_done(combined_delta, saw_stop))
}

fn events_from_delta_and_done(delta: String, done: bool) -> Vec<StreamEvent> {
    let mut events = Vec::new();
    if !delta.is_empty() {
        events.push(StreamEvent::Delta(delta));
    }
    if done {
        events.push(StreamEvent::Done);
    }
    events
}

fn frame_stream<S, B, F>(byte_stream: S, parser: F) -> DeltaStream
where
    S: futures_util::Stream<Item = Result<B, reqwest::Error>> + Send + Unpin + 'static,
    B: AsRef<[u8]> + Send + 'static,
    F: Fn(&str) -> anyhow::Result<Vec<StreamEvent>> + Send + Copy + 'static,
{
    struct ParserState<S> {
        byte_stream: S,
        buffer: Vec<u8>,
        pending: VecDeque<anyhow::Result<StreamEvent>>,
        eof: bool,
    }

    let state = ParserState {
        byte_stream,
        buffer: Vec::new(),
        pending: VecDeque::new(),
        eof: false,
    };

    let stream = futures_util::stream::unfold(state, move |mut state| async move {
        loop {
            if let Some(item) = state.pending.pop_front() {
                return Some((item, state));
            }
            if let Some(frame) = take_frame(&mut state.buffer) {
                enqueue_parsed_frame(&mut state.pending, parser, &frame);
                continue;
            }
            if state.eof {
                if state.buffer.is_empty() {
                    return None;
                }
                let frame = std::mem::take(&mut state.buffer);
                enqueue_parsed_frame(&mut state.pending, parser, &frame);
                continue;
            }

            match state.byte_stream.next().await {
                Some(Ok(bytes)) => state.buffer.extend_from_slice(bytes.as_ref()),
                Some(Err(e)) => state
                    .pending
                    .push_back(Ok(StreamEvent::Error(e.to_string()))),
                None => state.eof = true,
            }
        }
    });

    Box::pin(stream)
}

fn enqueue_parsed_frame<F>(
    pending: &mut VecDeque<anyhow::Result<StreamEvent>>,
    parser: F,
    frame: &[u8],
) where
    F: Fn(&str) -> anyhow::Result<Vec<StreamEvent>>,
{
    match std::str::from_utf8(frame) {
        Ok(text) => match parser(text) {
            Ok(events) => pending.extend(events.into_iter().map(Ok)),
            Err(e) => pending.push_back(Err(e)),
        },
        Err(e) => pending.push_back(Err(anyhow::anyhow!("invalid UTF-8 in stream frame: {e}"))),
    }
}

fn take_frame(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let boundary = find_boundary(buffer)?;
    let frame = buffer[..boundary.start].to_vec();
    buffer.drain(..boundary.end);
    Some(frame)
}

struct Boundary {
    start: usize,
    end: usize,
}

fn find_boundary(buffer: &[u8]) -> Option<Boundary> {
    for (idx, pair) in buffer.windows(2).enumerate() {
        if pair == b"\n\n" {
            return Some(Boundary {
                start: idx,
                end: idx + 2,
            });
        }
    }
    for (idx, quartet) in buffer.windows(4).enumerate() {
        if quartet == b"\r\n\r\n" {
            return Some(Boundary {
                start: idx,
                end: idx + 4,
            });
        }
    }
    None
}
