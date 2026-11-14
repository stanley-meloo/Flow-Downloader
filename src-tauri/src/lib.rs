mod actions;
mod screenshot;
mod wallpaper_pack;
mod window_corners;
mod ytdlp;

use tauri::{Emitter, Manager};

/// Aptabase App Key (dashboard → the app → Instructions). Not a secret: it
/// only lets the app SEND anonymous events, never read them.
const APTABASE_APP_KEY: &str = "A-US-0248253117";

/// True if `name` is a file yt-dlp / ffmpeg can create for a download whose
/// output template is "<stem>.%(ext)s". Matches, for example:
///   "<stem>.mp4.part", "<stem>.f137.mp4", "<stem>.f251.webm.part-Frag12",
///   "<stem>.temp.mp4", "<stem>.mp4.ytdl", "<stem>.mp4"
/// but NOT another title that merely starts the same way ("<stem>.Remix.mp4").
fn is_download_artifact(name: &str, stem: &str) -> bool {
    let rest = match name.strip_prefix(stem).and_then(|r| r.strip_prefix('.')) {
        Some(r) if !r.is_empty() => r,
        _ => return false,
    };
    let mut parts: Vec<&str> = rest.split('.').collect();

    // Trailing download markers: ".part", ".part-FragN", ".ytdl" (possibly stacked).
    while let Some(&last) = parts.last() {
        if parts.len() > 1 && (last == "part" || last == "ytdl" || last.starts_with("part-Frag")) {
            parts.pop();
        } else {
            break;
        }
    }

    // Optional leading format id ("f137", "f251-drc", "fhls-1080p") or "temp".
    if parts.len() > 1 {
        let first = parts[0];
        let is_format_id = first.len() > 1
            && first.starts_with('f')
            && first[1..].chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if is_format_id || first == "temp" {
            parts.remove(0);
        }
    }

    // What's left must be a single file extension (mp4, webm, m4a, ...).
    parts.len() == 1
        && (1..=5).contains(&parts[0].len())
        && parts[0].chars().all(|c| c.is_ascii_alphanumeric())
}

