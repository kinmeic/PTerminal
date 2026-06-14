use crate::ai::{self, prompt, AiConfigSettings, ChatMessage};
use crate::db::DbConn;
use crate::state::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

/// Shared payload for all AI streaming events. The frontend matches on
/// `request_id` to route deltas to the right panel/turn.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamPayload {
    pub request_id: String,
    pub terminal_id: String,
    pub kind: String, // chat | suggest | explain | diagnose
    pub delta: Option<String>,
    pub error: Option<String>,
    pub done: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatInput {
    pub terminal_id: String,
    pub message: String,
    /// Client-generated id for this turn, used to match a later `ai_cancel`.
    pub request_id: String,
    /// Optional recent conversation history (role + content).
    pub history: Option<Vec<ChatMessage>>,
    /// Optional snapshot of recent terminal output lines, included as context.
    pub terminal_context: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestInput {
    pub terminal_id: String,
    pub prompt: String,
    /// Client-generated id for this turn, used to match a later `ai_cancel`.
    pub request_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExplainInput {
    pub terminal_id: String,
    pub output: String,
    pub diagnose: Option<bool>,
    /// Client-generated id for this turn, used to match a later `ai_cancel`.
    pub request_id: String,
}

/// Persist a user message and an (empty) assistant placeholder, returning
/// both ids so the frontend can reference them as the stream fills in.
fn persist_turn(
    state: &AppState,
    terminal_id: &str,
    kind: &str,
    user_text: &str,
) -> Result<(String, String), String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    let user_id = uuid::Uuid::new_v4().to_string();
    let assistant_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ai_messages (id, terminal_id, role, content, message_type, metadata, created_at)
         VALUES (?1, ?2, 'user', ?3, ?4, NULL, ?5)",
        params![user_id, terminal_id, user_text, kind, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ai_messages (id, terminal_id, role, content, message_type, metadata, created_at)
         VALUES (?1, ?2, 'assistant', '', ?3, NULL, ?4)",
        params![assistant_id, terminal_id, kind, now],
    )
    .map_err(|e| e.to_string())?;
    Ok((user_id, assistant_id))
}

/// Finalize the assistant placeholder once the stream completes.
fn finalize_assistant(
    state: &AppState,
    assistant_id: &str,
    content: &str,
) -> Result<(), String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_messages SET content = ?1 WHERE id = ?2",
        params![content, assistant_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Resolve the cwd for a terminal from the DB (used for prompt context).
fn terminal_cwd(state: &AppState, terminal_id: &str) -> String {
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(_) => return ".".to_string(),
    };
    conn.query_row(
        "SELECT cwd FROM terminals WHERE id = ?1",
        params![terminal_id],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_else(|_| ".".to_string())
}

/// Run a streaming chat against the configured provider, emitting
/// `ai-delta` / `ai-done` events. Persists both turns to `ai_messages`.
///
/// `request_id` is supplied by the frontend and registered in `state.cancels`
/// so a later `ai_cancel` can abort the stream mid-flight. The token is
/// removed when the stream completes (naturally, by error, or by cancel).
async fn run_stream(
    app: AppHandle,
    state: AppState,
    terminal_id: String,
    kind: String,
    messages: Vec<ChatMessage>,
    user_text: String,
    request_id: String,
) -> Result<(), String> {
    let cfg = ai::load_config(&state.db);

    // Register a cancellation token for this turn. If the id is already in use
    // (frontend bug / reused id), cancel the old one and replace it.
    let cancel = {
        let mut map = state.cancels.lock().expect("cancels lock poisoned");
        let token = CancellationToken::new();
        let token_clone = token.clone();
        map.insert(request_id.clone(), token);
        token_clone
    };

    // Always remove the token on exit so the map doesn't leak finished streams.
    let cleanup = |state: &AppState, id: &str| {
        let mut map = state.cancels.lock().expect("cancels lock poisoned");
        map.remove(id);
    };

    // Persist the user turn + assistant placeholder.
    let (_user_id, assistant_id) =
        match persist_turn(&state, &terminal_id, &kind, &user_text) {
            Ok(ids) => ids,
            Err(e) => {
                let _ = emit_error(&app, &request_id, &terminal_id, &kind, &e);
                cleanup(&state, &request_id);
                return Err(e);
            }
        };

    // Reuse the app-wide HTTP client (connection pool / TLS session sharing).
    let client = state.http.clone();
    let mut full = String::new();

    let stream = match ai::stream::stream_chat(&client, &cfg, messages).await {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("AI request failed: {e}");
            let _ = emit_error(&app, &request_id, &terminal_id, &kind, &msg);
            let _ = finalize_assistant(&state, &assistant_id, &msg);
            cleanup(&state, &request_id);
            return Err(msg);
        }
    };

    use futures_util::StreamExt;
    let mut stream = stream;
    let mut cancelled = false;
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                cancelled = true;
                break;
            }
            item = stream.next() => {
                match item {
                    Some(Ok(ai::stream::StreamEvent::Delta(delta))) => {
                        full.push_str(&delta);
                        let _ = app.emit(
                            "ai-delta",
                            AiStreamPayload {
                                request_id: request_id.clone(),
                                terminal_id: terminal_id.clone(),
                                kind: kind.clone(),
                                delta: Some(delta),
                                error: None,
                                done: false,
                            },
                        );
                    }
                    Some(Ok(ai::stream::StreamEvent::Done)) => break,
                    Some(Ok(ai::stream::StreamEvent::Error(e))) => {
                        let _ = emit_error(&app, &request_id, &terminal_id, &kind, &e);
                        let _ = finalize_assistant(&state, &assistant_id, &format!("{full}\n\n[error: {e}]"));
                        cleanup(&state, &request_id);
                        return Err(e);
                    }
                    Some(Err(e)) => {
                        let _ = emit_error(&app, &request_id, &terminal_id, &kind, &e.to_string());
                        let _ = finalize_assistant(&state, &assistant_id, &format!("{full}\n\n[error: {e}]"));
                        cleanup(&state, &request_id);
                        return Err(e.to_string());
                    }
                    None => break,
                }
            }
        }
    }

    // Finalize persisted assistant content + signal completion. On cancel we
    // keep whatever was streamed so far and tag it so the user sees it stopped.
    if cancelled {
        full.push_str("\n\n[已停止]");
    }
    let _ = finalize_assistant(&state, &assistant_id, &full);
    let _ = app.emit(
        "ai-done",
        AiStreamPayload {
            request_id: request_id.clone(),
            terminal_id,
            kind,
            delta: None,
            error: None,
            done: true,
        },
    );
    cleanup(&state, &request_id);
    Ok(())
}

