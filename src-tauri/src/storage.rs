use rusqlite::backup::Backup;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

pub const SCHEMA_VERSION: i64 = 2;
pub const DEFAULT_ARCHIVE_ID: &str = "default";

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSummary {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub course_count: i64,
}

pub fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("jlu-gpa-desktop.sqlite3"))
}

pub fn open(app: &tauri::AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?).map_err(|error| error.to_string())?;
    initialize_connection(&connection)?;
    Ok(connection)
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    open(app).map(|_| ())
}

pub fn initialize_connection(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS archives (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS courses (
              archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
              id TEXT NOT NULL,
              code TEXT NOT NULL,
              name TEXT NOT NULL,
              term_year TEXT,
              term_semester TEXT,
              public_elective_category TEXT,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (archive_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_courses_archive_code
              ON courses(archive_id, code);
            CREATE INDEX IF NOT EXISTS idx_courses_archive_term
              ON courses(archive_id, term_year, term_semester);

            CREATE TABLE IF NOT EXISTS rule_sets (
              archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
              id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              PRIMARY KEY (archive_id, id)
            );

            CREATE TABLE IF NOT EXISTS settings (
              archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
              key TEXT NOT NULL,
              value_json TEXT NOT NULL,
              PRIMARY KEY (archive_id, key)
            );

            CREATE TABLE IF NOT EXISTS course_history (
              archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
              course_code TEXT NOT NULL,
              term_year TEXT,
              term_semester TEXT,
              score REAL,
              credit REAL,
              PRIMARY KEY (archive_id, course_code, term_year, term_semester)
            );
            "#,
        )
        .map_err(|error| error.to_string())?;

    let stored_version = connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    if stored_version > SCHEMA_VERSION {
        return Err(format!(
            "数据库版本 {stored_version} 高于当前支持版本 {SCHEMA_VERSION}"
        ));
    }

    connection
        .execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [SCHEMA_VERSION.to_string()],
        )
        .map_err(|error| error.to_string())?;
    let archive_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM archives", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if archive_count == 0 {
        ensure_archive(connection, DEFAULT_ARCHIVE_ID)?;
    }
    active_archive(connection)?;
    Ok(())
}

pub fn ensure_archive(connection: &Connection, archive: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO archives(id, name, created_at)
             VALUES(?1, ?2, datetime('now'))",
            params![
                archive,
                if archive == DEFAULT_ARCHIVE_ID {
                    "默认档案"
                } else {
                    archive
                }
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn list_archives(connection: &Connection) -> Result<Vec<ArchiveSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT a.id, a.name, a.created_at,
                    (SELECT COUNT(*) FROM courses c WHERE c.archive_id = a.id)
             FROM archives a
             ORDER BY a.created_at, a.rowid",
        )
        .map_err(|error| error.to_string())?;
    let archives = statement
        .query_map([], |row| {
            Ok(ArchiveSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                course_count: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .map(|row| row.map_err(|error| error.to_string()))
        .collect();
    archives
}

/// 列出某档案下的全部规则集（并行模拟用）。
pub fn list_rule_sets(connection: &Connection, archive: &str) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare("SELECT payload_json FROM rule_sets WHERE archive_id = ?1 ORDER BY rowid")
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

fn validate_archive_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("档案 ID 无效".to_string());
    }
    Ok(())
}

fn normalized_archive_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("档案名称不能为空".to_string());
    }
    if name.chars().count() > 80 {
        return Err("档案名称不能超过 80 个字符".to_string());
    }
    Ok(name)
}

fn ensure_unique_archive_name(
    connection: &Connection,
    name: &str,
    excluding_id: Option<&str>,
) -> Result<(), String> {
    let duplicate: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM archives
             WHERE lower(name) = lower(?1) AND (?2 IS NULL OR id <> ?2)",
            params![name, excluding_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if duplicate > 0 {
        return Err("已存在同名档案".to_string());
    }
    Ok(())
}

pub fn create_archive(connection: &Connection, id: &str, name: &str) -> Result<(), String> {
    validate_archive_id(id)?;
    let name = normalized_archive_name(name)?;
    ensure_unique_archive_name(connection, name, None)?;
    connection
        .execute(
            "INSERT INTO archives(id, name, created_at) VALUES(?1, ?2, datetime('now'))",
            params![id, name],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn rename_archive(connection: &Connection, id: &str, name: &str) -> Result<(), String> {
    let name = normalized_archive_name(name)?;
    ensure_unique_archive_name(connection, name, Some(id))?;
    let changed = connection
        .execute(
            "UPDATE archives SET name = ?2 WHERE id = ?1",
            params![id, name],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("档案不存在".to_string());
    }
    Ok(())
}

pub fn set_active_archive(connection: &Connection, id: &str) -> Result<(), String> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM archives WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("档案不存在".to_string());
    }
    connection
        .execute(
            "INSERT INTO meta(key, value) VALUES('active_archive', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [id],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn active_archive(connection: &Connection) -> Result<String, String> {
    let stored = connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'active_archive'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(id) = stored {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM archives WHERE id = ?1)",
                [&id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if exists {
            return Ok(id);
        }
    }
    let id = connection
        .query_row(
            "SELECT id FROM archives ORDER BY created_at, rowid LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    set_active_archive(connection, &id)?;
    Ok(id)
}

pub fn delete_archive(connection: &mut Connection, id: &str) -> Result<String, String> {
    let archive_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM archives", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if archive_count <= 1 {
        return Err("至少需要保留一个档案".to_string());
    }
    let current = active_archive(connection)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute("DELETE FROM archives WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("档案不存在".to_string());
    }
    let next = if current == id {
        transaction
            .query_row(
                "SELECT id FROM archives ORDER BY created_at, rowid LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?
    } else {
        current
    };
    transaction
        .execute(
            "INSERT INTO meta(key, value) VALUES('active_archive', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [&next],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(next)
}

fn required_text<'a>(value: &'a Value, pointer: &str, label: &str) -> Result<&'a str, String> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("课程缺少{label}"))
}

fn optional_text<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str)
}

