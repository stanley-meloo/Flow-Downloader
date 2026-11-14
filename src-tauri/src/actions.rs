//! Small file commands used by the queue and the right-click menu:
//!   - find_media_file: which of a few candidate names exists in a folder
//!     (done here, not with the webview's FS plugin, so it works in ANY folder —
//!     another drive, a network share — not only inside the FS scope).
//!   - open_media_path: opens a downloaded media file (default app) or a folder
//!     (file manager). Only existing folders and media/image files are allowed,
//!     so the webview can't use it to launch arbitrary programs.
//!   - copy_image_from_url: downloads a thumbnail (https only, size-capped) and
//!     puts it on the clipboard as an image.
//!   - disk_free: free space on the drive of a folder (checked before adding
//!     downloads, so a big playlist doesn't fail halfway through).
//!   - screen_color_at_cursor + eyedropper_*: the color picker's eyedropper
//!     (screen pixel under the mouse, floating loupe) — Windows, Linux X11, macOS.
//!   - start_file_drag: drags a finished download out of the window (into a
//!     folder, an editor's timeline, a chat…) with the OS's native drag.

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
    // Refuse oversized images before downloading them (when the size is known).
    if resp.content_length().map_or(false, |l| l as usize > MAX_BYTES) {
        return Err("image too large".into());
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

/// Starts a native drag of a downloaded file out of the window (Windows /
/// macOS). Only existing media files can be dragged. Runs on the main thread
/// (sync command), which the OS drag-and-drop requires.
#[tauri::command]
pub fn start_file_drag(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    // Native separators (the frontend sends "/"): Explorer's drop targets
    // expect backslashes.
    let native = if cfg!(windows) { path.trim().replace('/', "\\") } else { path.trim().to_string() };
    let p = Path::new(&native);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !p.is_absolute() || !p.is_file() || !MEDIA_EXTENSIONS.contains(&ext.as_str()) {
        return Err("only downloaded media files can be dragged".into());
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let item = drag::DragItem::Files(vec![p.to_path_buf()]);
        let icon = drag::Image::Raw(include_bytes!("../icons/64x64.png").to_vec());
        drag::start_drag(&window, item, icon, |_, _| {}, drag::Options::default()).map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = window;
        Err("dragging files out is not supported on this system".into())
    }
}

// --- The user's own wallpapers ---------------------------------------------
// A chosen photo is copied into <app data>/wallpapers. The webview may only
// read images from a few folders (capabilities/default.json); a photo on
// another drive, a USB stick or a network share was readable right after
// picking it (the dialog grants it for that session) but not after a restart.
// The copy also keeps working if the original is moved or deleted.

const WALLPAPER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const WALLPAPER_MAX_BYTES: u64 = 200 * 1024 * 1024;
// Video wallpapers: converted on import (bundled ffmpeg) to H.264 MP4s, no
// audio, at most 30 fps, first 5 minutes — one at most 1920x1080 and, for
// bigger sources, also 2560x1440 ("<name>@1440.mp4") and 3840x2160
// ("<name>@2160.mp4"). The app plays the smallest one that fills the window
// pixel for pixel (utils/videoTiers.js): 4K on a 4K screen in full screen,
// without decoding 4K non-stop in a normal window. HEVC / MKV / AVI also
// don't always play in the webview as they are.
const VIDEO_WALLPAPER_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "m4v", "mkv", "avi"];
// Formats the webview plays as they are (used if the conversion fails).
const VIDEO_WALLPAPER_PLAYABLE: &[&str] = &["mp4", "webm", "m4v"];
const VIDEO_WALLPAPER_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Bigger versions made for big video sources: (height, max width, the size
/// below it — only made when the source is bigger than that).
const VIDEO_TIERS: &[(u32, u32, u32)] = &[(1440, 2560, 1080), (2160, 3840, 1440)];

/// "<dir>/<stem>@<height>.mp4" next to a converted video wallpaper.
fn tier_path(base: &Path, height: u32) -> std::path::PathBuf {
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("wallpaper");
    base.with_file_name(format!("{stem}@{height}.mp4"))
}

fn ffmpeg_command(ffmpeg: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new(ffmpeg);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Width x height of a video's first video stream (from ffmpeg's report).
fn video_size(ffmpeg: &Path, src: &Path) -> Option<(u32, u32)> {
    let out = ffmpeg_command(ffmpeg).args(["-hide_banner", "-i"]).arg(src).output().ok()?;
    let report = String::from_utf8_lossy(&out.stderr);
    let line = report.lines().find(|l| l.contains("Stream #") && l.contains("Video:"))?;
    line.split(|c: char| c == ',' || c == ' ')
        .filter_map(|t| t.split_once('x'))
        .filter_map(|(w, h)| Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?)))
        .find(|&(w, h)| w >= 16 && h >= 16)
}

