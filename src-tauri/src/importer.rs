//! M3 目录批量导入的 Rust 侧文件 IO 能力。
//!
//! 设计约束：
//! - **文件名不可靠原则**：本模块只负责「按扩展名过滤候选」「SHA-256 指纹」「读取字节」，
//!   不做任何基于文件名的语义识别；格式与表头识别由前端内容嗅探完成（复用 SheetJS 解析链路）。
//! - 受控授权：所有路径均来自用户在目录选择器中显式选择的目录，命令不接受任意路径写操作。

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// 当前支持的候选文件扩展名（仅作为候选筛子，实际格式以内容嗅探为准）。
pub const SUPPORTED_EXTENSIONS: [&str; 3] = ["xls", "xlsx", "csv"];

/// 单文件读取上限，与前端解析上限（10 MB）保持一致。
pub const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;

/// 目录扫描产出的候选文件。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateFile {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    /// Unix 秒；读取失败时为 None（不因元数据问题中断整个扫描）。
    pub modified: Option<u64>,
}

fn is_candidate(name: &str) -> Option<String> {
    if name.starts_with("~$") || name.starts_with('.') {
        return None; // Excel 临时锁文件与隐藏文件不作为候选
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())?;
    if SUPPORTED_EXTENSIONS.contains(&extension.as_str()) {
        Some(extension)
    } else {
        None
    }
}

fn scan_into(dir: &Path, recursive: bool, out: &mut Vec<CandidateFile>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("读取目录失败：{error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录条目失败：{error}"))?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| format!("读取文件类型失败：{error}"))?;
        if file_type.is_dir() {
            if recursive {
                scan_into(&path, true, out)?;
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(extension) = is_candidate(&name) else {
            continue;
        };
        let metadata = entry.metadata().map_err(|error| format!("读取文件元数据失败：{error}"))?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());
        out.push(CandidateFile {
            path: path.to_string_lossy().into_owned(),
            name,
            extension,
            size: metadata.len(),
            modified,
        });
    }
    Ok(())
}

/// 扫描目录（可选递归）内受支持的候选文件，按路径排序返回。
pub fn scan_directory(dir: &Path, recursive: bool) -> Result<Vec<CandidateFile>, String> {
    if !dir.is_dir() {
        return Err(format!("目录不存在或不可读：{}", dir.display()));
    }
    let mut candidates = Vec::new();
    scan_into(dir, recursive, &mut candidates)?;
    candidates.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(candidates)
}

/// 计算文件的 SHA-256 十六进制指纹（分块读取，适合大文件）。
pub fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| format!("无法打开文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("读取文件失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(to_hex(hasher.finalize()))
}

/// 读取文件全部字节，供前端解析与嗅探使用；超过上限直接拒绝。
pub fn read_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取文件信息：{error}"))?;
    if !metadata.is_file() {
        return Err(format!("不是常规文件：{}", path.display()));
    }
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!(
            "文件超过 {} MB 上限（{:.1} MB）",
            MAX_READ_BYTES / 1024 / 1024,
            metadata.len() as f64 / (1024.0 * 1024.0)
        ));
    }
    let mut file = fs::File::open(path).map_err(|error| format!("无法打开文件：{error}"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("读取文件失败：{error}"))?;
    Ok(bytes)
}

fn to_hex(bytes: impl AsRef<[u8]>) -> String {
    let mut output = String::with_capacity(bytes.as_ref().len() * 2);
    for byte in bytes.as_ref() {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;

    fn temporary_dir(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("jlu-gpa-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_file(path: &Path, content: &[u8]) {
        let mut file = File::create(path).unwrap();
        file.write_all(content).unwrap();
    }

    #[test]
    fn scan_filters_extensions_case_insensitively_and_skips_temp_files() {
        let root = temporary_dir("scan");
        write_file(&root.join("成绩表.xlsx"), b"xlsx");
        write_file(&root.join("备份.CSV"), b"csv");
        write_file(&root.join("说明.txt"), b"ignore");
        write_file(&root.join("~$锁文件.xlsx"), b"ignore");
        write_file(&root.join(".hidden.xls"), b"ignore");
        let sub = root.join("子目录");
        fs::create_dir_all(&sub).unwrap();
        write_file(&sub.join("嵌套.xls"), b"xls");

        let flat = scan_directory(&root, false).unwrap();
        let names: Vec<_> = flat.iter().map(|item| item.name.as_str()).collect();
        assert_eq!(names, ["备份.CSV", "成绩表.xlsx"]);
        assert_eq!(flat[0].extension, "csv");
        assert!(flat[0].modified.is_some());

        let recursive = scan_directory(&root, true).unwrap();
        let names: Vec<_> = recursive.iter().map(|item| item.name.as_str()).collect();
        // 按完整路径排序：子目录内文件按路径参与排序
        assert_eq!(names, ["备份.CSV", "嵌套.xls", "成绩表.xlsx"]);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn scan_rejects_missing_or_non_directory() {
        assert!(scan_directory(Path::new("不存在的目录-xyz"), true).is_err());
        let file = temporary_dir("notdir").join("a.txt");
        write_file(&file, b"x");
        assert!(scan_directory(&file, true).is_err());
        fs::remove_dir_all(file.parent().unwrap()).ok();
    }

    #[test]
    fn sha256_matches_known_digest() {
        let root = temporary_dir("sha");
        let path = root.join("data.bin");
        write_file(&path, b"hello world");
        assert_eq!(file_sha256(&path).unwrap(), "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn read_file_bytes_round_trips_and_rejects_oversize() {
        let root = temporary_dir("read");
        let path = root.join("data.csv");
        let content = "课程号,课程名,成绩,学分\nA001,高数,90,3";
        write_file(&path, content.as_bytes());
        assert_eq!(read_file_bytes(&path).unwrap(), content.as_bytes());

        let oversized = root.join("big.bin");
        let mut file = File::create(&oversized).unwrap();
        let chunk = vec![0u8; 1024 * 1024];
        for _ in 0..(MAX_READ_BYTES as usize / chunk.len() + 1) {
            file.write_all(&chunk).unwrap();
        }
        assert!(read_file_bytes(&oversized).is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn read_file_bytes_rejects_directories() {
        let root = temporary_dir("readdir");
        assert!(read_file_bytes(&root).is_err());
        fs::remove_dir_all(root).ok();
    }
}
