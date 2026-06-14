use anyhow::{Context, Result};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Build a configured SQLite connection pool rooted at `db_path`.
pub fn init_pool<P: AsRef<Path>>(db_path: P) -> Result<DbPool> {
    if let Some(parent) = db_path.as_ref().parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create db dir {:?}", parent))?;
    }

    // WAL is a database-level setting that requires a write lock; configure it
    // once on a dedicated connection BEFORE building the pool, so per-connection
    // initialization never competes for the lock.
    {
        let conn = rusqlite::Connection::open(&db_path)
            .with_context(|| format!("open db to set WAL {:?}", db_path.as_ref()))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
    }

    // Per-connection init only sets connection-local pragmas (safe, no locking).
    let manager = SqliteConnectionManager::file(db_path).with_init(|c| {
        c.execute_batch(
            "PRAGMA foreign_keys = ON; \
             PRAGMA synchronous = NORMAL;",
        )
    });

    let pool = Pool::builder()
        .max_size(8)
        .build(manager)
        .context("failed to build SQLite pool")?;

    run_migrations(&pool)?;
    Ok(pool)
}

/// Apply schema migrations. Idempotent — safe to run on every startup.
fn run_migrations(pool: &DbPool) -> Result<()> {
    let conn = pool.get().context("acquire migration connection")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        );",
    )
    .context("create schema_version table")?;

    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // Each entry is (version, sql). Applied in order when version > current.
    let migrations: &[(i64, &str)] = &[
        (
            1,
            "CREATE TABLE IF NOT EXISTS terminals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                cwd TEXT NOT NULL,
                shell TEXT,
                env TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_terminals_sort ON terminals(sort_order);

            CREATE TABLE IF NOT EXISTS commands (
                id TEXT PRIMARY KEY,
                terminal_id TEXT,
                label TEXT NOT NULL,
                command TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                pin_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_commands_terminal ON commands(terminal_id);

            CREATE TABLE IF NOT EXISTS command_history (
                id TEXT PRIMARY KEY,
                terminal_id TEXT NOT NULL,
                command TEXT NOT NULL,
                executed_at INTEGER NOT NULL,
                exit_code INTEGER,
                FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_history_terminal ON command_history(terminal_id, executed_at);

            CREATE TABLE IF NOT EXISTS ai_messages (
                id TEXT PRIMARY KEY,
                terminal_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                message_type TEXT,
                metadata TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_ai_messages_terminal ON ai_messages(terminal_id, created_at);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );",
        ),
        (
            2,
            "CREATE TABLE IF NOT EXISTS ssh_shortcuts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                user TEXT NOT NULL,
                identity_file TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        ),
        // Add pin support to terminals so the sidebar can promote entries.
        // ADD COLUMN with a DEFAULT is safe on existing rows (back-fills 0).
        (
            3,
            "ALTER TABLE terminals ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE terminals ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;",
        ),
        // Add an optional password column to SSH shortcuts. Stored in plaintext
        // (see docs/decisions: accepted trade-off for internal/test hosts).
        (
            4,
            "ALTER TABLE ssh_shortcuts ADD COLUMN password TEXT;",
        ),
        // Command history feature was removed; drop its table + index. Safe to
        // re-run via IF EXISTS (no-op on fresh installs that never had it).
        (
            5,
            "DROP TABLE IF EXISTS command_history;
             DROP INDEX IF EXISTS idx_history_terminal;",
        ),
        // Purge orphaned empty assistant placeholders. These are written before
        // an AI stream starts; if the task was cancelled or crashed mid-stream,
        // the row stayed empty and would render as a blank chat bubble.
        (
            6,
            "DELETE FROM ai_messages WHERE role = 'assistant' AND content = '';",
        ),
        // Per-terminal font size. NULL means "use the global default" — existing
        // terminals keep behaving as before until the user zooms them individually.
        (
            7,
            "ALTER TABLE terminals ADD COLUMN font_size INTEGER;",
        ),
    ];

    for (version, sql) in migrations.iter() {
        if *version > current {
            // `unchecked_transaction` is intentional here: migrations run once
            // during pool init on a dedicated connection (no concurrency, no
            // prior poisoned lock possible). SQLite supports transactional DDL,
            // so each migration applies atomically. Using a checked transaction
            // would add nothing since there's no prior lock state to honor.
            let tx = conn.unchecked_transaction().context("begin migration tx")?;
            tx.execute_batch(sql)
                .with_context(|| format!("apply migration v{}", version))?;
            tx.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                rusqlite::params![version],
            )?;
            tx.commit().context("commit migration")?;
            log::info!("Applied DB migration v{}", version);
        }
    }

    Ok(())
}
