use crate::db::DbConn;
use crate::models::{
    LocalCompletionDto, LocalCompletionInput, PinTerminalInput, SetFontSizeInput,
    SpawnTerminalInput, TerminalDataPayload, TerminalDto, TerminalExitPayload,
};
use crate::state::{AppState, TerminalSession};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rusqlite::params;
use std::collections::HashSet;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::io::RawFd;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
const READ_BUF_SIZE: usize = 8 * 1024;
/// Coalesce PTY output before crossing the Tauri event boundary. A one-frame
/// window keeps interactive output feeling immediate while reducing IPC pressure
/// for commands that print many small chunks.
const OUTPUT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const OUTPUT_FLUSH_BYTES: usize = 64 * 1024;
/// How long `poll()` blocks waiting for PTY output before the reader thread
/// wakes up to re-check the cancellation flag (H6). 2s keeps the thread
/// responsive to `terminal_kill` without busy-spinning.
const READ_POLL_TIMEOUT_MS: libc::c_int = 2000;
const LOCAL_COMPLETION_LIMIT: usize = 12;
const SHELL_BUILTINS: &[&str] = &[
    "alias",
    "bg",
    "bindkey",
    "break",
    "builtin",
    "cd",
    "command",
    "compdef",
    "complete",
    "continue",
    "declare",
    "dirs",
    "disown",
    "echo",
    "eval",
    "exec",
    "exit",
    "export",
    "false",
    "fc",
    "fg",
    "getopts",
    "hash",
    "history",
    "jobs",
    "kill",
    "let",
    "local",
    "logout",
    "popd",
    "printf",
    "pushd",
    "pwd",
    "read",
    "readonly",
    "return",
    "set",
    "shift",
    "source",
    "test",
    "times",
    "trap",
    "true",
    "type",
    "typeset",
    "ulimit",
    "umask",
    "unalias",
    "unset",
    "wait",
    "which",
];

const COMMON_COMMANDS: &[&str] = &[
    "apt",
    "apt-get",
    "awk",
    "bash",
    "cat",
    "chmod",
    "chown",
    "cp",
    "curl",
    "df",
    "docker",
    "docker-compose",
    "du",
    "find",
    "grep",
    "head",
    "htop",
    "journalctl",
    "less",
    "ln",
    "ls",
    "mkdir",
    "mv",
    "nano",
    "netstat",
    "nginx",
    "ping",
    "ps",
    "python",
    "python3",
    "rm",
    "rsync",
    "scp",
    "sed",
    "service",
    "sh",
    "ssh",
    "sudo",
    "systemctl",
    "tail",
    "tar",
    "top",
    "touch",
    "tree",
    "ufw",
    "unzip",
    "vim",
    "wget",
    "which",
    "zip",
];

const GIT_SUBCOMMANDS: &[&str] = &[
    "add",
    "am",
    "bisect",
    "branch",
    "checkout",
    "cherry-pick",
    "clean",
    "clone",
    "commit",
    "diff",
    "fetch",
    "grep",
    "init",
    "log",
    "merge",
    "mv",
    "pull",
    "push",
    "rebase",
    "remote",
    "reset",
    "restore",
    "revert",
    "rm",
    "show",
    "stash",
    "status",
    "switch",
    "tag",
];

