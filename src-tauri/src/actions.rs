//! Small file commands used by the queue and the right-click menu:
//!   - find_media_file: which of a few candidate names exists in a folder
//!     (done here, not with the webview's FS plugin, so it works in ANY folder —
//!     another drive, a network share — not only inside the FS scope).
//!   - open_media_path: opens a downloaded media file (default app) or a folder
//!     (file manager). Only existing folders and media/image files are allowed,
//!     so the webview can't use it to launch arbitrary programs.
//!   - copy_image_from_url: downloads a thumbnail (https only, size-capped) and
//!     puts it on the clipboard as an image.

use std::path::Path;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "webm", "mov", "avi", "m4v", "flv", "3gp", "ts",
    "mp3", "m4a", "aac", "opus", "ogg", "oga", "wav", "flac", "wma",
    "png", "jpg", "jpeg", "webp", "gif",
];

#[tauri::command]
pub fn open_media_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(path.trim());
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    if p.is_dir() {
        // ok: a folder opens in the file manager
    } else if p.is_file() {
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if !MEDIA_EXTENSIONS.contains(&ext.as_str()) {
            return Err("only media files can be opened".into());
        }
    } else {
        return Err("not found".into());
    }
    app.opener()
        .open_path(p.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_image_from_url(app: AppHandle, url: String) -> Result<(), String> {
    const MAX_BYTES: usize = 25 * 1024 * 1024;
    let url = url.trim().to_string();
    if !url.to_ascii_lowercase().starts_with("https://")
        || url.len() > 4096
        || url.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("invalid url".into());
    }
    let client = tauri_plugin_http::reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status()));
    }
    let body = resp.bytes().await.map_err(|e| e.to_string())?;
    if body.len() > MAX_BYTES {
        return Err("image too large".into());
    }
    let decoded = tauri::async_runtime::spawn_blocking(move || {
        image::load_from_memory(&body).map(|img| img.to_rgba8()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let (w, h) = (decoded.width(), decoded.height());
    let img = tauri::image::Image::new_owned(decoded.into_raw(), w, h);
    app.clipboard().write_image(&img).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundMedia {
    /// Full path of the first candidate that exists (forward slashes).
    file: Option<String>,
    /// The folder itself exists.
    folder_exists: bool,
}

/// Looks for the first existing file among `names` (plain file names, no
/// separators) inside the absolute folder `directory`.
#[tauri::command]
pub fn find_media_file(directory: String, names: Vec<String>) -> Result<FoundMedia, String> {
    let dir = Path::new(directory.trim());
    if !dir.is_absolute() {
        return Err("folder must be absolute".into());
    }
    let file = names
        .iter()
        .take(8)
        .filter(|n| !n.is_empty() && !n.contains(['/', '\\']) && n.as_str() != ".." && n.as_str() != ".")
        .map(|n| dir.join(n))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().replace('\\', "/"));
    Ok(FoundMedia { file, folder_exists: dir.is_dir() })
}
