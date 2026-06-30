#[cfg_attr(mobile, tauri::mobile_entry_point)]

/// Locates the FFmpeg binary bundled next to the application executable.
/// Works both in development (target/debug, triple-suffixed names) and in
/// production (next to the app, plain name), on Windows and macOS.
/// Returns an empty string if none is found, so the frontend can fall back
/// to a system-installed FFmpeg.
#[tauri::command]
fn find_ffmpeg() -> String {
    let dir = match std::env::current_exe() {
        Ok(mut path) => {
            path.pop();
            path
        }
        Err(_) => return String::new(),
    };

    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["ffmpeg.exe", "ffmpeg-x86_64-pc-windows-msvc.exe"]
    } else if cfg!(target_os = "macos") {
        &["ffmpeg", "ffmpeg-aarch64-apple-darwin", "ffmpeg-x86_64-apple-darwin"]
    } else {
        &["ffmpeg"]
    };

    for name in candidates {
        let candidate = dir.join(name);
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    String::new()
}

/// Locates the bundled Deno JavaScript runtime next to the executable.
/// yt-dlp needs a JS runtime to solve YouTube's signature/n challenges; without
/// one, formats come back without a URL ("Requested format is not available").
/// Returns an empty string if none is bundled, so the frontend can fall back to
/// a Deno found on the system PATH.
#[tauri::command]
fn find_deno() -> String {
    let dir = match std::env::current_exe() {
        Ok(mut path) => {
            path.pop();
            path
        }
        Err(_) => return String::new(),
    };

    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["deno.exe", "deno-x86_64-pc-windows-msvc.exe"]
    } else if cfg!(target_os = "macos") {
        &["deno", "deno-aarch64-apple-darwin", "deno-x86_64-apple-darwin"]
    } else {
        &["deno"]
    };

    for name in candidates {
        let candidate = dir.join(name);
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    String::new()
}

/// Kills a process AND all of its children (the whole tree).
/// Needed because cancelling a download must also stop the ffmpeg process that
/// yt-dlp spawns for re-encoding — on Windows, killing the parent alone leaves
/// ffmpeg orphaned at high CPU.
#[tauri::command]
fn kill_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .and_then(|mut child| child.wait());
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Best effort: kill direct children, then the process itself.
        let _ = std::process::Command::new("pkill").args(["-9", "-P", &pid.to_string()]).spawn();
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).spawn();
    }
}

pub fn run() {
    tauri::Builder::default()
        // Essential plugins for the application
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![find_ffmpeg, find_deno, kill_process_tree])
        // NOTE: we intentionally do NOT force `std::process::exit` on close.
        // The frontend intercepts the close request, kills any running
        // yt-dlp/ffmpeg child processes, and then destroys the window so the
        // app shuts down cleanly without orphaned background processes.
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