/// Spawn a new PTY-backed shell and persist its configuration to the database.
#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    input: SpawnTerminalInput,
) -> Result<TerminalDto, String> {
    let now = chrono::Utc::now().timestamp();

    // Restore vs create: if input.id is set, reuse an existing DB row so the
    // terminal re-attaches a live PTY after an app restart. Otherwise generate
    // a fresh id and insert a new record.
    // name/env_json/sort_order are used inside each branch (INSERT or PTY
    // setup) but not after; prefix with _ so the compiler doesn't warn. The
    // returned DTO comes from fetch_terminal, which re-reads all columns.
    let (id, _name, cwd, shell, _env_json, _sort_order): (String, String, String, String, Option<String>, i64) =
        if let Some(existing_id) = input.id.as_ref() {
            let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
            let (name, cwd, shell_opt, env, sort_order): (
                String, String, Option<String>, Option<String>, i64,
            ) = conn.query_row(
                "SELECT name, cwd, shell, env, sort_order FROM terminals WHERE id = ?1",
                params![existing_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
                .map_err(|e| format!("terminal {existing_id} not found: {e}"))?;
            let shell = shell_opt.filter(|s: &String| !s.trim().is_empty()).unwrap_or_else(|| {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
            });
            (existing_id.clone(), name, cwd, shell, env, sort_order)
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            let cwd = input.cwd.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
                std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
            });
            let shell = input.shell.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
            });
            let env_json = input.env.as_ref().map(|m| serde_json::to_string(m).unwrap_or_default());
            // Compute name + sort_order AND insert in a single transaction. This
            // serializes concurrent spawns (e.g. a rapid double-click firing two
            // terminal_spawn at once): each transaction sees the prior INSERT,
            // so MAX(sort_order) advances instead of two rows colliding on the
            // same name/sequence. Without this, two concurrent spawns both read
            // MAX=0 and both produce "Terminal 1".
            let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
            let (name, sort_order) = if let Some(explicit) = input.name.as_ref() {
                (explicit.clone(), next_sort_order(&state))
            } else {
                let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
                let seq: i64 = tx
                    .query_row(
                        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM terminals",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(1);
                let name = localized_terminal_name(&state, seq);
                tx.execute(
                    "INSERT INTO terminals (id, name, cwd, shell, env, created_at, updated_at, is_active, sort_order, is_pinned, pin_order)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1, ?7, 0, 0)",
                    params![id, name, cwd, shell, env_json, now, seq],
                )
                .map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
                (name, seq)
            };
            // If a name was explicitly supplied, we still need to INSERT (the
            // auto-name branch above did it inside the transaction).
            if input.name.is_some() {
                conn.execute(
                    "INSERT INTO terminals (id, name, cwd, shell, env, created_at, updated_at, is_active, sort_order, is_pinned, pin_order)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1, ?7, 0, 0)",
                    params![id, name, cwd, shell, env_json, now, sort_order],
                )
                .map_err(|e| e.to_string())?;
            }
            (id, name, cwd, shell, env_json, sort_order)
        };

    // Build the shell command with a sane environment.
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Ensure the shell's line editor uses a UTF-8 locale so multi-byte input
    // (e.g. dragged non-ASCII filenames) is assembled correctly instead of
    // being misread as separate keystrokes. Only set when the parent process
    // didn't already provide one, so user/system prefs win. Placed before the
    // `input.env` loop so a terminal's explicit env (including LANG) overrides.
    if std::env::var("LANG").is_err() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if std::env::var("LC_CTYPE").is_err() {
        cmd.env("LC_CTYPE", "en_US.UTF-8");
    }

    // Inject SOCKS proxy env vars so CLI tools (curl, wget, git, etc.) in the
    // terminal also use the configured proxy. Only when apply_http is enabled.
    let proxy_cfg = crate::ai::client::load_proxy_config(&state.db);
    if let Some(ref socks_url) = proxy_cfg.socks_url {
        if proxy_cfg.apply_http {
            cmd.env("http_proxy", socks_url);
            cmd.env("https_proxy", socks_url);
            cmd.env("all_proxy", socks_url);
            // Uppercase variants (some tools check these)
            cmd.env("HTTP_PROXY", socks_url);
            cmd.env("HTTPS_PROXY", socks_url);
            cmd.env("ALL_PROXY", socks_url);
        }
    }

    if let Some(env_map) = &input.env {
        for (k, v) in env_map {
            cmd.env(k, v);
        }
    }

    let size = PtySize {
        rows: input.rows.unwrap_or(DEFAULT_ROWS),
        cols: input.cols.unwrap_or(DEFAULT_COLS),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pty = native_pty_system();
    let pair = pty
        .openpty(size)
        .map_err(|e| format!("openpty failed: {e}"))?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell failed: {e}"))?;

    // Drop slave so EOF propagates when the child exits.
    drop(pair.slave);

    // `take_writer()` can only be called once per master; take it before
    // moving the master into the session.
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    // Reader is an independent clone from the master.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;

    // Independent fd used only to `poll()` for readability inside the reader
    // thread (H6). It's a dup of the master fd, so POLLIN on it mirrors data
    // available to `reader.read()`, but it lives only for the lifetime of the
    // reader thread — closing it when the thread exits never affects the
    // session's master fd. This decouples poll-waiting from master ownership.
    let poll_fd: RawFd = pair
        .master
        .as_raw_fd()
        .ok_or_else(|| "pty master has no raw fd".to_string())?;
    let reader_cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let session = TerminalSession {
        id: id.clone(),
        master: pair.master,
        writer,
        child,
        cwd: std::path::PathBuf::from(&cwd),
        size,
        reader_cancel: reader_cancel.clone(),
    };
    state.insert_session(session);

    // Spawn the reader thread that forwards PTY output to the frontend.
    let app_handle = app.clone();
    let term_id = id.clone();
    // Clone the AppState so the reader thread can remove the session from the
    // map when the child exits naturally (otherwise the TerminalSession —
    // master/writer/child handles — leaks in `sessions` forever and
    // `terminal_has_session` keeps reporting true for a dead terminal).
    let state_for_thread = state.inner().clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; READ_BUF_SIZE];
        // Carry-over buffer for UTF-8 multi-byte sequences that span read
        // boundaries. Without this, a multi-byte char (CJK, emoji) split
        // across two reads would be corrupted into replacement characters.
        let mut leftover: Vec<u8> = Vec::new();
        let mut pending_output = String::new();
        let mut output_deadline: Option<Instant> = None;
        // dup the poll fd into the thread's ownership so closing it on exit
        // never touches the session's master fd.
        let owned_poll_fd = unsafe { libc::dup(poll_fd) };
        let poll_fd_valid = owned_poll_fd >= 0;
        let mut pollfds = [libc::pollfd {
            fd: if poll_fd_valid { owned_poll_fd } else { -1 },
            events: libc::POLLIN,
            revents: 0,
        }];
        loop {
            // Check cancellation first — a kill sets this flag and we want to
            // exit within one poll cycle even if the child is hung.
            if reader_cancel.load(Ordering::Acquire) {
                emit_terminal_data(&app_handle, &term_id, &mut pending_output);
                break;
            }
            if output_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                emit_terminal_data(&app_handle, &term_id, &mut pending_output);
                output_deadline = None;
                continue;
            }
            // Wait up to READ_POLL_TIMEOUT_MS for output, then loop back so the
            // cancel check runs periodically. This replaces the old indefinite
            // `reader.read()` block that could wedge the thread forever when a
            // child process hung without exiting.
            let timeout = poll_timeout_until(output_deadline);
            let nready = unsafe { libc::poll(pollfds.as_mut_ptr(), 1, timeout) };
            if nready < 0 {
                let e = std::io::Error::last_os_error();
                // EINTR just means a signal interrupted poll — retry the loop.
                if e.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                break;
            }
            if nready == 0 {
                // Timed out with no data; flush a queued output batch if this
                // was the short coalescing deadline, then re-check cancellation.
                if !pending_output.is_empty() {
                    emit_terminal_data(&app_handle, &term_id, &mut pending_output);
                    output_deadline = None;
                }
                continue;
            }
            // poll reported readable (POLLIN) or hangup (POLLHUP). On POLLHUP
            // the child has exited — read will return Ok(0) / EOF shortly.
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    leftover.extend_from_slice(&buf[..n]);
                    // Find the last complete UTF-8 boundary.
                    let complete_len = utf8_safe_boundary(&leftover);
                    let (ready, rest) = leftover.split_at(complete_len);
                    let data = String::from_utf8_lossy(ready).into_owned();
                    if !data.is_empty() {
                        if pending_output.is_empty() {
                            output_deadline = Some(Instant::now() + OUTPUT_FLUSH_INTERVAL);
                        }
                        pending_output.push_str(&data);
                        if pending_output.len() >= OUTPUT_FLUSH_BYTES {
                            emit_terminal_data(&app_handle, &term_id, &mut pending_output);
                            output_deadline = None;
                        }
                    }
                    leftover = rest.to_vec();
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        // Close the dup'd poll fd owned by this thread.
        if poll_fd_valid {
            unsafe { libc::close(owned_poll_fd) };
        }
        // Flush any remaining bytes at EOF.
        if !leftover.is_empty() {
            let data = String::from_utf8_lossy(&leftover).into_owned();
            if !data.is_empty() {
                pending_output.push_str(&data);
            }
        }
        emit_terminal_data(&app_handle, &term_id, &mut pending_output);
        // Child has exited (EOF on master reader). Emit before removing the
        // session so the frontend's `terminal-exit` handler (which calls
        // `terminal_delete`) can still find/identify the terminal.
        let _ = app_handle.emit(
            "terminal-exit",
            TerminalExitPayload {
                id: term_id.clone(),
                exit_code: None,
            },
        );
        // Drop our handle to the session from the map so the master/writer/
        // child resources are released. `remove_session` returns None when
        // `terminal_delete` already removed it (manual delete path), in which
        // case there's nothing to clean — the Arc is already gone.
        state_for_thread.remove_session(&term_id);
    });

    // Mark this terminal active (so list reflects the focused one) and return
    // the full row via fetch_terminal — this preserves is_pinned/pin_order and
    // the original created_at/updated_at, which a hand-built DTO would lose
    // (restored terminals kept their pinned state across app restarts).
    {
        let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE terminals SET is_active = 1, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    fetch_terminal(&state, &id)
}

