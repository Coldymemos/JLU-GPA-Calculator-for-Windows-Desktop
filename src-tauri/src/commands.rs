use crate::importer;
use crate::storage;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::path::Path;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReport {
    path: String,
    checksum: String,
    dry_run: bool,
}

/// 扫描目录（可选递归）内受支持的候选成绩文件，仅按扩展名过滤，不做内容判断。
#[tauri::command]
pub fn scan_directory(dir: String, recursive: bool) -> Result<Vec<importer::CandidateFile>, String> {
    importer::scan_directory(Path::new(&dir), recursive)
}

/// 计算文件的 SHA-256 十六进制指纹。
#[tauri::command]
pub fn file_sha256(path: String) -> Result<String, String> {
    importer::file_sha256(Path::new(&path))
}

/// 读取文件全部字节（上限 10 MB），供前端内容嗅探与解析使用。
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    importer::read_file_bytes(Path::new(&path))
}

/// 将字节写入指定路径（M5 导出直写；自动创建父目录）。
#[tauri::command]
pub fn fs_write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    importer::write_file_bytes(Path::new(&path), &bytes)
}

/// 清理备份目录，仅保留最近 keep 份自动备份（M5 定时备份）。
#[tauri::command]
pub fn backup_prune(dir: String, keep: usize) -> Result<Vec<String>, String> {
    storage::prune_backups(Path::new(&dir), keep)
}

/// 启用/停用目录监听（M5.1；新文件经 `directory-watch-new-file` 事件通知前端）。
#[tauri::command]
pub fn watch_directory(app: tauri::AppHandle, dir: String, enabled: bool) -> Result<(), String> {
    crate::watch::configure_watch(&app, &dir, enabled)
}

#[tauri::command]
pub fn archives_list(app: tauri::AppHandle) -> Result<Vec<storage::ArchiveSummary>, String> {
    storage::list_archives(&storage::open(&app)?)
}

#[tauri::command]
pub fn archive_active(app: tauri::AppHandle) -> Result<String, String> {
    storage::active_archive(&storage::open(&app)?)
}

#[tauri::command]
pub fn archive_create(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    storage::create_archive(&storage::open(&app)?, &id, &name)
}

#[tauri::command]
pub fn archive_rename(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    storage::rename_archive(&storage::open(&app)?, &id, &name)
}

#[tauri::command]
pub fn archive_delete(app: tauri::AppHandle, id: String) -> Result<String, String> {
    storage::delete_archive(&mut storage::open(&app)?, &id)
}

#[tauri::command]
pub fn archive_set_active(app: tauri::AppHandle, id: String) -> Result<(), String> {
    storage::set_active_archive(&storage::open(&app)?, &id)
}

#[tauri::command]
pub fn courses_load(app: tauri::AppHandle, archive: String) -> Result<Vec<Value>, String> {
    let connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    let mut statement = connection
        .prepare("SELECT payload_json FROM courses WHERE archive_id = ?1 ORDER BY rowid")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([archive], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&payload).map_err(|error| error.to_string())
    })
    .collect()
}