/// Names of the files in `dir` that belong to the download `stem`.
pub(crate) fn download_artifacts(dir: &std::path::Path, stem: &str) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if is_download_artifact(&name, stem) && e.path().is_file() {
                        Some(name)
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// After a download is cancelled: deletes every partial/intermediate file it
/// created (".part", ".part-FragN", ".ytdl", "fNNN" streams, ".temp", an
/// unfinished output), except the names in `keep` (the pre-download snapshot).
/// Retries for up to ~3 s because Windows can hold a file handle for a moment
/// after the process is killed.
pub(crate) fn remove_artifacts_except(dir: &std::path::Path, stem: &str, keep: &[String]) {
    for _ in 0..15 {
        let pending: Vec<String> = download_artifacts(dir, stem)
            .into_iter()
            .filter(|name| !keep.contains(name))
            .collect();
        if pending.is_empty() {
            break;
        }
        for name in pending {
            let _ = std::fs::remove_file(dir.join(&name));
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// Native Windows folder dialog that ALSO shows files.
///
/// The standard Windows folder picker (FOS_PICKFOLDERS) hides every file, by
/// design. Instead we use the regular Explorer "Open" dialog (IFileOpenDialog):
/// - a file-type filter makes it list the folder's video / audio / image files;
/// - the OK button is relabeled ("Select folder");
/// - the file-name box is pre-filled with a placeholder ("This folder") and
///   FOS_FILEMUSTEXIST is removed, so clicking the button with the placeholder
///   returns "<current folder>\<placeholder>" — we keep only the folder part.
///   If the user selects a file instead, we use the folder containing it.
/// The dialog is owned by the app window, so it is modal like any native dialog.
#[cfg(target_os = "windows")]
mod win_folder_dialog {
    use std::path::PathBuf;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
        FILEOPENDIALOGOPTIONS, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR,
        FOS_NOVALIDATE, FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH,
    };

    /// Media files listed by the dialog's default filter.
    const MEDIA_PATTERN: &str = "*.mp4;*.mkv;*.webm;*.mov;*.avi;*.m4v;*.flv;*.wmv;*.mpg;*.mpeg;*.ts;*.3gp;\
*.mp3;*.m4a;*.aac;*.wav;*.flac;*.ogg;*.opus;*.wma;*.aiff;\
*.jpg;*.jpeg;*.png;*.webp;*.gif;*.bmp;*.avif;*.heic;*.tif;*.tiff";

    /// HRESULT_FROM_WIN32(ERROR_CANCELLED): the user closed/cancelled the dialog.
    const HRESULT_CANCELLED: u32 = 0x8007_04C7;

    /// Translated texts shown in the dialog (provided by the frontend).
    pub struct Labels {
        pub title: String,
        pub ok: String,
        pub file_name: String,
        pub filter_media: String,
        pub filter_all: String,
    }

    pub fn pick(owner: Option<HWND>, default_path: Option<String>, labels: Labels) -> Result<Option<String>, String> {
        unsafe {
            // COM is normally already initialized on this (main) thread by the webview;
            // this then returns S_FALSE, which still has to be balanced by CoUninitialize.
            let init = CoInitializeEx(None, COINIT(COINIT_APARTMENTTHREADED.0 | COINIT_DISABLE_OLE1DDE.0));
            let result = show(owner, default_path, &labels);
            if init.is_ok() {
                CoUninitialize();
            }
            result.map_err(|e| format!("{e}"))
        }
    }

    unsafe fn show(owner: Option<HWND>, default_path: Option<String>, labels: &Labels) -> windows::core::Result<Option<String>> {
        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;

        // Allow the (non-existent) placeholder name; keep everything on the real file system.
        let opts = dialog.GetOptions()?;
        dialog.SetOptions(FILEOPENDIALOGOPTIONS(
            (opts.0 & !FOS_FILEMUSTEXIST.0)
                | FOS_NOVALIDATE.0
                | FOS_PATHMUSTEXIST.0
                | FOS_FORCEFILESYSTEM.0
                | FOS_NOCHANGEDIR.0,
        ))?;

        // HSTRINGs must outlive every PCWSTR pointing into them (they do: same scope).
        let title = HSTRING::from(labels.title.as_str());
        let ok = HSTRING::from(labels.ok.as_str());
        let file_name = HSTRING::from(labels.file_name.as_str());
        let media_name = HSTRING::from(labels.filter_media.as_str());
        let media_spec = HSTRING::from(MEDIA_PATTERN);
        let all_name = HSTRING::from(labels.filter_all.as_str());
        let all_spec = HSTRING::from("*.*");

        dialog.SetTitle(PCWSTR(title.as_ptr()))?;
        dialog.SetOkButtonLabel(PCWSTR(ok.as_ptr()))?;
        dialog.SetFileName(PCWSTR(file_name.as_ptr()))?;
        let specs = [
            COMDLG_FILTERSPEC { pszName: PCWSTR(media_name.as_ptr()), pszSpec: PCWSTR(media_spec.as_ptr()) },
            COMDLG_FILTERSPEC { pszName: PCWSTR(all_name.as_ptr()), pszSpec: PCWSTR(all_spec.as_ptr()) },
        ];
        dialog.SetFileTypes(&specs)?;

        // Start in the current download folder, if it still exists.
        if let Some(path) = default_path.filter(|p| !p.is_empty()) {
            let native = HSTRING::from(path.replace('/', "\\").as_str());
            if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(native.as_ptr()), None) {
                let _ = dialog.SetFolder(&item);
            }
        }

        if let Err(e) = dialog.Show(owner) {
            if e.code().0 as u32 == HRESULT_CANCELLED {
                return Ok(None);
            }
            return Err(e);
        }

        let item = dialog.GetResult()?;
        let raw = item.GetDisplayName(SIGDN_FILESYSPATH)?;
        let chosen = raw.to_string().unwrap_or_default();
        CoTaskMemFree(Some(raw.0 as *const core::ffi::c_void));
        if chosen.is_empty() {
            return Ok(None);
        }

        // Placeholder name or a selected file -> use its folder.
        let chosen = PathBuf::from(chosen);
        let folder = if chosen.is_dir() {
            chosen
        } else {
            chosen.parent().map(|p| p.to_path_buf()).unwrap_or(chosen)
        };
        Ok(Some(folder.to_string_lossy().replace('\\', "/")))
    }
}

/// Opens the native Windows folder dialog that also shows media files.
/// Returns the chosen folder (forward slashes), or None if cancelled.
/// Runs on the main thread (sync command), which owns the app window.
#[cfg(target_os = "windows")]
#[tauri::command]
fn pick_folder_native(
    window: tauri::WebviewWindow,
    default_path: Option<String>,
    title: String,
    ok_label: String,
    file_name: String,
    filter_media: String,
    filter_all: String,
) -> Result<Option<String>, String> {
    // Tauri may use a different `windows` crate version than ours, so its HWND
    // is a different type: rebuild ours from the raw window handle.
    let owner = window
        .hwnd()
        .ok()
        .map(|h| windows::Win32::Foundation::HWND(h.0 as *mut core::ffi::c_void));
    win_folder_dialog::pick(
        owner,
        default_path,
        win_folder_dialog::Labels { title, ok: ok_label, file_name, filter_media, filter_all },
    )
}

/// macOS / Linux: not needed — the standard native folder panel (dialog plugin)
/// already shows the files inside folders. Kept so the command list is the same
/// on every platform.
#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn pick_folder_native() -> Result<Option<String>, String> {
    Err("pick_folder_native is only used on Windows".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Essential plugins for the application
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // App self-update (checks GitHub Releases' latest.json, verifies the
        // signature with the public key in tauri.conf.json) + relaunch after it.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Anonymous usage statistics (Aptabase): only the events the frontend
        // sends (utils/analytics.js), only when the user leaves it on in Settings.
        .plugin(tauri_plugin_aptabase::Builder::new(APTABASE_APP_KEY).build())
        // yt-dlp runner state (running downloads, resolved binary path).
        // Rounded window corners on Windows 11 and macOS (window_corners.rs);
        // fallback for showing the (initially hidden) window.
        .setup(|app| {
            // macOS: where ffmpeg / deno get their clean copies (ytdlp.rs).
            ytdlp::set_mac_bin_dir(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                window_corners::apply(&window);
                // The window starts hidden and the frontend shows it once its
                // first frame is painted (no blank flash). Safety net: show it
                // anyway after a few seconds if that never happens.
                let w = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    let _ = w.show();
                });
            }
            Ok(())
        })
        .manage(ytdlp::Registry::default())
        .manage(ytdlp::YtdlpPath::default())
        .invoke_handler(tauri::generate_handler![
            ytdlp::ytdlp_analyze,
            ytdlp::ytdlp_download,
            ytdlp::ytdlp_cancel,
            ytdlp::ytdlp_cancel_all,
            ytdlp::ytdlp_update,
            ytdlp::ytdlp_version,
            ytdlp::save_thumbnail,
            ytdlp::get_diagnostics,
            screenshot::capture_app_window,
            actions::open_media_path,
            actions::find_media_file,
            actions::copy_image_from_url,
            actions::start_file_drag,
            actions::disk_free,
            actions::import_wallpaper,
            actions::remove_wallpaper,
            wallpaper_pack::wallpaper_pack_local,
            wallpaper_pack::download_wallpaper_pack,
            wallpaper_pack::cancel_wallpaper_pack,
            actions::screen_color_at_cursor,
            actions::eyedropper_prepare,
            actions::eyedropper_tick,
            actions::eyedropper_hide,
            actions::eyedropper_close,
            pick_folder_native
        ])
        // NOTE: we intentionally do NOT force `std::process::exit` on close.
        // The frontend intercepts the close request (asking for confirmation if
        // downloads are running), kills any yt-dlp/ffmpeg child processes, and
        // then destroys the window so the app shuts down cleanly.
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // App-level quit requests that don't go through "close window" —
            // e.g. Cmd+Q / "Quit" on macOS. While a window is still open we stop
            // the exit and let the frontend run the same close flow (confirmation
            // dialog if something is downloading). Once the frontend destroys the
            // last window there are no windows left, so the exit goes through.
            match &event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if !app.webview_windows().is_empty() {
                        api.prevent_exit();
                        let _ = app.emit("exit-requested", ());
                    }
                }
                // Last safety net: never leave a yt-dlp/ffmpeg process running.
                tauri::RunEvent::Exit => ytdlp::kill_all(app),
                _ => {}
            }
        });
}