fn emit_error(
    app: &AppHandle,
    request_id: &str,
    terminal_id: &str,
    kind: &str,
    msg: &str,
) -> tauri::Result<()> {
    app.emit(
        "ai-done",
        AiStreamPayload {
            request_id: request_id.to_string(),
            terminal_id: terminal_id.to_string(),
            kind: kind.to_string(),
            delta: None,
            error: Some(msg.to_string()),
            done: true,
        },
    )
}

// ---- Tauri commands --------------------------------------------------------

/// General AI chat bound to a terminal's context.
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AiChatInput,
) -> Result<(), String> {
    let cwd = terminal_cwd(&state, &input.terminal_id);
    let messages = prompt::chat_messages(
        &input.history.unwrap_or_default(),
        &input.message,
        &cwd,
        input.terminal_context.as_deref(),
    );
    run_stream(app, state.inner().clone(), input.terminal_id, "chat".to_string(), messages, input.message, input.request_id).await
}

/// Natural-language → shell command suggestion (streamed).
#[tauri::command]
pub async fn ai_suggest(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AiSuggestInput,
) -> Result<(), String> {
    let cwd = terminal_cwd(&state, &input.terminal_id);
    let messages = prompt::suggest_messages(&input.prompt, &cwd);
    run_stream(app, state.inner().clone(), input.terminal_id, "command_suggest".to_string(), messages, input.prompt, input.request_id).await
}

