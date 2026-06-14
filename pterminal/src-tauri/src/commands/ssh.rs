use crate::db::DbConn;
use crate::models::{CreateSshShortcutInput, SshShortcutDto, UpdateSshShortcutInput};
use crate::state::AppState;
use rusqlite::params;
use tauri::State;

/// Create a new SSH shortcut.
#[tauri::command]
pub fn ssh_create(
    state: State<'_, AppState>,
    input: CreateSshShortcutInput,
) -> Result<SshShortcutDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let port = input.port.unwrap_or(22);
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO ssh_shortcuts (id, name, host, port, user, identity_file, password, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, input.name, input.host, port, input.user, input.identity_file, input.password, now],
    )
    .map_err(|e| e.to_string())?;
    fetch_shortcut(&state, &id)
}

/// Update an SSH shortcut's fields (only non-null fields are written).
#[tauri::command]
pub fn ssh_update(
    state: State<'_, AppState>,
    input: UpdateSshShortcutInput,
) -> Result<SshShortcutDto, String> {
    let now = chrono::Utc::now().timestamp();
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;

    // Build a single atomic UPDATE covering all provided fields, rather than
    // one statement per field (which could leave the row half-updated if a
    // later statement failed). Convention: an empty string clears an optional
    // text field (identity_file / password); None leaves it unchanged.
    let mut sets: Vec<&str> = Vec::new();
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    // Owned values whose references go into `params`; must outlive the Vec.
    let port_val = input.port;

    if let Some(name) = &input.name {
        sets.push("name = ?");
        params.push(name);
    }
    if let Some(host) = &input.host {
        sets.push("host = ?");
        params.push(host);
    }
    if let Some(port) = &port_val {
        sets.push("port = ?");
        params.push(port);
    }
    if let Some(user) = &input.user {
        sets.push("user = ?");
        params.push(user);
    }
    if let Some(identity_file) = &input.identity_file {
        sets.push("identity_file = ?");
        params.push(identity_file);
    }
    if let Some(password) = &input.password {
        // Empty string → NULL (clear); non-empty → the value.
        if password.is_empty() {
            sets.push("password = NULL");
        } else {
            sets.push("password = ?");
            params.push(password);
        }
    }
    sets.push("updated_at = ?");
    params.push(&now);
    params.push(&input.id);

    let sql = format!("UPDATE ssh_shortcuts SET {} WHERE id = ?", sets.join(", "));
    conn.execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;

    fetch_shortcut(&state, &input.id)
}

/// Delete an SSH shortcut.
#[tauri::command]
pub fn ssh_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ssh_shortcuts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// List all SSH shortcuts, oldest first.
#[tauri::command]
pub fn ssh_list(state: State<'_, AppState>) -> Result<Vec<SshShortcutDto>, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, host, port, user, identity_file, password, created_at, updated_at
             FROM ssh_shortcuts
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SshShortcutDto {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                user: row.get(4)?,
                identity_file: row.get(5)?,
                password: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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

fn fetch_shortcut(state: &AppState, id: &str) -> Result<SshShortcutDto, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, name, host, port, user, identity_file, password, created_at, updated_at
         FROM ssh_shortcuts WHERE id = ?1",
        params![id],
        |row| {
            Ok(SshShortcutDto {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                user: row.get(4)?,
                identity_file: row.get(5)?,
                password: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}