/// Converts a video into background-sized MP4s (see VIDEO_WALLPAPER_EXTENSIONS):
/// `dest` (<= 1080p) plus the bigger versions it deserves, in one ffmpeg run
/// (decoded once). Returns the heights of the bigger versions made.
fn convert_video_wallpaper(ffmpeg: &Path, src: &Path, dest: &Path) -> Result<Vec<u32>, String> {
    // The size it covers on a 16:9 screen (a wide video counts by its width).
    let cover_h = video_size(ffmpeg, src).map_or(0, |(w, h)| h.max(w * 9 / 16));
    let mut outputs: Vec<(u32, u32, std::path::PathBuf)> = vec![(1080, 1920, dest.to_path_buf())];
    for &(h, w, below) in VIDEO_TIERS {
        if cover_h > below + 8 {
            outputs.push((h, w, tier_path(dest, h)));
        }
    }
    let n = outputs.len();
    let mut graph = format!("[0:v]split={n}");
    for i in 0..n {
        graph.push_str(&format!("[s{i}]"));
    }
    for (i, (h, w, _)) in outputs.iter().enumerate() {
        // Only shrinks, keeps the aspect ratio, even sizes for H.264.
        graph.push_str(&format!(
            ";[s{i}]scale='min({w},iw)':'min({h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2[o{i}]"
        ));
    }
    let mut cmd = ffmpeg_command(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-t", "300", "-i"])
        .arg(src)
        .args(["-filter_complex", &graph]);
    for (i, (_, _, path)) in outputs.iter().enumerate() {
        cmd.args(["-map", &format!("[o{i}]")])
            .args([
                "-an", "-sn", "-dn", "-fpsmax", "30",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
            ])
            .arg(path);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() && outputs.iter().all(|(_, _, p)| p.is_file()) {
        Ok(outputs.iter().skip(1).map(|(h, _, _)| *h).collect())
    } else {
        for (_, _, p) in &outputs {
            let _ = std::fs::remove_file(p);
        }
        let err = String::from_utf8_lossy(&out.stderr);
        Err(format!("video conversion failed: {}", err.trim().lines().last().unwrap_or("")))
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedWallpaper {
    /// The copy in the wallpaper folder (forward slashes).
    path: String,
    /// Heights of the bigger versions of a video ("<name>@<height>.mp4").
    tiers: Vec<u32>,
}

impl ImportedWallpaper {
    fn at(path: &Path) -> Self {
        Self { path: path.to_string_lossy().replace('\\', "/"), tiers: Vec::new() }
    }
}

fn wallpapers_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("wallpapers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Copies an image (or converts a video, see VIDEO_WALLPAPER_EXTENSIONS) into
/// the app's wallpaper folder; returns the copy's path (forward slashes).
/// Files already in that folder are returned as is.
#[tauri::command]
pub async fn import_wallpaper(app: AppHandle, path: String) -> Result<ImportedWallpaper, String> {
    let src = std::path::PathBuf::from(path.trim());
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let video = VIDEO_WALLPAPER_EXTENSIONS.contains(&ext.as_str());
    if !src.is_absolute() || !src.is_file() || !(video || WALLPAPER_EXTENSIONS.contains(&ext.as_str())) {
        return Err("not an image or video file".into());
    }
    let max_bytes = if video { VIDEO_WALLPAPER_MAX_BYTES } else { WALLPAPER_MAX_BYTES };
    if std::fs::metadata(&src).map_or(true, |m| m.len() > max_bytes) {
        return Err("file too large".into());
    }
    let dir = wallpapers_dir(&app)?;
    if src.parent().map_or(false, |p| p == dir) {
        return Ok(ImportedWallpaper::at(&src));
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let free_name = |ext: &str| {
        (0u32..1000)
            .map(|n| dir.join(format!("wallpaper-{stamp}-{n}.{ext}")))
            .find(|p| !p.exists())
            .ok_or_else(|| "no free name".to_string())
    };
    if video {
        let dest = free_name("mp4")?;
        let converted = match crate::ytdlp::bundled_binary("ffmpeg") {
            Some(ffmpeg) => {
                let (from, to) = (src.clone(), dest.clone());
                tauri::async_runtime::spawn_blocking(move || convert_video_wallpaper(&ffmpeg, &from, &to))
                    .await
                    .map_err(|e| e.to_string())?
            }
            None => Err("ffmpeg not found".into()),
        };
        match converted {
            Ok(tiers) => return Ok(ImportedWallpaper { tiers, ..ImportedWallpaper::at(&dest) }),
            Err(err) => {
                let _ = std::fs::remove_file(&dest);
                // No ffmpeg / conversion failed: formats the webview plays are
                // copied as they are; the others can't be used.
                if !VIDEO_WALLPAPER_PLAYABLE.contains(&ext.as_str()) {
                    return Err(err);
                }
            }
        }
    }
    let dest = free_name(&ext)?;
    let to = dest.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::copy(&src, &to).map(|_| ()))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(ImportedWallpaper::at(&dest))
}

/// Deletes a wallpaper copy (only files inside the app's wallpaper folder).
#[tauri::command]
pub fn remove_wallpaper(app: AppHandle, path: String) -> Result<(), String> {
    let dir = wallpapers_dir(&app)?;
    let file = std::path::PathBuf::from(path.trim().replace('/', std::path::MAIN_SEPARATOR_STR));
    let inside = file.parent().map_or(false, |p| p == dir)
        || std::fs::canonicalize(&file)
            .ok()
            .zip(std::fs::canonicalize(&dir).ok())
            .map_or(false, |(f, d)| f.parent() == Some(d.as_path()));
    if !inside {
        return Ok(()); // a photo used from its original place: never deleted
    }
    let _ = std::fs::remove_file(&file);
    // A video's bigger versions ("<name>@1440.mp4", "<name>@2160.mp4").
    for &(h, _, _) in VIDEO_TIERS {
        let _ = std::fs::remove_file(tier_path(&file, h));
    }
    Ok(())
}

/// Free bytes available to the user on the drive holding `directory`.
#[tauri::command]
pub fn disk_free(directory: String) -> Result<u64, String> {
    let dir = Path::new(directory.trim());
    if !dir.is_absolute() || !dir.is_dir() {
        return Err("folder not found".into());
    }
    free_bytes(dir)
}

#[cfg(windows)]
fn free_bytes(dir: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut available: u64 = 0;
    unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut available as *mut u64), None, None) }
        .map_err(|e| e.to_string())?;
    Ok(available)
}

#[cfg(unix)]
fn free_bytes(dir: &Path) -> Result<u64, String> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(st.f_bavail as u64 * st.f_frsize as u64)
}

// --- Eyedropper ----------------------------------------------------------------
// The color picker's eyedropper reads the real screen pixel under the cursor,
// inside and outside the app:
//   - Windows: GetCursorPos + GDI GetPixel (instant).
//   - Linux (X11): Tauri's cursor position + a 1×1 xcap capture.
//     Wayland doesn't let apps read the cursor or the screen freely (only via
//     a permission prompt per capture), so there the commands fail and the
//     app falls back to sampling its own background.
//   - macOS: Tauri's cursor position + an xcap monitor capture (needs the
//     Screen Recording permission).
// Outside the app, on Windows and Linux a tiny transparent, click-through,
// always-on-top window (public/eyedropper.html) follows the cursor showing
// the color. Not on macOS: transparent windows there need Tauri's private-API
// flag, so the app keeps its loupe at the window edge (follows = false).

/// Color ("#rrggbb") of the screen pixel under the mouse cursor.
#[tauri::command]
pub async fn screen_color_at_cursor(app: AppHandle) -> Result<String, String> {
    cursor_pixel(&app).await.map(|(_, _, hex)| hex)
}

/// Cursor position (physical pixels) + color of the screen pixel under it.
async fn cursor_pixel(app: &AppHandle) -> Result<(f64, f64, String), String> {
    #[cfg(windows)]
    {
        let _ = app;
        screen_pixel_windows().map(|(x, y, hex)| (x as f64, y as f64, hex))
    }
    #[cfg(not(windows))]
    {
        #[cfg(target_os = "linux")]
        {
            if is_wayland() {
                return Err("reading the screen isn't allowed on Wayland".into());
            }
        }
        let pos = app.cursor_position().map_err(|e| format!("cursor: {e}"))?;
        let monitor = app
            .monitor_from_point(pos.x, pos.y)
            .map_err(|e| format!("monitor: {e}"))?
            .or_else(|| app.primary_monitor().ok().flatten())
            .ok_or_else(|| "no monitor".to_string())?;
        let (mx, my) = (monitor.position().x, monitor.position().y);
        let (mw, mh) = (monitor.size().width.max(1), monitor.size().height.max(1));
        let scale = monitor.scale_factor();
        let hex = tauri::async_runtime::spawn_blocking(move || {
            // xcap reports positions in points on macOS, physical pixels elsewhere.
            let near = |a: i32, b: f64| (a as f64 - b).abs() <= 2.0;
            let xm = xcap::Monitor::all()
                .map_err(|e| format!("list monitors: {e}"))?
                .into_iter()
                .find(|m| {
                    let (x, y) = (m.x().unwrap_or(i32::MIN), m.y().unwrap_or(i32::MIN));
                    (x == mx && y == my) || (near(x, mx as f64 / scale) && near(y, my as f64 / scale))
                })
                .ok_or_else(|| "monitor not found".to_string())?;
            // Linux: just the one pixel (fast enough to follow the cursor).
            #[cfg(target_os = "linux")]
            {
                let rx = ((pos.x - mx as f64) as i64).clamp(0, mw as i64 - 1);
                let ry = ((pos.y - my as f64) as i64).clamp(0, mh as i64 - 1);
                if let (Ok(x), Ok(y)) = (rx.try_into(), ry.try_into()) {
                    if let Ok(img) = xm.capture_region(x, y, 1, 1) {
                        let raw = img.into_raw();
                        if raw.len() >= 3 {
                            return Ok(format!("#{:02x}{:02x}{:02x}", raw[0], raw[1], raw[2]));
                        }
                    }
                }
            }
            // Whole monitor, then the pixel (macOS, or if the region failed).
            let img = xm.capture_image().map_err(|e| format!("capture: {e}"))?;
            let (iw, ih) = (img.width(), img.height());
            if iw == 0 || ih == 0 {
                return Err("empty capture".into());
            }
            let px = (((pos.x - mx as f64) * iw as f64 / mw as f64) as i64).clamp(0, iw as i64 - 1) as u32;
            let py = (((pos.y - my as f64) * ih as f64 / mh as f64) as i64).clamp(0, ih as i64 - 1) as u32;
            let raw = img.into_raw();
            let i = ((py * iw + px) * 4) as usize;
            Ok::<String, String>(format!("#{:02x}{:02x}{:02x}", raw[i], raw[i + 1], raw[i + 2]))
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok((pos.x, pos.y, hex))
    }
}

/// Running on a Wayland session (not X11 / XWayland).
#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    let backend = std::env::var("GDK_BACKEND").unwrap_or_default();
    if backend.starts_with("x11") {
        return false;
    }
    std::env::var("WAYLAND_DISPLAY").map_or(false, |v| !v.is_empty())
        || std::env::var("XDG_SESSION_TYPE").map_or(false, |v| v.eq_ignore_ascii_case("wayland"))
}

/// Cursor position (physical) + color of the screen pixel under it.
#[cfg(windows)]
fn screen_pixel_windows() -> Result<(i32, i32, String), String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.map_err(|e| e.to_string())?;
    unsafe {
        let dc = GetDC(None);
        if dc.is_invalid() {
            return Err("no screen DC".into());
        }
        let c = GetPixel(dc, p.x, p.y);
        ReleaseDC(None, dc);
        if c.0 == 0xFFFF_FFFF {
            return Err("pixel unavailable".into());
        }
        let v = c.0; // COLORREF = 0x00bbggrr
        Ok((p.x, p.y, format!("#{:02x}{:02x}{:02x}", v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff)))
    }
}

/// The floating loupe exists on this system.
const LOUPE_SUPPORTED: bool = cfg!(any(windows, target_os = "linux"));
const LOUPE: &str = "eyedropper";
const LOUPE_SIZE: f64 = 84.0; // logical px: 48 px circle + hex label

#[derive(serde::Serialize)]
pub struct EyedropperTick {
    hex: String,
    /// The floating loupe follows the cursor (Windows / Linux X11).
    follows: bool,
}

/// Start of picking: the app stays on top, and the loupe window is created
/// (off screen) before it's needed, then the focus goes back to the app (so
/// the "click outside = pick" detection still works).
#[tauri::command]
pub async fn eyedropper_prepare(app: AppHandle) -> Result<bool, String> {
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    // While picking, the app stays above everything: a click on another
    // window (to take its color) activates that window, which would otherwise
    // cover the app. The previous "always on top" state comes back afterwards.
    if let Some(main) = app.get_webview_window("main") {
        if !EYEDROPPER_ACTIVE.swap(true, Ordering::SeqCst) {
            PREV_ON_TOP.store(main.is_always_on_top().unwrap_or(false), Ordering::SeqCst);
        }
        let _ = main.set_always_on_top(true);
    }
    Ok(loupe_window(&app).is_some())
}

/// One step while the pointer is outside the app: the color under the cursor,
/// and the floating loupe moved next to the cursor showing it.
#[tauri::command]
pub async fn eyedropper_tick(app: AppHandle) -> Result<EyedropperTick, String> {
    let (x, y, hex) = cursor_pixel(&app).await?;
    let follows = move_loupe(&app, x as i32, y as i32, &hex);
    Ok(EyedropperTick { hex, follows })
}

/// Hides the loupe (pointer back in the app): made invisible and moved off
/// screen — never hidden as a window, since showing one again can take the focus.
#[tauri::command]
pub async fn eyedropper_hide(app: AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window(LOUPE) {
        let _ = w.eval("document.body.style.opacity=0");
        let _ = w.set_position(tauri::PhysicalPosition::new(-32000, -32000));
    }
}

/// Picking ended: the loupe window is closed.
#[tauri::command]
pub async fn eyedropper_close(app: AppHandle) {
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    if let Some(w) = app.get_webview_window(LOUPE) {
        let _ = w.destroy();
    }
    // Back to the user's own "always on top" choice, and the focus back to
    // the app (a click outside gave it to another window).
    if EYEDROPPER_ACTIVE.swap(false, Ordering::SeqCst) {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_always_on_top(PREV_ON_TOP.load(Ordering::SeqCst));
            let _ = main.unminimize();
            let _ = main.set_focus();
        }
    }
}