pub fn insert_course(
    transaction: &Transaction<'_>,
    archive: &str,
    course: &Value,
) -> Result<(), String> {
    let id = required_text(course, "/id", "ID")?;
    let code = required_text(course, "/identity/code", "课程号")?;
    let name = required_text(course, "/identity/name", "课程名")?;
    let created_at = required_text(course, "/audit/createdAt", "创建时间")?;
    let updated_at = required_text(course, "/audit/updatedAt", "更新时间")?;
    let payload = serde_json::to_string(course).map_err(|error| error.to_string())?;

    transaction
        .execute(
            r#"
            INSERT INTO courses(
              archive_id, id, code, name, term_year, term_semester,
              public_elective_category, payload_json, created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(archive_id, id) DO UPDATE SET
              code = excluded.code,
              name = excluded.name,
              term_year = excluded.term_year,
              term_semester = excluded.term_semester,
              public_elective_category = excluded.public_elective_category,
              payload_json = excluded.payload_json,
              updated_at = excluded.updated_at
            "#,
            params![
                archive,
                id,
                code,
                name,
                optional_text(course, "/term/academicYear"),
                optional_text(course, "/term/semester"),
                optional_text(course, "/attributes/publicElectiveCategory"),
                payload,
                created_at,
                updated_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn checksum(path: &std::path::Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn checksum_path(path: &std::path::Path) -> PathBuf {
    PathBuf::from(format!("{}.sha256", path.display()))
}

pub fn validate_backup(path: &std::path::Path) -> Result<String, String> {
    if !path.is_file() {
        return Err("备份文件不存在".to_string());
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("无法打开备份：{error}"))?;
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if integrity != "ok" {
        return Err(format!("数据库完整性检查失败：{integrity}"));
    }
    let version: i64 = connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "备份缺少 schema_version".to_string())?
        .parse()
        .map_err(|_| "备份 schema_version 无效".to_string())?;
    if version != SCHEMA_VERSION {
        return Err(format!("备份版本为 {version}，当前仅支持 {SCHEMA_VERSION}"));
    }
    let actual = checksum(path)?;
    let sidecar = checksum_path(path);
    if sidecar.is_file() {
        let expected = fs::read_to_string(sidecar).map_err(|error| error.to_string())?;
        if expected.trim() != actual {
            return Err("备份校验和不匹配，文件可能已损坏".to_string());
        }
    }
    Ok(actual)
}

pub fn backup_to(app: &tauri::AppHandle, path: &std::path::Path) -> Result<String, String> {
    let source = open(app)?;
    backup_connection_to(&source, path)
}

fn backup_connection_to(source: &Connection, path: &std::path::Path) -> Result<String, String> {
    let temporary = PathBuf::from(format!("{}.tmp", path.display()));
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|error| error.to_string())?;
    }
    let mut destination = Connection::open(&temporary).map_err(|error| error.to_string())?;
    Backup::new(source, &mut destination)
        .map_err(|error| error.to_string())?
        .run_to_completion(16, Duration::from_millis(20), None)
        .map_err(|error| error.to_string())?;
    drop(destination);
    let digest = checksum(&temporary)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    fs::write(checksum_path(path), &digest).map_err(|error| error.to_string())?;
    Ok(digest)
}

pub fn restore_from(app: &tauri::AppHandle, source: &std::path::Path) -> Result<String, String> {
    let digest = validate_backup(source)?;
    let target = database_path(app)?;
    let previous = target.with_extension("before-restore.sqlite3");
    backup_to(app, &previous)?;

    let temporary = target.with_extension("restore.tmp");
    fs::copy(source, &temporary).map_err(|error| error.to_string())?;
    validate_backup(&temporary)?;
    for suffix in ["-wal", "-shm"] {
        let auxiliary = PathBuf::from(format!("{}{suffix}", target.display()));
        if auxiliary.exists() {
            fs::remove_file(auxiliary).map_err(|error| error.to_string())?;
        }
    }
    if target.exists() {
        fs::remove_file(&target).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, target).map_err(|error| error.to_string())?;
    Ok(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_schema_v2_and_default_archive() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_connection(&connection).unwrap();

        let version: String = connection
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let archive_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM archives WHERE id = ?1",
                [DEFAULT_ARCHIVE_ID],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(version, SCHEMA_VERSION.to_string());
        assert_eq!(archive_count, 1);
    }

    #[test]
    fn course_round_trip_preserves_public_elective_category_and_payload() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_connection(&connection).unwrap();
        let course = serde_json::json!({
          "id": "course-1",
          "identity": { "code": "A001", "name": "测试课程" },
          "term": { "academicYear": "2025-2026", "semester": "autumn" },
          "attributes": { "publicElectiveCategory": "人文类" },
          "audit": { "createdAt": "2026-08-23T00:00:00Z", "updatedAt": "2026-08-23T00:00:00Z" }
        });

        let transaction = connection.transaction().unwrap();
        insert_course(&transaction, DEFAULT_ARCHIVE_ID, &course).unwrap();
        transaction.commit().unwrap();

        let (category, payload): (String, String) = connection
            .query_row(
                "SELECT public_elective_category, payload_json FROM courses WHERE id = 'course-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(category, "人文类");
        assert_eq!(serde_json::from_str::<Value>(&payload).unwrap(), course);
    }

    #[test]
    fn archive_lifecycle_keeps_data_isolated_and_an_active_archive() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_connection(&connection).unwrap();
        create_archive(&connection, "archive-2", "大二").unwrap();
        assert!(create_archive(&connection, "archive-3", "大二").is_err());
        rename_archive(&connection, "archive-2", "大三").unwrap();
        set_active_archive(&connection, "archive-2").unwrap();

        let course = serde_json::json!({
          "id": "course-archive-2",
          "identity": { "code": "A002", "name": "档案课程" },
          "term": { "academicYear": "2025-2026", "semester": "autumn" },
          "audit": { "createdAt": "2026-08-23T00:00:00Z", "updatedAt": "2026-08-23T00:00:00Z" }
        });
        let transaction = connection.transaction().unwrap();
        insert_course(&transaction, "archive-2", &course).unwrap();
        transaction.commit().unwrap();

        let summaries = list_archives(&connection).unwrap();
        assert_eq!(summaries.len(), 2);
        assert_eq!(
            summaries
                .iter()
                .find(|archive| archive.id == "archive-2")
                .unwrap()
                .course_count,
            1
        );

        let next = delete_archive(&mut connection, "archive-2").unwrap();
        assert_eq!(next, DEFAULT_ARCHIVE_ID);
        assert_eq!(active_archive(&connection).unwrap(), DEFAULT_ARCHIVE_ID);
        let course_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM courses", [], |row| row.get(0))
            .unwrap();
        assert_eq!(course_count, 0);
        assert!(delete_archive(&mut connection, DEFAULT_ARCHIVE_ID).is_err());
    }

    fn temporary_path(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "jlu-gpa-{label}-{}-{nonce}.sqlite3",
            std::process::id()
        ))
    }

    #[test]
    fn backup_is_valid_and_checksum_mismatch_is_rejected() {
        let source = Connection::open_in_memory().unwrap();
        initialize_connection(&source).unwrap();
        let path = temporary_path("backup");

        let digest = backup_connection_to(&source, &path).unwrap();
        assert_eq!(validate_backup(&path).unwrap(), digest);

        fs::write(checksum_path(&path), "incorrect").unwrap();
        assert!(validate_backup(&path).unwrap_err().contains("校验和不匹配"));

        let _ = fs::remove_file(checksum_path(&path));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn corrupt_backup_is_rejected_before_restore() {
        let path = temporary_path("corrupt");
        fs::write(&path, b"not a sqlite database").unwrap();
        assert!(validate_backup(&path).is_err());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rule_sets_list_returns_all_sets_for_archive() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_connection(&connection).unwrap();
        let first = serde_json::json!({ "id": "set-a", "name": "A 规则" });
        let second = serde_json::json!({ "id": "set-b", "name": "B 规则" });
        connection
            .execute(
                "INSERT INTO rule_sets(archive_id, id, payload_json) VALUES(?1, ?2, ?3)",
                params![DEFAULT_ARCHIVE_ID, "set-a", serde_json::to_string(&first).unwrap()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO rule_sets(archive_id, id, payload_json) VALUES(?1, ?2, ?3)",
                params![DEFAULT_ARCHIVE_ID, "set-b", serde_json::to_string(&second).unwrap()],
            )
            .unwrap();

        let listed = list_rule_sets(&connection, DEFAULT_ARCHIVE_ID).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0]["id"], "set-a");
        assert_eq!(listed[1]["name"], "B 规则");
        assert!(list_rule_sets(&connection, "不存在的档案").unwrap().is_empty());
    }
}
