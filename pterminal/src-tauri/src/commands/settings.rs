use crate::db::DbConn;
use crate::state::AppState;
use tauri::State;

/// Read a string value from the `settings` table by key. Returns null (as a
/// Rust `Option<String>`) when the key is absent so the frontend can apply its
/// own defaults.
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let value = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten();
    Ok(value)
}

/// Upsert a string value into the `settings` table.
#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
