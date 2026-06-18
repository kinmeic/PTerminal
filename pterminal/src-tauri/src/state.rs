use crate::ai::client::{self, ProxyConfig};
use crate::db::DbPool;
use portable_pty::{Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;

/// A live terminal session backed by a real PTY.
#[allow(dead_code)]
pub struct TerminalSession {
    pub id: String,
    /// PTY master handle; used for resize and to obtain a reader.
    pub master: Box<dyn MasterPty + Send>,
    /// Writer half of the PTY (keyboard input → shell). Obtained once via
    /// `master.take_writer()`; writing flushes input to the child process.
    pub writer: Box<dyn std::io::Write + Send>,
    /// The spawned shell child process handle.
    pub child: Box<dyn Child + Send + Sync>,
    pub cwd: PathBuf,
    pub size: PtySize,
    /// Cancellation flag shared with the reader thread. Set by `terminal_kill`
    /// / `terminal_delete` so a reader blocked in `poll()` returns within
    /// `READ_POLL_TIMEOUT_MS` even if the child process hangs instead of
    /// exiting (H6: prevents the reader thread from leaking forever).
    pub reader_cancel: Arc<AtomicBool>,
}

impl TerminalSession {
    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let _ = self.master.resize(self.size);
    }
}

/// Mutable application state shared across Tauri commands.
#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    /// Sessions map keyed by terminal id. We use `RwLock` here (with each value
    /// individually wrapped in `Mutex`) so reads (`get_session`) — which happen
    /// on every keystroke via `terminal_write` — run concurrently, while writes
    /// (`insert_session` / `remove_session`) are rare (only on terminal
    /// create/delete). Write contention with reads is therefore negligible in
    /// this single-user desktop app.
    ///
    /// We do NOT downgrade a write lock to a read lock (std `RwLockWriteGuard`
    /// has no stable `downgrade`), but that's fine: the write paths are tiny
    /// (a single HashMap insert/remove) and release the lock in microseconds.
    pub sessions: Arc<RwLock<HashMap<String, Arc<Mutex<TerminalSession>>>>>,
    /// Shared HTTP client for AI requests. reqwest::Client is cheap to clone
    /// (internal Arc) and reuses connection pools / TLS sessions, so we build
    /// one per app lifetime instead of per request.
    ///
    /// Wrapped in `RwLock` so the user can change SOCKS proxy settings at
    /// runtime (`rebuild_http`) and swap the client without restarting the
    /// app. In-flight requests keep using the old client (it's internally
    /// `Arc`-refcounted); new requests pick up the new one.
    pub http: Arc<RwLock<reqwest::Client>>,
    /// Cancellation tokens for in-flight AI streams, keyed by request_id
    /// (supplied by the frontend). The frontend calls `ai_cancel(requestId)`
    /// to abort a running stream; `run_stream` inserts on start and removes on
    /// completion. Standard Mutex (not RwLock): insert/remove/cancel are all
    /// short write ops, and a stream never reads another stream's token.
    pub cancels: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// PATH entries resolved from the user's login shell. GUI apps often start
    /// with a thin launchd PATH that misses nvm/pyenv/homebrew additions.
    pub shell_path_cache: Arc<Mutex<Option<Vec<PathBuf>>>>,
}

impl AppState {
    pub fn new(db: DbPool) -> Self {
        let proxy = client::load_proxy_config(&db);
        Self {
            db,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            http: Arc::new(RwLock::new(client::build_client(&proxy))),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            shell_path_cache: Arc::new(Mutex::new(None)),
        }
    }

    /// Rebuild the HTTP client from the current proxy settings in the DB and
    /// swap it in atomically. Called by the `proxy_reload` command after the
    /// frontend persists new SOCKS settings. In-flight requests keep using the
    /// previous client (it is `Arc`-shared by the requests holding it); new
    /// requests pick up the rebuilt one on the next clone.
    pub fn rebuild_http(&self, proxy: &ProxyConfig) {
        let new_client = client::build_client(proxy);
        match self.http.write() {
            Ok(mut guard) => *guard = new_client,
            Err(poisoned) => {
                log::error!("http lock poisoned — recovering");
                *poisoned.into_inner() = new_client;
            }
        }
    }

    /// Acquire a write lock on the sessions map, recovering from poison.
    /// A poisoned lock means some thread panicked while holding it; the data
    /// may be inconsistent, but crashing the whole app on the next keystroke is
    /// worse than continuing with best-effort recovery. We log and proceed.
    pub fn write_sessions(&self) -> std::sync::RwLockWriteGuard<'_, HashMap<String, Arc<Mutex<TerminalSession>>>> {
        match self.sessions.write() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::error!("sessions write lock poisoned — recovering with possibly inconsistent data");
                poisoned.into_inner()
            }
        }
    }

    /// Acquire a read lock on the sessions map, recovering from poison.
    pub fn read_sessions(&self) -> std::sync::RwLockReadGuard<'_, HashMap<String, Arc<Mutex<TerminalSession>>>> {
        match self.sessions.read() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::error!("sessions read lock poisoned — recovering with possibly inconsistent data");
                poisoned.into_inner()
            }
        }
    }

    pub fn insert_session(&self, session: TerminalSession) {
        let id = session.id.clone();
        let arc = Arc::new(Mutex::new(session));
        self.write_sessions().insert(id, arc);
    }

    pub fn remove_session(&self, id: &str) -> Option<Arc<Mutex<TerminalSession>>> {
        self.write_sessions().remove(id)
    }

    pub fn get_session(&self, id: &str) -> Option<Arc<Mutex<TerminalSession>>> {
        self.read_sessions().get(id).cloned()
    }
}