/// Write keyboard input to a terminal's PTY.
#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let session_arc = state
        .get_session(&id)
        .ok_or_else(|| format!("terminal {id} not found"))?;

    // Write to PTY so the shell reacts immediately.
    {
        use std::io::Write;
        let mut session = session_arc.lock().unwrap_or_else(|poisoned| {
            // Mutex was poisoned (a thread panicked while holding the lock).
            // Recover by taking the inner data rather than propagating the
            // panic, which would crash the whole app on the next access.
            log::error!("terminal session mutex poisoned, recovering");
            poisoned.into_inner()
        });
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        let _ = session.writer.flush();
    }

    Ok(())
}

/// Fast local autocomplete that does not call the AI model and does not write to
/// the active PTY. This intentionally mirrors the first layer of shell Tab
/// completion: executable names, shell builtins, a few high-value subcommands,
/// and filesystem paths.
#[tauri::command]
pub fn terminal_local_completions(
    state: State<'_, AppState>,
    input: LocalCompletionInput,
) -> Result<Vec<LocalCompletionDto>, String> {
    let cwd = terminal_cwd(&state, &input.terminal_id);
    let parsed = ParsedInput::new(&input.partial_cmd);
    let limit = input
        .limit
        .map(|n| n.max(1).min(LOCAL_COMPLETION_LIMIT))
        .unwrap_or(LOCAL_COMPLETION_LIMIT);

    let mut out: Vec<LocalCompletionDto> = Vec::new();
    let command_paths = completion_path_dirs(&state);

    if parsed.is_command_position {
        collect_command_name_completions(&parsed, limit, &command_paths, &mut out);
        collect_path_completions(&parsed, &cwd, true, limit, &mut out);
    } else {
        collect_git_completions(&parsed, limit, &mut out);
        collect_path_completions(&parsed, &cwd, false, limit, &mut out);
    }

    dedupe_and_rank(out, limit)
}

