use crate::ai::client;
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

/// Rebuild the shared HTTP client from the current proxy settings in the DB.
/// Called by the frontend after it persists new SOCKS proxy settings via
/// `settings_set`, so new AI/HTTP requests pick up the change live without an
/// app restart. The frontend does NOT need to also call this for an initial
/// proxy config — `AppState::new` reads the proxy at startup.
#[tauri::command]
pub fn proxy_reload(state: State<'_, AppState>) -> Result<(), String> {
    let proxy = client::load_proxy_config(&state.db);
    state.rebuild_http(&proxy);
    log::info!(
        "proxy reloaded: socks_url={:?} apply_ai={} apply_http={}",
        proxy.socks_url, proxy.apply_ai, proxy.apply_http
    );
    Ok(())
}
