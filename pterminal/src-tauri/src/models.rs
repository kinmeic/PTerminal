use serde::{Deserialize, Serialize};

/// Data transfer object for a terminal configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDto {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub shell: Option<String>,
    pub env: Option<String>, // JSON-serialized environment map
    pub created_at: i64,
    pub updated_at: i64,
    pub is_active: bool,
    pub sort_order: i64,
    pub is_pinned: bool,
    pub pin_order: i64,
    /// Per-terminal font size override. None = use the global default.
    pub font_size: Option<i64>,
    /// Id of the workspace this terminal belongs to (None = top-level terminal).
    pub workspace_id: Option<String>,
}

/// Input for creating a new terminal session.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnTerminalInput {
    /// When set, restore an existing terminal record by id instead of creating
    /// a new DB row (used after app restart to re-attach a live PTY).
    pub id: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub name: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    /// Workspace id to group this terminal under (None = top-level terminal).
    pub workspace_id: Option<String>,
}

/// Payload emitted with the `terminal-data` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataPayload {
    pub id: String,
    pub data: String,
}

/// Payload emitted with the `terminal-exit` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitPayload {
    pub id: String,
    pub exit_code: Option<i32>,
}

/// Data transfer object for a common (pinned) command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDto {
    pub id: String,
    pub terminal_id: Option<String>,
    pub label: String,
    pub command: String,
    pub is_pinned: bool,
    pub pin_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommandInput {
    pub terminal_id: Option<String>,
    pub label: String,
    pub command: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCommandInput {
    pub id: String,
    pub label: Option<String>,
    pub command: Option<String>,
    pub terminal_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinCommandInput {
    pub id: String,
    pub is_pinned: bool,
    pub pin_order: Option<i64>,
}

/// Data transfer object for an AI message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessageDto {
    pub id: String,
    pub terminal_id: String,
    pub role: String,
    pub content: String,
    pub message_type: Option<String>,
    pub metadata: Option<String>, // JSON
    pub created_at: i64,
}

/// Paginated AI message result: the loaded page plus the total matching count,
/// so the frontend can tell the user when older messages were truncated.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessagesResult {
    pub messages: Vec<AiMessageDto>,
    /// Total non-empty messages for this terminal (independent of the page size).
    pub total: i64,
}

// NOTE: AI settings use the `AiConfigSettings` type defined in `ai/mod.rs`,
// which supersedes the placeholder that previously lived here.

/// Data transfer object for an SSH shortcut (connection favorite).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshShortcutDto {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub user: String,
    pub identity_file: Option<String>,
    /// Optional password (stored in plaintext — internal/test hosts only).
    pub password: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSshShortcutInput {
    pub name: String,
    pub host: String,
    pub port: Option<i64>,
    pub user: String,
    pub identity_file: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSshShortcutInput {
    pub id: String,
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub user: Option<String>,
    pub identity_file: Option<String>,
    /// Explicitly pass empty string to clear; Some(value) to set; None to keep.
    pub password: Option<String>,
}

/// Input for toggling a terminal's pinned state.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinTerminalInput {
    pub id: String,
    pub is_pinned: bool,
}

/// Input for setting a terminal's per-terminal font size override.
/// `font_size = None` clears the override (terminal follows the global default).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFontSizeInput {
    pub id: String,
    pub font_size: Option<i64>,
}

/// Input for fast, non-AI terminal autocomplete.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCompletionInput {
    pub terminal_id: String,
    pub partial_cmd: String,
    pub limit: Option<usize>,
}

/// Data transfer object for a local autocomplete candidate. `text` is the full
/// command line after applying the completion, matching the AI autocomplete contract.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCompletionDto {
    pub text: String,
    pub kind: String,
    pub source: String,
    pub score: i64,
}

/// Data transfer object for a workspace (a folder pinned to the sidebar).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: i64,
    pub sort_order: i64,
}

/// Input for opening a workspace by folder path.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceInput {
    pub path: String,
}

/// Per-workspace existence-check result used by the frontend's deletion monitor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathStatusDto {
    pub id: String,
    pub exists: bool,
}
