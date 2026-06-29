use crate::commands::terminal::delete_terminal_by_id;
use crate::db::DbConn;
use crate::models::{CreateWorkspaceInput, WorkspaceDto, WorkspacePathStatusDto};
use crate::state::AppState;
use rusqlite::params;
use std::path::Path;
use tauri::State;

/// Open a folder as a workspace. The folder path is unique per workspace, so
/// re-opening an already-open folder returns the existing record instead of
/// creating a duplicate (the sidebar treats each path as a single group).
#[tauri::command]
pub fn workspace_create(
    state: State<'_, AppState>,
    input: CreateWorkspaceInput,
) -> Result<WorkspaceDto, String> {
    let path = input.path.trim();
    if path.is_empty() {
        return Err("workspace path is empty".to_string());
    }
    // Normalize to a canonical absolute path so two references to the same
    // folder (e.g. one with a trailing slash) collapse to one workspace.
    let canonical = Path::new(path)
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_string());

    let now = chrono::Utc::now().timestamp();
    let name = Path::new(&canonical)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        // Fall back to the full path if there's no basename (e.g. root "/").
        .unwrap_or_else(|| canonical.clone());

    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    // Idempotent on path: if this folder is already a workspace, return it as-is
    // rather than erroring — the user may just re-click the open button.
    let existing: Option<WorkspaceDto> = conn
        .query_row(
            "SELECT id, path, name, created_at, sort_order FROM workspaces WHERE path = ?1",
            params![canonical],
            |row| {
                Ok(WorkspaceDto {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    name: row.get(2)?,
                    created_at: row.get(3)?,
                    sort_order: row.get(4)?,
                })
            },
        )
        .ok();
    if let Some(existing) = existing {
        return Ok(existing);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM workspaces",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO workspaces (id, path, name, created_at, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, canonical, name, now, sort_order],
    )
    .map_err(|e| e.to_string())?;

    Ok(WorkspaceDto {
        id,
        path: canonical,
        name,
        created_at: now,
        sort_order,
    })
}

/// List all open workspaces ordered by their sidebar sort order.
#[tauri::command]
pub fn workspace_list(state: State<'_, AppState>) -> Result<Vec<WorkspaceDto>, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, path, name, created_at, sort_order FROM workspaces ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(WorkspaceDto {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            created_at: row.get(3)?,
            sort_order: row.get(4)?,
        })
    });
    let mut out = Vec::new();
    for r in rows.map_err(|e| e.to_string())? {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Remove a workspace AND every terminal grouped under it (cascading kill of
/// their live PTY sessions). Per the approved UX, closing a folder also closes
/// its terminals rather than orphaning them to the top-level list.
#[tauri::command]
pub fn workspace_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Gather this workspace's terminal ids first, then delete each through the
    // shared helper so their PTY sessions are killed. Done before the workspace
    // row is removed so the FK still resolves (ON DELETE SET NULL would otherwise
    // leave the terminal rows dangling at the top level).
    let child_ids: Vec<String> = {
        let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM terminals WHERE workspace_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r.map_err(|e| e.to_string())?);
        }
        ids
    };
    for term_id in child_ids {
        // A failed single-terminal delete shouldn't abort the whole cascade —
        // log and continue so the workspace row is still removed.
        if let Err(e) = delete_terminal_by_id(&state, &term_id) {
            log::error!("failed to delete terminal {term_id} during workspace cascade: {e}");
        }
    }
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Batch existence check for the folders backing each workspace. The frontend
/// polls this on a timer; any workspace whose folder no longer exists is shown
/// greyed-out and disabled (its terminals likewise). We do NOT auto-delete the
/// records here — deletion only happens when the user explicitly closes the row.
#[tauri::command]
pub fn workspace_check_paths(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<WorkspacePathStatusDto>, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let path: Option<String> = conn
            .query_row(
                "SELECT path FROM workspaces WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .ok();
        let exists = path
            .as_ref()
            .map(|p| Path::new(p).is_dir())
            .unwrap_or(false);
        out.push(WorkspacePathStatusDto { id, exists });
    }
    Ok(out)
}
