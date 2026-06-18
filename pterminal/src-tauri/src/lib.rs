mod ai;
mod commands;
mod db;
mod models;
mod state;

use state::AppState;
use tauri::Manager;

/// Resolve the SQLite database path inside the app's data directory.
fn resolve_db_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&dir).ok();
    dir.join("pterminal.db")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let db_path = resolve_db_path(&app.handle());
            let pool = db::init_pool(&db_path)
                .expect("failed to initialize SQLite database");
            log::info!("SQLite initialized at {:?}", db_path);

            // AppState is Clone and uses internal RwLock/Arc for mutation,
            // so it satisfies Tauri's `Send + Sync` requirement directly.
            let app_state = AppState::new(pool);
            app.manage(app_state);

            Ok(())
        })
        // 红绿灯关闭按钮 → 隐藏到 Dock，保持进程运行（需求 1）。Tauri 默认在
        // 最后一个窗口关闭时退出；这里阻止关闭改为隐藏，点击 Dock 图标即可恢复。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::terminal::terminal_spawn,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
            commands::terminal::terminal_has_session,
            commands::terminal::terminal_list,
            commands::terminal::terminal_update,
            commands::terminal::terminal_delete,
            commands::terminal::terminal_pin,
            commands::terminal::terminal_set_font_size,
            commands::terminal::terminal_local_completions,
            commands::commands::command_create,
            commands::commands::command_update,
            commands::commands::command_delete,
            commands::commands::command_pin,
            commands::commands::command_list,
            commands::commands::command_list_global,
            commands::ssh::ssh_create,
            commands::ssh::ssh_update,
            commands::ssh::ssh_delete,
            commands::ssh::ssh_list,
            commands::ai::ai_chat,
            commands::ai::ai_suggest,
            commands::ai::ai_explain,
            commands::ai::ai_autocomplete,
            commands::ai::ai_settings,
            commands::ai::ai_config,
            commands::ai::ai_messages,
            commands::ai::ai_test,
            commands::ai::ai_cancel,
            commands::ai::ai_clear_messages,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::proxy_reload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
