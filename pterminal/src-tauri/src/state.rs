use crate::db::DbPool;
use portable_pty::{Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

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
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(db: DbPool) -> Self {
        Self {
            db,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            http: crate::ai::client::build_client(),
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
