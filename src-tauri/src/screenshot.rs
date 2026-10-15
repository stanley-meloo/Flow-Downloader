//! "Print" from the right-click menu: captures ONLY the app window (the whole
//! window, nothing else on the screen), saves it as a PNG in
//! Pictures/Flow Downloader and puts it on the clipboard.
//!
//! How: the monitor the window is on is captured (xcap — the same pixels the
//! user sees, composited by the OS) and the window's exact rectangle is cut
//! out of it. Capturing the window by itself (PrintWindow) is NOT used: with
//! WebView2's GPU rendering it often returns a black or empty image.
//! Geometry comes from Tauri (physical pixels); the scale between the monitor
//! image and Tauri's monitor size handles any DPI difference.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;

struct Shot {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

/// Window + monitor rectangles in physical pixels (from Tauri).
struct Geometry {
    win_x: i32,
    win_y: i32,
    win_w: u32,
    win_h: u32,
    mon_x: i32,
    mon_y: i32,
    mon_w: u32,
    mon_h: u32,
    scale_factor: f64,
    /// Rounded window corners to cut out (Windows 11 draws 8 px corners on
    /// normal windows; none when maximized).
    corner_radius: f64,
}

fn geometry(window: &WebviewWindow) -> Result<Geometry, String> {
    if window.is_minimized().unwrap_or(false) {
        return Err("the window is minimized".into());
    }
    // Inner (client) area, not the outer frame: on Windows the outer rectangle
    // includes the invisible resize borders (~8 px left/right/bottom), which
    // showed up as a strip of desktop around the screenshot.
    let pos = window.inner_position().map_err(|e| format!("window position: {e}"))?;
    let size = window.inner_size().map_err(|e| format!("window size: {e}"))?;
    let maximized = window.is_maximized().unwrap_or(false);
    let monitor = window
        .current_monitor()
        .map_err(|e| format!("monitor: {e}"))?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "no monitor found".to_string())?;
    Ok(Geometry {
        win_x: pos.x,
        win_y: pos.y,
        win_w: size.width,
        win_h: size.height,
        mon_x: monitor.position().x,
        mon_y: monitor.position().y,
        mon_w: monitor.size().width,
        mon_h: monitor.size().height,
        scale_factor: monitor.scale_factor(),
        corner_radius: if cfg!(windows) && !maximized { 8.0 * monitor.scale_factor() } else { 0.0 },
    })
}

/// The xcap monitor that matches Tauri's monitor. xcap reports positions in
/// physical pixels on Windows and in points on macOS, so both are compared.
fn find_monitor(g: &Geometry) -> Result<xcap::Monitor, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("list monitors: {e}"))?;
    let near = |a: i32, b: f64| (a as f64 - b).abs() <= 2.0;
    let matches = |m: &xcap::Monitor| {
        let (x, y) = (m.x().unwrap_or(i32::MIN), m.y().unwrap_or(i32::MIN));
        (x == g.mon_x && y == g.mon_y)
            || (near(x, g.mon_x as f64 / g.scale_factor) && near(y, g.mon_y as f64 / g.scale_factor))
    };
    let mut fallback = None;
    for m in monitors {
        if matches(&m) {
            return Ok(m);
        }
        if fallback.is_none() || m.is_primary().unwrap_or(false) {
            fallback = Some(m);
        }
    }
    fallback.ok_or_else(|| "no monitor to capture".to_string())
}

