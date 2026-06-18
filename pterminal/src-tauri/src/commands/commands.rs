use crate::db::DbConn;
use crate::models::{CommandDto, CreateCommandInput, PinCommandInput, UpdateCommandInput};
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

/// Create a common command. `terminal_id = None` means a global command.
#[tauri::command]
pub fn command_create(
    state: State<'_, AppState>,
    input: CreateCommandInput,
) -> Result<CommandDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO commands (id, terminal_id, label, command, is_pinned, pin_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?5)",
        params![id, input.terminal_id, input.label, input.command, now],
    )
    .map_err(|e| e.to_string())?;
    fetch_command(&state, &id)
}

/// Update a command's label/command/terminal association.
#[tauri::command]
pub fn command_update(
    state: State<'_, AppState>,
    input: UpdateCommandInput,
) -> Result<CommandDto, String> {
    let now = chrono::Utc::now().timestamp();
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    // Single atomic UPDATE covering all provided fields.
    let mut sets: Vec<&str> = Vec::new();
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    if let Some(label) = &input.label {
        sets.push("label = ?");
        params.push(label);
    }
    if let Some(command) = &input.command {
        sets.push("command = ?");
        params.push(command);
    }
    if let Some(terminal_id) = &input.terminal_id {
        sets.push("terminal_id = ?");
        params.push(terminal_id);
    }
    sets.push("updated_at = ?");
    params.push(&now);
    params.push(&input.id);

    let sql = format!("UPDATE commands SET {} WHERE id = ?", sets.join(", "));
    conn.execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;
    fetch_command(&state, &input.id)
}

/// Delete a command.
#[tauri::command]
pub fn command_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM commands WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggle pin state and (optionally) set pin order.
#[tauri::command]
pub fn command_pin(
    state: State<'_, AppState>,
    input: PinCommandInput,
) -> Result<CommandDto, String> {
    let now = chrono::Utc::now().timestamp();
    let order = input.pin_order.unwrap_or_else(|| {
        // Default: place at the end of the pinned list when pinning.
        if input.is_pinned {
            next_pin_order(&state, input.id.as_str())
        } else {
            0
        }
    });
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE commands SET is_pinned = ?1, pin_order = ?2, updated_at = ?3 WHERE id = ?4",
        params![if input.is_pinned { 1 } else { 0 }, order, now, input.id],
    )
    .map_err(|e| e.to_string())?;
    fetch_command(&state, &input.id)
}

/// List commands for a single terminal (terminal-specific rows only). Global
/// custom completions (terminal_id NULL) are excluded here so they don't
/// clutter the right panel — they come back via `command_list_global` and are
/// surfaced through autocomplete.
/// Pinned commands appear first, ordered by pin_order; then by created_at.
#[tauri::command]
pub fn command_list(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Vec<CommandDto>, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, terminal_id, label, command, is_pinned, pin_order, created_at, updated_at
             FROM commands
             WHERE terminal_id = ?1
             ORDER BY is_pinned DESC, pin_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![terminal_id], |row| {
            Ok(CommandDto {
                id: row.get(0)?,
                terminal_id: row.get(1)?,
                label: row.get(2)?,
                command: row.get(3)?,
                is_pinned: row.get::<_, i64>(4)? != 0,
                pin_order: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

// ---- helpers ---------------------------------------------------------------

/// List global custom completions (terminal_id NULL). These are user-curated,
/// always-available completions merged into terminal autocomplete.
/// Pinned first, then by created_at.
#[tauri::command]
pub fn command_list_global(state: State<'_, AppState>) -> Result<Vec<CommandDto>, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, terminal_id, label, command, is_pinned, pin_order, created_at, updated_at
             FROM commands
             WHERE terminal_id IS NULL
             ORDER BY is_pinned DESC, pin_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(CommandDto {
            id: row.get(0)?,
            terminal_id: row.get(1)?,
            label: row.get(2)?,
            command: row.get(3)?,
            is_pinned: row.get::<_, i64>(4)? != 0,
            pin_order: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn fetch_command(state: &AppState, id: &str) -> Result<CommandDto, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, terminal_id, label, command, is_pinned, pin_order, created_at, updated_at
         FROM commands WHERE id = ?1",
        params![id],
        |row| {
            Ok(CommandDto {
                id: row.get(0)?,
                terminal_id: row.get(1)?,
                label: row.get(2)?,
                command: row.get(3)?,
                is_pinned: row.get::<_, i64>(4)? != 0,
                pin_order: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn next_pin_order(state: &AppState, _exclude_id: &str) -> i64 {
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    conn.query_row(
        "SELECT COALESCE(MAX(pin_order), -1) + 1 FROM commands WHERE is_pinned = 1",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}
