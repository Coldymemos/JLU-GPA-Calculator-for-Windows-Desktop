//! 教务系统成绩导入窗口。
//!
//! 用户在独立 WebView 中自行完成 VPN/教务系统登录并点击官方导出按钮；
//! Tauri 只接管导出的表格文件，不读取或保存登录凭据。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const ACADEMIC_DOWNLOAD_FINISHED_EVENT: &str = "academic-import-download-finished";
const ACADEMIC_WINDOW_LABEL: &str = "academic-import";
const ACADEMIC_VPN_URL: &str = "https://vpn.jlu.edu.cn";
const DOWNLOAD_DIRECTORY_NAME: &str = "jlu-gpa-academic-import";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicDownloadPayload {
    pub path: String,
    pub name: String,
}

fn download_directory() -> PathBuf {
    std::env::temp_dir().join(DOWNLOAD_DIRECTORY_NAME)
}

fn supported_export(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "xls" | "xlsx" | "csv"
            )
        })
        .unwrap_or(false)
}

fn suggested_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("jlu-gpa-export.xlsx")
        .to_owned()
}

fn unique_download_path(directory: &Path, suggested: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    directory.join(format!("{stamp}-{}-{suggested}", std::process::id()))
}

/// 打开（或聚焦）教务系统导入窗口。
#[tauri::command]
pub async fn open_academic_import_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(ACADEMIC_WINDOW_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let directory = download_directory();
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建教务导入临时目录：{error}"))?;
    let event_app = app.clone();
    let navigation_app = app.clone();
    let download_directory = directory.clone();
    let url = url::Url::parse(ACADEMIC_VPN_URL).map_err(|error| error.to_string())?;

    WebviewWindowBuilder::new(&app, ACADEMIC_WINDOW_LABEL, WebviewUrl::External(url))
        .title("教务系统导入")
        .inner_size(1100.0, 760.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .focused(true)
        .focusable(true)
        // VPN 门户的入口卡片会通过 window.open/新窗口请求跳转；WebView2 默认会静默拦截。
        // 同域跳转改为当前窗口导航，避免打开系统浏览器后丢失 VPN 会话和下载捕获。
        .on_new_window(move |url, _features| {
            if url.scheme() == "https" && url.host_str() == Some("vpn.jlu.edu.cn") {
                if let Some(window) = navigation_app.get_webview_window(ACADEMIC_WINDOW_LABEL) {
                    let _ = window.navigate(url);
                }
                NewWindowResponse::Deny
            } else {
                NewWindowResponse::Allow
            }
        })
        // 兼容部分门户版本使用 target="_blank" 或直接调用 window.open 的入口卡片。
        .initialization_script(
            r#"(() => {
              const vpnHost = 'vpn.jlu.edu.cn';
              const isVpnUrl = (value) => {
                try { return new URL(value, window.location.href).hostname === vpnHost; }
                catch (_) { return false; }
              };
              const nativeOpen = window.open.bind(window);
              window.open = (value, ...args) => {
                if (value && isVpnUrl(value)) {
                  window.location.assign(new URL(value, window.location.href).href);
                  return window;
                }
                return nativeOpen(value, ...args);
              };
              document.addEventListener('click', (event) => {
                const anchor = event.target?.closest?.('a[target="_blank"]');
                if (!anchor || !isVpnUrl(anchor.href)) return;
                event.preventDefault();
                event.stopPropagation();
                window.location.assign(anchor.href);
              }, true);
            })();"#,
        )
        .on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { destination, .. } => {
                    let suggested = suggested_file_name(destination);
                    *destination = unique_download_path(&download_directory, &suggested);
                }
                DownloadEvent::Finished {
                    path: Some(path),
                    success: true,
                    ..
                } if supported_export(&path) => {
                    let payload = AcademicDownloadPayload {
                        path: path.display().to_string(),
                        name: suggested_file_name(&path),
                    };
                    let _ = event_app.emit_to("main", ACADEMIC_DOWNLOAD_FINISHED_EVENT, payload);
                }
                _ => {}
            }
            true
        })
        .build()
        .map(|_| ())
        .map_err(|error| format!("无法打开教务系统窗口：{error}"))
}

/// 删除已交给前端解析的临时导出文件，避免成绩表长期留在临时目录。
#[tauri::command]
pub fn remove_academic_import_file(path: String) -> Result<(), String> {
    let file = PathBuf::from(path);
    let directory = download_directory();
    let canonical_file = file
        .canonicalize()
        .map_err(|error| format!("无法定位教务导出文件：{error}"))?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("无法定位教务导入临时目录：{error}"))?;
    if !canonical_file.starts_with(&canonical_directory) {
        return Err("拒绝删除临时目录之外的文件".to_owned());
    }
    fs::remove_file(canonical_file).map_err(|error| format!("清理教务导出文件失败：{error}"))
}
