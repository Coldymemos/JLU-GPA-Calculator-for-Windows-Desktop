//! M5 目录监听：notify crate 监听用户选择的目录，新文件（Create 事件）通过
//! `directory-watch-new-file` 事件推送给前端；前端做防抖后重新扫描。
//!
//! 注意：本模块依赖 `notify` crate，沙箱内无法编译验证，需本机 `cargo build` 拉取依赖。

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// 全局监听器（单实例，切换目录/关闭时替换）。
static WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);

/// 前端监听的事件名：新文件创建时携带完整路径字符串。
pub const WATCH_NEW_FILE_EVENT: &str = "directory-watch-new-file";

pub fn validate_watch_dir(dir: &str) -> Result<(), String> {
    let path = Path::new(dir);
    if !path.is_dir() {
        return Err(format!("监听目录不存在：{dir}"));
    }
    Ok(())
}

/// 启用（enabled=true）或停用（enabled=false）对指定目录的递归监听。
/// 启用会替换掉之前的监听器；停用直接清空。
pub fn configure_watch(app: &AppHandle, dir: &str, enabled: bool) -> Result<(), String> {
    let mut guard = WATCHER.lock().map_err(|_| "目录监听锁被占用".to_string())?;
    *guard = None;
    if !enabled {
        return Ok(());
    }
    validate_watch_dir(dir)?;

    let app = app.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if matches!(event.kind, notify::EventKind::Create(_)) {
            for path in event.paths {
                if path.is_file() {
                    let _ = app.emit(
                        WATCH_NEW_FILE_EVENT,
                        path.to_string_lossy().to_string(),
                    );
                }
            }
        }
    })
    .map_err(|error| format!("创建目录监听失败：{error}"))?;
    watcher
        .watch(Path::new(dir), RecursiveMode::Recursive)
        .map_err(|error| format!("监听目录失败：{error}"))?;
    *guard = Some(watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_watch_directory() {
        assert!(validate_watch_dir("不存在的目录-xyz").is_err());
        let root = std::env::temp_dir();
        assert!(validate_watch_dir(&root.to_string_lossy()).is_ok());
    }
}
