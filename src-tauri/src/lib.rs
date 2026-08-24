mod commands;
mod importer;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            storage::initialize(app.handle())
                .map_err(|error| std::io::Error::other(format!("数据库初始化失败：{error}")))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::file_sha256,
            commands::read_file_bytes,
            commands::archives_list,
            commands::archive_active,
            commands::archive_create,
            commands::archive_rename,
            commands::archive_delete,
            commands::archive_set_active,
            commands::courses_load,
            commands::courses_replace,
            commands::courses_append,
            commands::course_save,
            commands::course_remove,
            commands::courses_clear,
            commands::rule_set_load,
            commands::rule_set_save,
            commands::rule_sets_list,
            commands::setting_load,
            commands::setting_save,
            commands::db_has_any_data,
            commands::db_clear_all,
            commands::data_export,
            commands::data_import,
            commands::db_backup,
            commands::db_restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