/// Explain terminal output (or diagnose an error if `diagnose: true`).
#[tauri::command]
pub async fn ai_explain(
    app: AppHandle,
    state: State<'_, AppState>,
    input: AiExplainInput,
) -> Result<(), String> {
    let cwd = terminal_cwd(&state, &input.terminal_id);
    let kind = if input.diagnose.unwrap_or(false) {
        "error_diagnose"
    } else {
        "output_explain"
    };
    let messages = if input.diagnose.unwrap_or(false) {
        prompt::diagnose_messages(&input.output, &cwd)
    } else {
        prompt::explain_messages(&input.output, &cwd)
    };
    run_stream(app, state.inner().clone(), input.terminal_id, kind.to_string(), messages, input.output, input.request_id).await
}

/// Abort an in-flight AI stream by its request_id. No-op (Ok) if the id isn't
/// registered — the frontend may issue a cancel after the stream already ended.
#[tauri::command]
pub fn ai_cancel(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    let map = state.cancels.lock().expect("cancels lock poisoned");
    if let Some(token) = map.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

/// Persist AI provider settings.
#[tauri::command]
pub fn ai_settings(state: State<'_, AppState>, settings: AiConfigSettings) -> Result<(), String> {
    ai::save_config(&state.db, &settings).map_err(|e| e.to_string())
}

/// Load the current AI configuration (api_key masked) for the settings UI.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigDto {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub has_api_key: bool,
    pub terminal_context_lines: u32,
}

#[tauri::command]
pub fn ai_config(state: State<'_, AppState>) -> Result<AiConfigDto, String> {
    let cfg = ai::load_config(&state.db);
    Ok(AiConfigDto {
        provider: format!("{:?}", cfg.provider).to_lowercase(),
        model: cfg.model,
        base_url: cfg.base_url,
        has_api_key: cfg.api_key.is_some(),
        terminal_context_lines: cfg.terminal_context_lines,
    })
}

/// List persisted AI messages for a terminal (for chat history reload).
/// Returns the most recent page plus the total count, so the frontend can tell
/// the user when older messages were truncated by the page size.
#[tauri::command]
pub fn ai_messages(state: State<'_, AppState>, terminal_id: String) -> Result<crate::models::AiMessagesResult, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;

    // Total non-empty messages for this terminal (drives the "N more" hint).
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ai_messages
             WHERE terminal_id = ?1 AND NOT (role = 'assistant' AND content = '')",
            params![terminal_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // Load the most recent PAGE_SIZE messages. We fetch the tail (DESC LIMIT)
    // then reverse so the array is chronological for display.
    const PAGE_SIZE: i64 = 200;
    let mut stmt = conn
        .prepare(
            "SELECT id, terminal_id, role, content, message_type, metadata, created_at
             FROM ai_messages
             WHERE terminal_id = ?1
               AND NOT (role = 'assistant' AND content = '')
             ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![terminal_id, PAGE_SIZE], |row| {
            Ok(crate::models::AiMessageDto {
                id: row.get(0)?,
                terminal_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                message_type: row.get(4)?,
                metadata: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<crate::models::AiMessageDto> = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    // Reverse DESC → ASC so the oldest of the page renders first.
    out.reverse();

    Ok(crate::models::AiMessagesResult { messages: out, total })
}

/// Verify connectivity to the configured LLM provider with a minimal request.
/// Returns a human-readable result; does not persist anything.
#[tauri::command]
pub async fn ai_test(state: State<'_, AppState>) -> Result<crate::ai::client::TestResult, String> {
    let cfg = ai::load_config(&state.db);
    Ok(crate::ai::client::test_connection(&state.http, &cfg).await)
}