#[tauri::command]
pub fn courses_replace(
    app: tauri::AppHandle,
    archive: String,
    courses: Vec<Value>,
) -> Result<(), String> {
    let mut connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM courses WHERE archive_id = ?1", [&archive])
        .map_err(|error| error.to_string())?;
    for course in &courses {
        storage::insert_course(&transaction, &archive, course)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn db_backup(app: tauri::AppHandle, path: String) -> Result<BackupReport, String> {
    let checksum = storage::backup_to(&app, Path::new(&path))?;
    Ok(BackupReport {
        path,
        checksum,
        dry_run: false,
    })
}

#[tauri::command]
pub fn db_restore(
    app: tauri::AppHandle,
    path: String,
    dry_run: bool,
) -> Result<BackupReport, String> {
    let checksum = if dry_run {
        storage::validate_backup(Path::new(&path))?
    } else {
        storage::restore_from(&app, Path::new(&path))?
    };
    Ok(BackupReport {
        path,
        checksum,
        dry_run,
    })
}

#[tauri::command]
pub fn courses_append(
    app: tauri::AppHandle,
    archive: String,
    courses: Vec<Value>,
) -> Result<(), String> {
    let mut connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for course in &courses {
        storage::insert_course(&transaction, &archive, course)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn course_save(app: tauri::AppHandle, archive: String, course: Value) -> Result<(), String> {
    let mut connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    storage::insert_course(&transaction, &archive, &course)?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn course_remove(app: tauri::AppHandle, archive: String, id: String) -> Result<(), String> {
    storage::open(&app)?
        .execute(
            "DELETE FROM courses WHERE archive_id = ?1 AND id = ?2",
            params![archive, id],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn courses_clear(app: tauri::AppHandle, archive: String) -> Result<(), String> {
    storage::open(&app)?
        .execute("DELETE FROM courses WHERE archive_id = ?1", [archive])
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rule_set_load(
    app: tauri::AppHandle,
    archive: String,
    id: String,
) -> Result<Option<Value>, String> {
    let connection = storage::open(&app)?;
    let payload = connection
        .query_row(
            "SELECT payload_json FROM rule_sets WHERE archive_id = ?1 AND id = ?2",
            params![archive, id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    payload
        .map(|json| serde_json::from_str(&json).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
pub fn rule_set_save(
    app: tauri::AppHandle,
    archive: String,
    rule_set: Value,
) -> Result<(), String> {
    let connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    let id = rule_set
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "规则集缺少 ID".to_string())?;
    connection
        .execute(
            "INSERT INTO rule_sets(archive_id, id, payload_json) VALUES(?1, ?2, ?3)
             ON CONFLICT(archive_id, id) DO UPDATE SET payload_json = excluded.payload_json",
            params![
                archive,
                id,
                serde_json::to_string(&rule_set).map_err(|error| error.to_string())?
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// 列出某档案下的全部规则集（多规则集并行模拟）。
#[tauri::command]
pub fn rule_sets_list(app: tauri::AppHandle, archive: String) -> Result<Vec<Value>, String> {
    let connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    storage::list_rule_sets(&connection, &archive)
}

#[tauri::command]
pub fn setting_load(
    app: tauri::AppHandle,
    archive: String,
    key: String,
) -> Result<Option<Value>, String> {
    let connection = storage::open(&app)?;
    let payload = connection
        .query_row(
            "SELECT value_json FROM settings WHERE archive_id = ?1 AND key = ?2",
            params![archive, key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    payload
        .map(|json| serde_json::from_str(&json).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
pub fn setting_save(
    app: tauri::AppHandle,
    archive: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    let connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    connection
        .execute(
            "INSERT INTO settings(archive_id, key, value_json) VALUES(?1, ?2, ?3)
             ON CONFLICT(archive_id, key) DO UPDATE SET value_json = excluded.value_json",
            params![
                archive,
                key,
                serde_json::to_string(&value).map_err(|error| error.to_string())?
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn db_has_any_data(app: tauri::AppHandle, archive: String) -> Result<bool, String> {
    let connection = storage::open(&app)?;
    let count: i64 = connection
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM courses WHERE archive_id = ?1) +
               (SELECT COUNT(*) FROM rule_sets WHERE archive_id = ?1) +
               (SELECT COUNT(*) FROM settings WHERE archive_id = ?1)",
            [archive],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(count > 0)
}

#[tauri::command]
pub fn db_clear_all(app: tauri::AppHandle, archive: String) -> Result<(), String> {
    let mut connection = storage::open(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM courses WHERE archive_id = ?1", [&archive])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM rule_sets WHERE archive_id = ?1", [&archive])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM settings WHERE archive_id = ?1", [&archive])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn data_export(app: tauri::AppHandle, archive: String) -> Result<Value, String> {
    let courses = courses_load(app.clone(), archive.clone())?;
    let connection = storage::open(&app)?;

    let mut rule_statement = connection
        .prepare("SELECT payload_json FROM rule_sets WHERE archive_id = ?1 ORDER BY id")
        .map_err(|error| error.to_string())?;
    let rule_sets = rule_statement
        .query_map([&archive], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .map(|row| {
            serde_json::from_str::<Value>(&row.map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut setting_statement = connection
        .prepare("SELECT key, value_json FROM settings WHERE archive_id = ?1 ORDER BY key")
        .map_err(|error| error.to_string())?;
    let settings = setting_statement
        .query_map([archive], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?
        .map(|row| {
            let (key, json) = row.map_err(|error| error.to_string())?;
            Ok(serde_json::json!({
                "key": key,
                "value": serde_json::from_str::<Value>(&json).map_err(|error| error.to_string())?
            }))
        })
        .collect::<Result<Vec<Value>, String>>()?;

    Ok(serde_json::json!({
        "courses": courses,
        "ruleSets": rule_sets,
        "settings": settings
    }))
}

#[tauri::command]
pub fn data_import(app: tauri::AppHandle, archive: String, data: Value) -> Result<(), String> {
    let courses = data
        .get("courses")
        .and_then(Value::as_array)
        .ok_or_else(|| "迁移数据缺少课程列表".to_string())?;
    let rule_sets = data
        .get("ruleSets")
        .and_then(Value::as_array)
        .ok_or_else(|| "迁移数据缺少规则集列表".to_string())?;
    let settings = data
        .get("settings")
        .and_then(Value::as_array)
        .ok_or_else(|| "迁移数据缺少设置列表".to_string())?;

    for rule_set in rule_sets {
        if rule_set.get("id").and_then(Value::as_str).is_none() {
            return Err("迁移数据中存在缺少 ID 的规则集".to_string());
        }
    }
    for setting in settings {
        if setting.get("key").and_then(Value::as_str).is_none() || setting.get("value").is_none() {
            return Err("迁移数据中存在无效设置".to_string());
        }
    }

    let mut connection = storage::open(&app)?;
    storage::ensure_archive(&connection, &archive)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for table in ["courses", "rule_sets", "settings"] {
        transaction
            .execute(
                &format!("DELETE FROM {table} WHERE archive_id = ?1"),
                [&archive],
            )
            .map_err(|error| error.to_string())?;
    }
    for course in courses {
        storage::insert_course(&transaction, &archive, course)?;
    }
    for rule_set in rule_sets {
        let id = rule_set.get("id").and_then(Value::as_str).unwrap();
        transaction
            .execute(
                "INSERT INTO rule_sets(archive_id, id, payload_json) VALUES(?1, ?2, ?3)",
                params![
                    archive,
                    id,
                    serde_json::to_string(rule_set).map_err(|error| error.to_string())?
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    for setting in settings {
        transaction
            .execute(
                "INSERT INTO settings(archive_id, key, value_json) VALUES(?1, ?2, ?3)",
                params![
                    archive,
                    setting.get("key").and_then(Value::as_str).unwrap(),
                    serde_json::to_string(setting.get("value").unwrap())
                        .map_err(|error| error.to_string())?
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}