static EYEDROPPER_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static PREV_ON_TOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The loupe window (created on first use), or None where it isn't supported.
fn loupe_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    use tauri::Manager;
    if !LOUPE_SUPPORTED {
        return None;
    }
    #[cfg(target_os = "linux")]
    {
        if is_wayland() {
            return None; // no cursor position outside the app → nothing to follow
        }
    }
    if let Some(w) = app.get_webview_window(LOUPE) {
        return Some(w);
    }
    let w = build_loupe(app)?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    Some(w)
}

#[cfg(any(windows, target_os = "linux"))]
fn build_loupe(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let w = WebviewWindowBuilder::new(app, LOUPE, WebviewUrl::App("eyedropper.html".into()))
        .title("Eyedropper")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .inner_size(LOUPE_SIZE, LOUPE_SIZE)
        .position(-32000.0, -32000.0)
        .build()
        .ok()?;
    let _ = w.set_ignore_cursor_events(true); // clicks go through to what's below
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };
        if let Ok(h) = w.hwnd() {
            let hwnd = HWND(h.0 as *mut core::ffi::c_void);
            unsafe {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize);
            }
        }
    }
    Some(w)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn build_loupe(_app: &AppHandle) -> Option<tauri::WebviewWindow> {
    None
}

/// Moves the loupe next to the cursor and shows the color. false = no loupe.
fn move_loupe(app: &AppHandle, x: i32, y: i32, hex: &str) -> bool {
    let Some(win) = loupe_window(app) else { return false };
    let mon = app.monitor_from_point(x as f64, y as f64).ok().flatten();
    let s = mon.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let off = (14.0 * s) as i32;
    let size = (LOUPE_SIZE * s) as i32;
    // Below-right of the cursor (never under it: that pixel is the one read);
    // flipped near the screen's right / bottom edge.
    let (mut px, mut py) = (x + off, y + off);
    if let Some(m) = mon {
        let (mx, my) = (m.position().x, m.position().y);
        let (mw, mh) = (m.size().width as i32, m.size().height as i32);
        if px + size > mx + mw { px = x - off - size; }
        if py + size > my + mh { py = y - off - size; }
    }
    // Windows: moved AND kept above the app (which is "always on top" while
    // picking), without ever taking the focus.
    #[allow(unused_mut)]
    let mut placed = false;
    #[cfg(windows)]
    {
        if let Ok(h) = win.hwnd() {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE};
            let hwnd = HWND(h.0 as *mut core::ffi::c_void);
            placed = unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), px, py, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE) }.is_ok();
        }
    }
    if !placed {
        let _ = win.set_position(tauri::PhysicalPosition::new(px, py));
    }
    let _ = win.eval(&format!(
        "(function(){{var c=document.getElementById('c'),t=document.getElementById('t');if(c){{c.style.background='{hex}';t.textContent='{}';document.body.style.opacity=1}}}})()",
        hex.to_uppercase()
    ));
    true
}