fn capture(g: Geometry) -> Result<Shot, String> {
    let monitor = find_monitor(&g)?;
    let full = monitor.capture_image().map_err(|e| format!("monitor capture: {e}"))?;
    let (fw, fh) = (full.width(), full.height());
    if fw == 0 || fh == 0 {
        return Err("empty monitor capture".into());
    }
    let full = image::RgbaImage::from_raw(fw, fh, full.into_raw())
        .ok_or_else(|| "invalid monitor buffer".to_string())?;

    // Tauri's monitor size (physical) → captured image pixels (normally 1:1).
    let sx = fw as f64 / g.mon_w.max(1) as f64;
    let sy = fh as f64 / g.mon_h.max(1) as f64;
    let left = ((g.win_x - g.mon_x) as f64 * sx).round();
    let top = ((g.win_y - g.mon_y) as f64 * sy).round();
    let right = left + g.win_w as f64 * sx;
    let bottom = top + g.win_h as f64 * sy;
    // Keep only the part of the window that's on this monitor.
    let x0 = left.clamp(0.0, fw as f64) as u32;
    let y0 = top.clamp(0.0, fh as f64) as u32;
    let x1 = right.round().clamp(0.0, fw as f64) as u32;
    let y1 = bottom.round().clamp(0.0, fh as f64) as u32;
    if x1 <= x0 || y1 <= y0 {
        return Err("the window is off screen".into());
    }
    let (w, h) = (x1 - x0, y1 - y0);
    let mut crop = image::imageops::crop_imm(&full, x0, y0, w, h).to_image();
    round_corners(&mut crop, g.corner_radius * sx);
    Ok(Shot { width: w, height: h, rgba: crop.into_raw() })
}

/// Makes the pixels outside the window's rounded corners transparent (with a
/// 1 px anti-aliased edge), so no desktop shows in the corners of the PNG.
fn round_corners(img: &mut image::RgbaImage, radius: f64) {
    if radius < 1.0 {
        return;
    }
    let (w, h) = (img.width() as f64, img.height() as f64);
    let r = radius.min(w / 2.0).min(h / 2.0);
    let ri = r.ceil() as u32;
    for y in 0..ri.min(img.height()) {
        for x in 0..ri.min(img.width()) {
            // distance from this pixel's center to the corner circle's center
            let dx = r - (x as f64 + 0.5);
            let dy = r - (y as f64 + 0.5);
            let d = (dx * dx + dy * dy).sqrt();
            let coverage = (r - d + 0.5).clamp(0.0, 1.0); // 1 inside, 0 outside
            if coverage >= 1.0 {
                continue;
            }
            let (iw, ih) = (img.width(), img.height());
            for (px, py) in [(x, y), (iw - 1 - x, y), (x, ih - 1 - y), (iw - 1 - x, ih - 1 - y)] {
                let p = img.get_pixel_mut(px, py);
                p[3] = (p[3] as f64 * coverage).round() as u8;
            }
        }
    }
}

fn output_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .picture_dir()
        .or_else(|_| app.path().download_dir())
        .map_err(|e| format!("pictures folder: {e}"))?;
    let dir = base.join("Flow Downloader");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create folder: {e}"))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
    let mut path = dir.join(format!("Flow Downloader {stamp}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("Flow Downloader {stamp} ({n}).png"));
        n += 1;
    }
    Ok(path)
}

/// Captures the app window, saves it (PNG) and copies it to the clipboard.
/// Returns the saved file's path.
#[tauri::command]
pub async fn capture_app_window(app: AppHandle) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let g = geometry(&window)?;

    let shot = tauri::async_runtime::spawn_blocking(move || capture(g))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            eprintln!("[screenshot] failed: {e}");
            e
        })?;

    let path = output_path(&app)?;
    let buffer = image::RgbaImage::from_raw(shot.width, shot.height, shot.rgba.clone())
        .ok_or_else(|| "invalid image buffer".to_string())?;
    buffer
        .save_with_format(&path, image::ImageFormat::Png)
        .map_err(|e| format!("save png: {e}"))?;

    // Clipboard is a bonus: a failure here doesn't fail the screenshot.
    let image = tauri::image::Image::new_owned(shot.rgba, shot.width, shot.height);
    if let Err(e) = app.clipboard().write_image(&image) {
        eprintln!("[screenshot] clipboard: {e}");
    }
    eprintln!("[screenshot] saved {}", path.display());

    Ok(path.to_string_lossy().replace('\\', "/"))
}