/// Resize a terminal's PTY.
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Reject degenerate sizes (e.g. a hidden display:none container reporting
    // 0). Resizing a shell to 1 row confuses its redraw and pollutes the view.
    if cols < 2 || rows < 1 {
        return Ok(());
    }
    let session_arc = state
        .get_session(&id)
        .ok_or_else(|| format!("terminal {id} not found"))?;
    let mut session = session_arc.lock().unwrap_or_else(|poisoned| {
        log::error!("terminal session mutex poisoned, recovering");
        poisoned.into_inner()
    });
    session.resize(cols, rows);
    Ok(())
}

/// Kill a terminal session, terminating the shell child process.
#[tauri::command]
pub fn terminal_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(session_arc) = state.remove_session(&id) {
        let mut session = session_arc.lock().unwrap_or_else(|poisoned| {
            // Mutex was poisoned (a thread panicked while holding the lock).
            // Recover by taking the inner data rather than propagating the
            // panic, which would crash the whole app on the next access.
            log::error!("terminal session mutex poisoned, recovering");
            poisoned.into_inner()
        });
        // Signal the reader thread to exit its poll loop, then kill the child.
        // Order matters: set the flag first so a hung child (kill fails or it's
        // in D state) still lets the reader unblock within one poll cycle (H6).
        session.reader_cancel.store(true, Ordering::Release);
        let _ = session.child.kill();
    }
    Ok(())
}

/// Whether a live PTY session exists for the given terminal id.
#[tauri::command]
pub fn terminal_has_session(state: State<'_, AppState>, id: String) -> bool {
    state.get_session(&id).is_some()
}

/// List all persisted terminal configurations ordered by `sort_order`.
#[tauri::command]
pub fn terminal_list(state: State<'_, AppState>) -> Result<Vec<TerminalDto>, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, cwd, shell, env, created_at, updated_at, is_active, sort_order, is_pinned, pin_order, font_size
             FROM terminals ORDER BY is_pinned DESC, pin_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TerminalDto {
                id: row.get(0)?,
                name: row.get(1)?,
                cwd: row.get(2)?,
                shell: row.get(3)?,
                env: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                is_active: row.get::<_, i64>(7)? != 0,
                sort_order: row.get(8)?,
                is_pinned: row.get::<_, i64>(9)? != 0,
                pin_order: row.get(10)?,
                font_size: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Update a terminal's metadata (name/cwd).
#[tauri::command]
pub fn terminal_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    cwd: Option<String>,
) -> Result<TerminalDto, String> {
    let now = chrono::Utc::now().timestamp();
    {
        let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
        // Single atomic UPDATE: only the provided fields are touched, and a
        // failure can't leave the row half-updated.
        let mut sets: Vec<&str> = Vec::new();
        let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
        if let Some(n) = &name {
            sets.push("name = ?");
            params.push(n);
        }
        if let Some(c) = &cwd {
            sets.push("cwd = ?");
            params.push(c);
        }
        sets.push("updated_at = ?");
        params.push(&now);
        params.push(&id);

        let sql = format!("UPDATE terminals SET {} WHERE id = ?", sets.join(", "));
        conn.execute(&sql, params.as_slice())
            .map_err(|e| e.to_string())?;
    }
    fetch_terminal(&state, &id)
}

/// Delete a terminal configuration (and kill any live session).
#[tauri::command]
pub fn terminal_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(session_arc) = state.remove_session(&id) {
        let mut session = session_arc.lock().unwrap_or_else(|poisoned| {
            // Mutex was poisoned (a thread panicked while holding the lock).
            // Recover by taking the inner data rather than propagating the
            // panic, which would crash the whole app on the next access.
            log::error!("terminal session mutex poisoned, recovering");
            poisoned.into_inner()
        });
        // Signal the reader thread to exit its poll loop, then kill the child.
        // Order matters: set the flag first so a hung child (kill fails or it's
        // in D state) still lets the reader unblock within one poll cycle (H6).
        session.reader_cancel.store(true, Ordering::Release);
        let _ = session.child.kill();
    }
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    // Associated rows (commands, ai_messages) are removed by ON DELETE CASCADE
    // on the foreign keys. This relies on `PRAGMA foreign_keys = ON` being set
    // per-connection (see db.rs init_pool); if that pragma were ever dropped,
    // these would become orphaned.
    conn.execute("DELETE FROM terminals WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggle a terminal's pinned state. Pinning assigns the next available
/// `pin_order` so newly pinned entries sort to the bottom of the pinned group.
#[tauri::command]
pub fn terminal_pin(
    state: State<'_, AppState>,
    input: PinTerminalInput,
) -> Result<TerminalDto, String> {
    let now = chrono::Utc::now().timestamp();
    {
        let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
        if input.is_pinned {
            let next: i64 = conn
                .query_row("SELECT COALESCE(MAX(pin_order), -1) + 1 FROM terminals WHERE is_pinned = 1", [], |r| {
                    r.get(0)
                })
                .unwrap_or(0);
            conn.execute(
                "UPDATE terminals SET is_pinned = 1, pin_order = ?1, updated_at = ?2 WHERE id = ?3",
                params![next, now, input.id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE terminals SET is_pinned = 0, pin_order = 0, updated_at = ?1 WHERE id = ?2",
                params![now, input.id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    fetch_terminal(&state, &input.id)
}

/// Set (or clear) a terminal's per-terminal font size override.
/// `font_size = None` clears the override so the terminal follows the global
/// default; a positive value pins a specific size for this terminal only.
#[tauri::command]
pub fn terminal_set_font_size(
    state: State<'_, AppState>,
    input: SetFontSizeInput,
) -> Result<TerminalDto, String> {
    let now = chrono::Utc::now().timestamp();
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE terminals SET font_size = ?1, updated_at = ?2 WHERE id = ?3",
        params![input.font_size, now, input.id],
    )
    .map_err(|e| e.to_string())?;
    fetch_terminal(&state, &input.id)
}

// ---- helpers ---------------------------------------------------------------

fn fetch_terminal(state: &AppState, id: &str) -> Result<TerminalDto, String> {
    let conn: DbConn = state.db.get().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, name, cwd, shell, env, created_at, updated_at, is_active, sort_order, is_pinned, pin_order, font_size
         FROM terminals WHERE id = ?1",
        params![id],
        |row| {
            Ok(TerminalDto {
                id: row.get(0)?,
                name: row.get(1)?,
                cwd: row.get(2)?,
                shell: row.get(3)?,
                env: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                is_active: row.get::<_, i64>(7)? != 0,
                sort_order: row.get(8)?,
                is_pinned: row.get::<_, i64>(9)? != 0,
                pin_order: row.get(10)?,
                font_size: row.get(11)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn terminal_cwd(state: &AppState, terminal_id: &str) -> String {
    state
        .db
        .get()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT cwd FROM terminals WHERE id = ?1",
                params![terminal_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .filter(|cwd| !cwd.trim().is_empty())
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/".to_string()))
}

fn completion_path_dirs(state: &AppState) -> Vec<PathBuf> {
    if let Ok(cache) = state.shell_path_cache.lock() {
        if let Some(paths) = cache.as_ref() {
            return paths.clone();
        }
    }

    let paths = resolve_login_shell_path().unwrap_or_else(env_path_dirs);
    match state.shell_path_cache.lock() {
        Ok(mut cache) => *cache = Some(paths.clone()),
        Err(poisoned) => {
            log::error!("shell PATH cache lock poisoned — recovering");
            *poisoned.into_inner() = Some(paths.clone());
        }
    }
    paths
}

fn resolve_login_shell_path() -> Option<Vec<PathBuf>> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(shell)
        .arg("-lic")
        .arg("printf '%s' \"$PATH\"")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?;
    let dirs: Vec<PathBuf> = std::env::split_paths(path.trim()).collect();
    if dirs.is_empty() {
        None
    } else {
        Some(dirs)
    }
}

fn env_path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default()
}

#[derive(Debug)]
struct ParsedInput<'a> {
    original: &'a str,
    token_start: usize,
    current_token: &'a str,
    command: &'a str,
    arg_index: usize,
    is_command_position: bool,
}

impl<'a> ParsedInput<'a> {
    fn new(original: &'a str) -> Self {
        let token_start = current_token_start(original);
        let current_token = &original[token_start..];
        let before_token = &original[..token_start];
        let trimmed = original.trim_start();
        let mut parts = trimmed.split_whitespace();
        let command = parts.next().unwrap_or("");
        let token_count = if trimmed.is_empty() {
            0
        } else {
            trimmed.split_whitespace().count()
        };
        let ends_with_space = original.chars().last().is_some_and(char::is_whitespace);
        let arg_index = if command.is_empty() {
            0
        } else if ends_with_space {
            token_count
        } else {
            token_count.saturating_sub(1)
        };

        Self {
            original,
            token_start,
            current_token,
            command,
            arg_index,
            is_command_position: before_token.trim().is_empty(),
        }
    }

    fn replace_current_token(&self, replacement: &str) -> String {
        format!("{}{}", &self.original[..self.token_start], replacement)
    }
}

fn current_token_start(s: &str) -> usize {
    if s.is_empty() {
        return 0;
    }

    let mut token_start = 0;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (idx, ch) in s.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            continue;
        }
        if ch.is_whitespace() {
            token_start = idx + ch.len_utf8();
        }
    }
    token_start
}

fn collect_command_name_completions(
    parsed: &ParsedInput<'_>,
    limit: usize,
    path_dirs: &[PathBuf],
    out: &mut Vec<LocalCompletionDto>,
) {
    let prefix = parsed.current_token;
    if prefix.is_empty() || prefix.contains('/') || prefix.starts_with('-') {
        return;
    }

    for name in SHELL_BUILTINS.iter().copied() {
        if name.starts_with(prefix) {
            push_completion(out, parsed.replace_current_token(name), "command", "builtin", 92);
        }
    }

    for name in COMMON_COMMANDS.iter().copied() {
        if name.starts_with(prefix) {
            push_completion(out, parsed.replace_current_token(name), "command", "common", 78);
        }
    }

    for dir in path_dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if out.len() >= limit * 4 {
                return;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with(prefix) {
                continue;
            }
            if !is_executable_file(&entry.path()) {
                continue;
            }
            push_completion(out, parsed.replace_current_token(&name), "command", "path", 84);
        }
    }
}

fn collect_git_completions(parsed: &ParsedInput<'_>, limit: usize, out: &mut Vec<LocalCompletionDto>) {
    if parsed.command != "git" || parsed.arg_index != 1 {
        return;
    }
    let prefix = parsed.current_token;
    for sub in GIT_SUBCOMMANDS.iter().copied() {
        if out.len() >= limit * 3 {
            return;
        }
        if sub.starts_with(prefix) {
            push_completion(
                out,
                parsed.replace_current_token(sub),
                "subcommand",
                "git",
                88,
            );
        }
    }
}

fn collect_path_completions(
    parsed: &ParsedInput<'_>,
    cwd: &str,
    executable_only: bool,
    limit: usize,
    out: &mut Vec<LocalCompletionDto>,
) {
    let token = parsed.current_token;
    if executable_only && !token.contains('/') {
        return;
    }

    let (dir_part, name_prefix) = split_path_token(token);
    let search_dir = resolve_completion_dir(cwd, dir_part);
    let Ok(entries) = std::fs::read_dir(&search_dir) else {
        return;
    };

    for entry in entries.flatten() {
        if out.len() >= limit * 4 {
            return;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let is_dir = file_type.is_dir();
        if executable_only && !is_dir && !is_executable_file(&path) {
            continue;
        }

        let raw_name = entry.file_name().to_string_lossy().to_string();
        if raw_name.starts_with('.') && !name_prefix.starts_with('.') {
            continue;
        }
        if !raw_name.starts_with(name_prefix) {
            continue;
        }

        let mut replacement = String::new();
        replacement.push_str(dir_part);
        replacement.push_str(&escape_shell_token_fragment(&raw_name));
        if is_dir {
            replacement.push('/');
        }

        push_completion(
            out,
            parsed.replace_current_token(&replacement),
            if is_dir { "directory" } else { "path" },
            if executable_only { "path-command" } else { "filesystem" },
            if executable_only { 80 } else if is_dir { 74 } else { 68 },
        );
    }
}

fn split_path_token(token: &str) -> (&str, &str) {
    match token.rfind('/') {
        Some(idx) => (&token[..=idx], &token[idx + 1..]),
        None => ("", token),
    }
}

fn resolve_completion_dir(cwd: &str, dir_part: &str) -> PathBuf {
    let unescaped = unescape_shell_token_fragment(dir_part);
    if unescaped.starts_with("~/") || unescaped == "~" {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        let rest = unescaped.trim_start_matches('~').trim_start_matches('/');
        return Path::new(&home).join(rest);
    }
    let path = PathBuf::from(&unescaped);
    if path.is_absolute() {
        path
    } else {
        Path::new(cwd).join(path)
    }
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    meta.is_file() && (meta.permissions().mode() & 0o111 != 0)
}

fn escape_shell_token_fragment(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        match ch {
            ' ' | '\\' | '\'' | '"' | '`' | '$' | '&' | '|' | ';' | '<' | '>' | '(' | ')' | '['
            | ']' | '{' | '}' | '*' | '?' | '!' | '#' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

fn unescape_shell_token_fragment(s: &str) -> String {
    let mut out = String::new();
    let mut escaped = false;
    for ch in s.chars() {
        if escaped {
            out.push(ch);
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else {
            out.push(ch);
        }
    }
    if escaped {
        out.push('\\');
    }
    out
}

fn push_completion(
    out: &mut Vec<LocalCompletionDto>,
    text: String,
    kind: &str,
    source: &str,
    score: i64,
) {
    out.push(LocalCompletionDto {
        text,
        kind: kind.to_string(),
        source: source.to_string(),
        score,
    });
}

fn dedupe_and_rank(
    mut items: Vec<LocalCompletionDto>,
    limit: usize,
) -> Result<Vec<LocalCompletionDto>, String> {
    items.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.text.len().cmp(&b.text.len()))
            .then_with(|| a.text.cmp(&b.text))
    });

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        if seen.insert(item.text.clone()) {
            out.push(item);
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

fn next_sort_order(state: &AppState) -> i64 {
    let conn = match state.db.get() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    conn.query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM terminals", [], |r| {
        r.get(0)
    })
    .unwrap_or(0)
}

/// Build the default name for a newly-created terminal, localized to the saved
/// UI language. Falls back to English ("Terminal N") when no language is set
/// ("follow system") or on any read error — the frontend's `detectSystemLocale`
/// can't be consulted from Rust, so an explicit Chinese choice is required to
/// get "终端 N".
fn localized_terminal_name(state: &AppState, seq: i64) -> String {
    let lang = state
        .db
        .get()
        .ok()
        .and_then(|c| {
            c.query_row(
                "SELECT value FROM settings WHERE key = 'ui_language'",
                [],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
        });
    match lang.as_deref() {
        Some("zh-CN") => format!("终端 {seq}"),
        // English is the default/fallback (includes "follow system").
        _ => format!("Terminal {seq}"),
    }
}

fn poll_timeout_until(deadline: Option<Instant>) -> libc::c_int {
    let Some(deadline) = deadline else {
        return READ_POLL_TIMEOUT_MS;
    };
    let now = Instant::now();
    if deadline <= now {
        return 0;
    }
    let ms = deadline.duration_since(now).as_millis();
    ms.min(READ_POLL_TIMEOUT_MS as u128).max(1) as libc::c_int
}

fn emit_terminal_data(app: &AppHandle, term_id: &str, pending: &mut String) {
    if pending.is_empty() {
        return;
    }
    let data = std::mem::take(pending);
    let _ = app.emit(
        "terminal-data",
        TerminalDataPayload {
            id: term_id.to_string(),
            data,
        },
    );
}

/// Return the length of the longest complete UTF-8 prefix of `bytes`.
/// Trailing bytes of a multi-byte sequence that runs past the end are left for
/// the next read so a char split across reads isn't corrupted.
fn utf8_safe_boundary(bytes: &[u8]) -> usize {
    let len = bytes.len();
    if len == 0 {
        return 0;
    }
    // Walk backward at most 3 bytes to find a leading byte.
    let start = if len >= 4 { len - 4 } else { 0 };
    for i in (start..len).rev() {
        let b = bytes[i];
        // Leading byte: 0xxxxxxx (1-byte) or 11xxxxxx (start of multi-byte).
        if b < 0x80 || b >= 0xc0 {
            // Expected length of the sequence starting here.
            let need = if b < 0x80 {
                1
            } else if b < 0xe0 {
                2
            } else if b < 0xf0 {
                3
            } else {
                4
            };
            let have = len - i;
            if have >= need {
                // This sequence is complete; everything up to `len` is safe.
                return len;
            } else {
                // Incomplete multi-byte sequence at the tail — cut here.
                return i;
            }
        }
    }
    // All trailing bytes are continuation bytes (no leading byte found in the
    // window) — treat nothing as complete to avoid mid-sequence cuts.
    0
}
