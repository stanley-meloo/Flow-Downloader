//! yt-dlp runner.
//!
//! Every yt-dlp invocation goes through the commands in this module. The
//! frontend never builds a command line: it sends a small, typed request
//! (URL, folder, file name, format, quality, cookies) which is validated here
//! and turned into a FIXED set of arguments. This closes the old risk of the
//! webview being allowed to run the sidecar with arbitrary arguments (for
//! example `--exec`, which runs any program after a download).
//!
//! It also owns:
//! - a writable copy of yt-dlp in the app's local data folder, so the
//!   self-update works even when the app is installed in a protected folder;
//! - progress events (`ytdlp://progress`), cancellation and the cleanup of the
//!   partial files a cancelled download leaves behind;
//! - saving thumbnails (any site) with the app signature in their EXIF data.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Digital signature embedded in every downloaded file (metadata comment for
/// video/audio, EXIF ImageDescription + XPComment for JPEG thumbnails).
pub const SIGNATURE_COMMENT: &str =
    "Downloaded with Flow Downloader - https://github.com/stanley-meloo/Flow-Downloader";

/// Name of the event that carries download progress to the frontend.
pub const PROGRESS_EVENT: &str = "ytdlp://progress";

/// How much of stderr is kept for error reporting (the tail is what matters).
const STDERR_TAIL: usize = 8000;

/// Browsers yt-dlp can read cookies from (`--cookies-from-browser`).
const COOKIE_BROWSERS: &[&str] = &[
    "brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale",
];
const VIDEO_EXTS: &[&str] = &["mp4", "mkv", "webm"];
const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "wav", "aac", "opus", "flac", "ogg"];

/// Lines yt-dlp prints when the download is over and post-processing starts.
const PROCESSING_MARKERS: &[&str] = &[
    "[Merger]", "[ExtractAudio]", "[VideoConvertor]", "[VideoRemuxer]", "[Metadata]", "[Fixup",
];

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// Running downloads (run id -> pid) and run ids the user cancelled.
/// A cancel can arrive before the process exists (the request is still on its
/// way); the download checks `cancelled` right before spawning, under the same
/// lock, so that case is handled without a race.
#[derive(Default)]
pub struct Registry(Mutex<RegistryInner>);

#[derive(Default)]
struct RegistryInner {
    running: HashMap<String, u32>,
    cancelled: HashSet<String>,
}

impl Registry {
    fn lock(&self) -> std::sync::MutexGuard<'_, RegistryInner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Resolved yt-dlp path (the writable copy, or the bundled binary as fallback).
#[derive(Default)]
pub struct YtdlpPath(Mutex<Option<PathBuf>>);

// ---------------------------------------------------------------------------
// Binaries
// ---------------------------------------------------------------------------

/// Locates a bundled sidecar (`ytdlp`, `ffmpeg`, `deno`) next to the executable.
/// Production builds use the plain name; `tauri dev` may keep the target triple.
/// On macOS, ffmpeg and deno are run from clean copies (see `mac_tools`).
pub fn bundled_binary(base: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        if base != "ytdlp" {
            if let Some(p) = mac_tools().get(base).filter(|p| p.is_file()) {
                return Some(p.clone());
            }
        }
    }
    sidecar_in_bundle(base)
}

/// The sidecar file itself, inside the app's install folder / .app bundle.
fn sidecar_in_bundle(base: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let names: Vec<String> = if cfg!(target_os = "windows") {
        vec![format!("{base}.exe"), format!("{base}-x86_64-pc-windows-msvc.exe")]
    } else if cfg!(target_os = "macos") {
        // Only this Mac's architecture: in `tauri dev` both the Apple Silicon and
        // the Intel sidecars sit in the same folder, and the other one can't run.
        let triple = if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" };
        vec![base.to_string(), format!("{base}-{triple}")]
    } else {
        // Linux packages install the sidecars into /usr/bin, so they carry a
        // "flowdl-" prefix there (tauri.linux.conf.json): a plain "ffmpeg" or
        // "deno" would clash with the system's own packages.
        vec![
            format!("flowdl-{base}"),
            format!("flowdl-{base}-x86_64-unknown-linux-gnu"),
            base.to_string(),
            format!("{base}-x86_64-unknown-linux-gnu"),
        ]
    };
    names.into_iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

// --- macOS: run the tools from clean copies ----------------------------------
// The app isn't notarized, so everything inside the .app carries the
// "quarantine" flag it got when the .dmg was downloaded. Opening the app with
// right-click → Open approves the app itself, but the helper programs it starts
// (ffmpeg, deno) can still be blocked by Gatekeeper — yt-dlp then fails to
// merge video + audio (ffmpeg) or to read sites that need a JS runtime (deno),
// so nothing downloads. Like yt-dlp (prepare_writable_copy), ffmpeg and deno
// are copied to <app local data>/bin once per app version, made executable
// and stripped of every extended attribute (quarantine included). On APFS the
// copy is a clone (instant, no extra disk space).

#[cfg(target_os = "macos")]
static MAC_BIN_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Called at startup (lib.rs setup) with the app's local data folder.
#[cfg(target_os = "macos")]
pub fn set_mac_bin_dir(app: &AppHandle) {
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = MAC_BIN_DIR.set(dir.join("bin"));
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_mac_bin_dir(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
fn mac_tools() -> &'static HashMap<String, PathBuf> {
    static TOOLS: std::sync::OnceLock<HashMap<String, PathBuf>> = std::sync::OnceLock::new();
    TOOLS.get_or_init(|| {
        let mut map = HashMap::new();
        let Some(dir) = MAC_BIN_DIR.get() else { return map };
        for base in ["ffmpeg", "deno"] {
            if let Some(bundled) = sidecar_in_bundle(base) {
                if let Some(copy) = copy_to_bin(dir, &bundled, base, &format!("{base}.source")) {
                    map.insert(base.to_string(), copy);
                }
            }
        }
        map
    })
}

/// Copies `bundled` to `<dir>/<name>` (refreshed when the app version or the
/// file changes), makes it executable and, on macOS, clears its extended
/// attributes (the quarantine flag blocks it otherwise).
fn copy_to_bin(dir: &Path, bundled: &Path, name: &str, marker_name: &str) -> Option<PathBuf> {
    std::fs::create_dir_all(dir).ok()?;
    let target = dir.join(name);
    let marker = dir.join(marker_name);
    let stamp = format!("{}:{}", env!("CARGO_PKG_VERSION"), std::fs::metadata(bundled).ok()?.len());
    let current = std::fs::read_to_string(&marker).unwrap_or_default();
    if !target.is_file() || current.trim() != stamp {
        let tmp = dir.join(format!("{name}.tmp"));
        std::fs::copy(bundled, &tmp).ok()?;
        let _ = std::fs::remove_file(&target);
        if std::fs::rename(&tmp, &target).is_err() {
            let _ = std::fs::remove_file(&tmp);
            return None;
        }
        let _ = std::fs::write(&marker, &stamp);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("/usr/bin/xattr")
            .arg("-c")
            .arg(&target)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    Some(target)
}

fn ytdlp_file_name() -> &'static str {
    if cfg!(target_os = "windows") { "yt-dlp.exe" } else { "yt-dlp" }
}

/// Copies the bundled yt-dlp into `<app local data>/bin` so it can update
/// itself (the install folder may be read-only, e.g. Program Files or a
/// signed .app bundle). A marker file remembers which bundled binary the copy
/// came from: when a new app version ships a different yt-dlp, the copy is
/// refreshed; otherwise a self-updated copy is kept as is.
fn prepare_writable_copy(app: &AppHandle, bundled: &Path) -> Option<PathBuf> {
    let dir = app.path().app_local_data_dir().ok()?.join("bin");
    // A new app version used to replace the copy with the bundled yt-dlp even
    // when the copy had already updated itself to something NEWER — so after
    // every app update the engine went back to the (older) bundled one, and
    // sites that had changed since (403 errors) broke until the next daily
    // check. Now the copy is kept when it isn't older than the bundled one.
    let target = dir.join(ytdlp_file_name());
    let marker = dir.join("yt-dlp.source");
    if let Ok(meta) = std::fs::metadata(bundled) {
        let stamp = format!("{}:{}", env!("CARGO_PKG_VERSION"), meta.len());
        let current = std::fs::read_to_string(&marker).unwrap_or_default();
        if target.is_file() && current.trim() != stamp {
            if let (Some(have), Some(ship)) = (binary_version(&target), binary_version(bundled)) {
                if !is_newer(&ship, &have) {
                    let _ = std::fs::write(&marker, &stamp);
                }
            }
        }
    }
    // Same marker name as before ("yt-dlp.source"), so an existing copy that
    // updated itself isn't replaced needlessly.
    copy_to_bin(&dir, bundled, ytdlp_file_name(), "yt-dlp.source")
}

/// Path of the yt-dlp to run (resolved once, then cached).
fn ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    let cache = app.state::<YtdlpPath>();
    let mut guard = cache.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(p) = guard.as_ref() {
        if p.is_file() {
            return Ok(p.clone());
        }
    }
    let bundled = bundled_binary("ytdlp").ok_or("yt-dlp binary not found next to the app")?;
    let path = prepare_writable_copy(app, &bundled).unwrap_or(bundled);
    *guard = Some(path.clone());
    Ok(path)
}

/// True when yt-dlp runs from the writable copy (self-update possible).
fn is_writable_copy(app: &AppHandle, path: &Path) -> bool {
    app.path()
        .app_local_data_dir()
        .map(|d| path.starts_with(d))
        .unwrap_or(false)
}

/// A yt-dlp process: UTF-8 output, no console window, nothing on stdin.
fn base_command(bin: &Path) -> Command {
    let mut cmd = Command::new(bin);
    // Without these the bundled (PyInstaller) yt-dlp prints titles with
    // accents/emoji in the system code page on Windows.
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Kills a process AND all of its descendants. The bundled yt-dlp is a
/// PyInstaller "onefile" build: the spawned process is only a bootloader that
/// runs the real Python process, which in turn runs ffmpeg. The tree must be
/// killed while the parent is still alive, so it can still be resolved.
pub fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Collect the whole tree via `pgrep -P`, then kill it deepest-first.
        fn collect(pid: u32, out: &mut Vec<u32>) {
            if let Ok(output) = Command::new("pgrep").args(["-P", &pid.to_string()]).output() {
                for line in String::from_utf8_lossy(&output.stdout).lines() {
                    if let Ok(child) = line.trim().parse::<u32>() {
                        collect(child, out);
                        out.push(child);
                    }
                }
            }
        }
        let mut tree = Vec::new();
        collect(pid, &mut tree);
        tree.push(pid);
        for p in tree {
            let _ = Command::new("kill").args(["-9", &p.to_string()]).status();
        }
    }
}

/// Kills every running download (used when the app exits).
pub fn kill_all(app: &AppHandle) {
    let pids: Vec<u32> = {
        let reg = app.state::<Registry>();
        let mut g = reg.lock();
        let ids: Vec<String> = g.running.keys().cloned().collect();
        g.cancelled.extend(ids);
        g.running.values().copied().collect()
    };
    for pid in pids {
        kill_tree(pid);
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Accepts only a single http(s) URL without spaces or control characters.
/// It is always passed after `--`, so it can never be read as an option.
fn validate_url(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    let lower = s.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("https://") || lower.starts_with("http://");
    if !scheme_ok
        || s.len() < 11
        || s.len() > 4096
        || s.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("invalid url".into());
    }
    Ok(s.to_string())
}

/// A file name stem produced by the frontend's sanitizeTitle(): no path
/// separators, no characters Windows forbids, no '%' (yt-dlp template syntax),
/// not starting with '.' or '-'.
fn validate_stem(stem: &str) -> Result<(), String> {
    let bad = stem.is_empty()
        || stem.chars().count() > 200
        || stem.starts_with('.')
        || stem.starts_with('-')
        || stem
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '%'));
    if bad { Err("invalid file name".into()) } else { Ok(()) }
}

/// An existing, absolute folder.
fn validate_dir(dir: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(dir);
    if !p.is_absolute() || !p.is_dir() {
        return Err("download folder not found".into());
    }
    Ok(p)
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cookies {
    #[serde(default)]
    cookie_file: Option<String>,
    #[serde(default)]
    cookie_browser: Option<String>,
}

/// A cookies.txt file takes priority (it avoids the Windows problem of reading
/// Chrome/Edge's encrypted cookie database); otherwise a known browser name.
fn cookie_args(c: &Cookies) -> Result<Vec<String>, String> {
    if let Some(file) = c.cookie_file.as_deref().filter(|s| !s.is_empty()) {
        let p = Path::new(file);
        if !p.is_absolute() || !p.is_file() {
            return Err("cookies file not found".into());
        }
        return Ok(vec!["--cookies".into(), file.into()]);
    }
    if let Some(browser) = c.cookie_browser.as_deref().filter(|s| !s.is_empty()) {
        if !COOKIE_BROWSERS.contains(&browser) {
            return Err("invalid cookie browser".into());
        }
        return Ok(vec!["--cookies-from-browser".into(), browser.into()]);
    }
    Ok(vec![])
}

/// Options shared by every call: no user config files (a yt-dlp.conf could add
/// `--exec`), plain UTF-8 output, and the bundled Deno for YouTube's JS checks.
fn common_args() -> Vec<String> {
    let mut a: Vec<String> = ["--ignore-config", "--no-warnings", "--no-colors", "--encoding", "utf-8"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if let Some(deno) = bundled_binary("deno") {
        a.push("--js-runtimes".into());
        a.push(format!("deno:{}", deno.to_string_lossy()));
    }
    a
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Last `max` bytes of `s`, cut on a character boundary.
fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    s[start..].to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn run_to_end(bin: &Path, args: &[String]) -> Result<RunOutput, String> {
    let out = base_command(bin)
        .args(args)
        .output()
        .map_err(|e| format!("could not start yt-dlp: {e}"))?;
    Ok(RunOutput {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: tail(&String::from_utf8_lossy(&out.stderr), STDERR_TAIL),
    })
}

// ---------------------------------------------------------------------------
// Log file (for "Copy diagnostics")
// ---------------------------------------------------------------------------

const LOG_FILE: &str = "flow-downloader.log";
const LOG_MAX_BYTES: u64 = 512 * 1024;

fn log_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(LOG_FILE))
}

/// Current UTC time as "YYYY-MM-DD HH:MM:SS" (no date crate needed).
fn utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Only the site of a URL ("www.example.com"): logs never keep full links.
fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or("")
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .rsplit('@')
        .next()
        .unwrap_or("")
        .to_string()
}

/// Appends an entry to the log file (restarted when it grows past 512 KB).
/// Failures are ignored: logging must never break a download.
pub fn write_log(app: &AppHandle, title: &str, body: &str) {
    use std::io::Write;
    let Some(path) = log_path(app) else { return };
    prune_log_once(&path);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > LOG_MAX_BYTES) {
        let _ = std::fs::remove_file(&path);
    }
    if is_not_media_failure(title, body) {
        return;
    }
    let body = redact_urls(body.trim());

    // The same failure repeated (e.g. the same link tried again and again) is
    // written once; the repeats are summed up when something else is logged.
    let key = format!("{title}\n{body}");
    let pending_repeats = {
        let mut last = LAST_LOG.lock().unwrap_or_else(|e| e.into_inner());
        if last.0 == key {
            last.1 += 1;
            return;
        }
        let repeats = last.1;
        *last = (key, 0);
        repeats
    };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        if pending_repeats > 0 {
            let _ = writeln!(f, "(previous error repeated {pending_repeats} more time(s))\n");
        }
        let _ = writeln!(f, "[{} UTC] {}\n{}\n", utc_now(), title, body);
    }
}

/// Last logged entry and how many times it was repeated since (see write_log).
static LAST_LOG: Mutex<(String, u32)> = Mutex::new((String::new(), 0));
const LOG_KEEP_DAYS: i64 = 14;

/// Links in yt-dlp's messages are replaced by their site name, so the log
/// (and the diagnostics the user shares) never contains full URLs.
fn redact_urls(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let next = ["https://", "http://"].iter().filter_map(|p| rest.find(p)).min();
        let Some(i) = next else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..i]);
        let end = rest[i..]
            .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ')' | ']' | '>' | ','))
            .map_or(rest.len(), |e| i + e);
        out.push_str(&format!("<{} link>", host_of(&rest[i..end])));
        rest = &rest[end..];
    }
    out
}

/// Once per run: rewrites the log file through clean_log (old entries,
/// non-video links, repeats, full URLs), so logs written by older versions get
/// cleaned up too.
fn prune_log_once(path: &Path) {
    static DONE: std::sync::Once = std::sync::Once::new();
    DONE.call_once(|| {
        let Ok(text) = std::fs::read_to_string(path) else { return };
        let cleaned = clean_log(&text);
        if cleaned != text {
            let _ = std::fs::write(path, cleaned);
        }
    });
}

/// True for a failure caused by the link itself (no video on the page, a site
/// yt-dlp doesn't support, an anti-bot wall on a generic page) — not an app
/// problem, so it's not kept in the log.
fn is_not_media_failure(title: &str, body: &str) -> bool {
    let b = body.to_ascii_lowercase();
    title.contains("analyze failed") && (b.contains("unsupported url") || b.contains("[generic]"))
}

/// Cleans a log text: drops entries older than LOG_KEEP_DAYS days and
/// non-video-link failures, replaces full URLs by their site name, and merges
/// identical consecutive entries into one + "(… repeated N more time(s))".
fn clean_log(text: &str) -> String {
    let cutoff = days_ago_date(LOG_KEEP_DAYS); // "YYYY-MM-DD"
    // Split into entries: a header "[YYYY-MM-DD HH:MM:SS UTC] title" + its body.
    let mut entries: Vec<(String, String, String)> = Vec::new(); // (stamp, title, body)
    let mut carried_repeats: Vec<u32> = Vec::new();
    for line in text.lines() {
        if let Some((stamp, title)) = parse_log_header(line) {
            entries.push((stamp.to_string(), title.trim().to_string(), String::new()));
            carried_repeats.push(0);
        } else if let Some(last) = entries.last_mut() {
            // A "(previous error repeated N …)" line written by write_log.
            if let Some(n) = line
                .strip_prefix("(previous error repeated ")
                .and_then(|r| r.split_whitespace().next())
                .and_then(|n| n.parse::<u32>().ok())
            {
                *carried_repeats.last_mut().unwrap() += n;
                continue;
            }
            if !last.2.is_empty() || !line.trim().is_empty() {
                last.2.push_str(line);
                last.2.push('\n');
            }
        }
    }

    let mut out = String::new();
    let mut prev_key: Option<String> = None;
    let mut repeats: u32 = 0;
    let flush = |out: &mut String, repeats: &mut u32| {
        if *repeats > 0 {
            out.push_str(&format!("(previous error repeated {} more time(s))\n\n", *repeats));
            *repeats = 0;
        }
    };
    for (idx, (stamp, title, body)) in entries.iter().enumerate() {
        if &stamp[..10] < cutoff.as_str() || is_not_media_failure(title, body) {
            continue;
        }
        let title = redact_urls(title);
        let body = redact_urls(body.trim());
        let key = format!("{title}\n{body}");
        if prev_key.as_deref() == Some(key.as_str()) {
            repeats += 1 + carried_repeats[idx];
            continue;
        }
        flush(&mut out, &mut repeats);
        // Keeps the timestamp of the first occurrence.
        out.push_str(&format!("[{stamp} UTC] {title}\n{body}\n\n"));
        repeats = carried_repeats[idx];
        prev_key = Some(key);
    }
    flush(&mut out, &mut repeats);
    out
}

/// A log entry header "[YYYY-MM-DD HH:MM:SS UTC] title" → ("YYYY-MM-DD HH:MM:SS", title).
fn parse_log_header(line: &str) -> Option<(&str, &str)> {
    let b = line.as_bytes();
    if line.len() >= 25 && b[0] == b'[' && b[5] == b'-' && b[8] == b'-' && line.is_char_boundary(20) && line.is_char_boundary(25) && &line[20..25] == " UTC]" {
        Some((&line[1..20], &line[25..]))
    } else {
        None
    }
}

/// UTC date `days` days ago as "YYYY-MM-DD".
fn days_ago_date(days: i64) -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        - days * 86_400;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

/// Days since 1970-01-01 → (year, month, day) (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Commands: analyze, version, update
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Info cache: a faster start for downloads
// ---------------------------------------------------------------------------
// Reading a link (ytdlp_analyze, when the download card opens) is the slow
// part of a download: the page, the site's checks, the list of streams. The
// download used to do all of it again. Now the single-video info read when the
// card opened is kept in a file and handed to yt-dlp (`--load-info-json`), so
// clicking Download goes straight to transferring. Entries expire after
// INFO_TTL (stream links from sites expire too); a download that fails with
// a cached info drops the entry, so the automatic retry reads the link fresh.

const INFO_TTL: Duration = Duration::from_secs(20 * 60);
static INFO_CACHE: Mutex<Vec<(String, PathBuf, Instant)>> = Mutex::new(Vec::new());

fn info_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("info");
    // Files left by a previous run are useless (the index is in memory) and
    // hold video titles / links: wiped on first use.
    static CLEAN: std::sync::Once = std::sync::Once::new();
    CLEAN.call_once(|| {
        let _ = std::fs::remove_dir_all(&dir);
    });
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Keeps the info JSON of a single video (analyze output) for `urls`.
fn remember_info(app: &AppHandle, urls: &[String], json: &str) {
    let Some(dir) = info_dir(app) else { return };
    let mut cache = INFO_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    // Expired entries go (with their files).
    cache.retain(|(_, path, at)| {
        let keep = at.elapsed() < INFO_TTL;
        if !keep { let _ = std::fs::remove_file(path); }
        keep
    });
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    urls[0].hash(&mut h);
    let file = dir.join(format!("{:016x}.info.json", h.finish()));
    if std::fs::write(&file, json).is_err() { return; }
    for u in urls {
        cache.retain(|(k, _, _)| k != u);
        cache.push((u.clone(), file.clone(), Instant::now()));
    }
}

/// The cached info file for a link, if still fresh.
fn cached_info(url: &str) -> Option<PathBuf> {
    let cache = INFO_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache
        .iter()
        .find(|(k, p, at)| k == url && at.elapsed() < INFO_TTL && p.is_file())
        .map(|(_, p, _)| p.clone())
}

fn forget_info(url: &str) {
    let mut cache = INFO_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache.retain(|(k, _, _)| k != url);
}

/// Reads a link's metadata (`--dump-single-json`). `single` = only that video
/// (used to probe the first entry of a playlist); otherwise playlists are
/// listed flat, up to `playlist_limit` entries.
#[tauri::command]
pub async fn ytdlp_analyze(
    app: AppHandle,
    url: String,
    single: bool,
    playlist_limit: Option<u32>,
    cookies: Option<Cookies>,
) -> Result<RunOutput, String> {
    let url = validate_url(&url)?;
    let cookie = cookie_args(&cookies.unwrap_or_default())?;
    let limit = playlist_limit.unwrap_or(25).clamp(1, 500);

    blocking(move || {
        let bin = ytdlp_path(&app)?;
        let mut args: Vec<String> = vec!["--dump-single-json".into()];
        if single {
            args.push("--no-playlist".into());
        } else {
            args.extend(["--flat-playlist".to_string(), "--yes-playlist".to_string()]);
            args.extend(["--playlist-items".to_string(), format!("1-{limit}")]);
        }
        args.extend(["--ignore-errors".to_string(), "--ignore-no-formats-error".to_string()]);
        args.extend(common_args());
        args.extend(cookie);
        let host = host_of(&url);
        let analyzed_url = url.clone();
        args.push("--".into());
        args.push(url);
        let out = run_to_end(&bin, &args)?;
        let empty = matches!(out.stdout.trim(), "" | "null");
        // A single video with its streams: kept for a faster download start.
        if out.code == Some(0) && !empty {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&out.stdout) {
                let is_video = v.get("_type").and_then(|t| t.as_str()).is_none_or(|t| t == "video")
                    && v.get("formats").is_some_and(|f| f.is_array());
                if is_video {
                    let mut urls = vec![analyzed_url.clone()];
                    if let Some(w) = v.get("webpage_url").and_then(|w| w.as_str()) {
                        if w != analyzed_url { urls.push(w.to_string()); }
                    }
                    remember_info(&app, &urls, &out.stdout);
                }
            }
        }
        // Links yt-dlp simply can't handle (a page with no video, a site it
        // doesn't support, a site's anti-bot wall on a generic page) are the
        // user's input, not an app problem: the toast explains it, no log entry.
        // (write_log itself skips failures caused by non-video links.)
        if out.code != Some(0) || empty {
            write_log(&app, &format!("analyze failed: {host} (exit {:?})", out.code), &out.stderr);
        }
        Ok(out)
    })
    .await
}

/// `yt-dlp --version` (None if it can't run).
fn binary_version(bin: &Path) -> Option<String> {
    run_to_end(bin, &["--version".to_string()])
        .ok()
        .filter(|o| o.code == Some(0))
        .map(|o| o.stdout.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Installed yt-dlp version, shown in Settings next to "Check for updates".
#[tauri::command]
pub async fn ytdlp_version(app: AppHandle) -> Result<String, String> {
    blocking(move || {
        let bin = ytdlp_path(&app)?;
        binary_version(&bin).ok_or_else(|| "yt-dlp did not report a version".into())
    })
    .await
}

// --- Update: check first, then download with progress ------------------------
// The app no longer runs `yt-dlp --update-to` (no progress, and its output had
// to be guessed to know whether anything changed). Instead:
//   1. `ytdlp_check_update` asks GitHub for the latest stable release and
//      compares it with the installed version — nothing is downloaded.
//   2. Only when it's newer, `ytdlp_update` downloads that release's binary
//      for this system, sending progress events (UPDATE_PROGRESS_EVENT),
//      checks it against the release's SHA2-256SUMS and swaps it in.

const YTDLP_LATEST_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const YTDLP_RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases/download";
const YTDLP_MAX_BYTES: u64 = 250 * 1024 * 1024;
/// Event carrying the update download's progress: { received, total }.
pub const UPDATE_PROGRESS_EVENT: &str = "ytdlp://update-progress";

static UPDATING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// yt-dlp's release file for this system.
fn ytdlp_asset() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    }
}

/// "2026.08.19" / "2026.08.19.1" / "stable@2026.08.19" → [2026, 8, 19, (1)].
fn parse_version(v: &str) -> Option<Vec<u64>> {
    let v = v.trim().rsplit('@').next()?;
    let parts: Option<Vec<u64>> = v.split('.').map(|p| p.parse().ok()).collect();
    parts.filter(|p| p.len() >= 3)
}

/// True when `latest` is a newer version than `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

fn http_client() -> Result<tauri_plugin_http::reqwest::Client, String> {
    tauri_plugin_http::reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("FlowDownloader/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Tag of yt-dlp's latest stable release (digits and dots only).
async fn latest_tag(client: &tauri_plugin_http::reqwest::Client) -> Result<String, String> {
    let resp = client
        .get(YTDLP_LATEST_API)
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("release check: http {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let tag = v.get("tag_name").and_then(|t| t.as_str()).unwrap_or_default().to_string();
    if tag.is_empty() || !tag.chars().all(|c| c.is_ascii_digit() || c == '.') || parse_version(&tag).is_none() {
        return Err("release check: unexpected tag".into());
    }
    Ok(tag)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// Installed version (None if yt-dlp didn't answer).
    current: Option<String>,
    latest: String,
    /// A newer release exists (or the installed binary doesn't work).
    outdated: bool,
    /// The installed copy can be replaced.
    writable: bool,
}

/// Is there a newer yt-dlp? Downloads nothing.
#[tauri::command]
pub async fn ytdlp_check_update(app: AppHandle) -> Result<UpdateCheck, String> {
    let a = app.clone();
    let (current, writable) = blocking(move || {
        let bin = ytdlp_path(&a)?;
        // Leftover of an earlier update (the old binary was still running then).
        if let Some(dir) = bin.parent() {
            let _ = std::fs::remove_file(dir.join(format!("{}.old", ytdlp_file_name())));
        }
        Ok((binary_version(&bin), is_writable_copy(&a, &bin)))
    })
    .await?;
    let latest = latest_tag(&http_client()?).await?;
    let outdated = current.as_deref().is_none_or(|c| is_newer(&latest, c));
    Ok(UpdateCheck { current, latest, outdated, writable })
}

#[derive(Serialize, Clone)]
struct UpdateProgress {
    received: u64,
    total: Option<u64>,
}

/// Downloads the latest yt-dlp (progress events), verifies its checksum and
/// replaces the writable copy. Returns the new version.
#[tauri::command]
pub async fn ytdlp_update(app: AppHandle) -> Result<String, String> {
    use std::sync::atomic::Ordering;
    if UPDATING.swap(true, Ordering::SeqCst) {
        return Err("an update is already running".into());
    }
    let result = download_update(&app).await;
    UPDATING.store(false, Ordering::SeqCst);
    if let Err(e) = &result {
        write_log(&app, "yt-dlp update failed", e);
    }
    result
}

async fn download_update(app: &AppHandle) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;

    let a = app.clone();
    let bin = blocking(move || ytdlp_path(&a)).await?;
    if !is_writable_copy(app, &bin) {
        return Err("yt-dlp is not in a writable folder".into());
    }
    let client = http_client()?;
    let tag = latest_tag(&client).await?;
    let asset = ytdlp_asset();

    // Expected checksum, from the same release.
    let sums = client
        .get(format!("{YTDLP_RELEASES}/{tag}/SHA2-256SUMS"))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !sums.status().is_success() {
        return Err(format!("checksums: http {}", sums.status()));
    }
    let sums = sums.text().await.map_err(|e| e.to_string())?;
    let expected = sums
        .lines()
        .find_map(|l| {
            let mut it = l.split_whitespace();
            let (hash, name) = (it.next()?, it.next()?);
            (name.trim_start_matches('*') == asset).then(|| hash.to_ascii_lowercase())
        })
        .filter(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or("checksums: no entry for this system")?;

    // Download next to the binary, hashing as it arrives.
    let dir = bin.parent().ok_or("no folder")?.to_path_buf();
    let part = dir.join(format!("{}.download", ytdlp_file_name()));
    let mut resp = client
        .get(format!("{YTDLP_RELEASES}/{tag}/{asset}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download: http {}", resp.status()));
    }
    let total = resp.content_length().filter(|&l| l > 0);
    if total.is_some_and(|l| l > YTDLP_MAX_BYTES) {
        return Err("download: file too large".into());
    }
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let _ = app.emit(UPDATE_PROGRESS_EVENT, UpdateProgress { received, total });
    let mut last_emit = Instant::now();
    let fail = |part: &Path, e: String| {
        let _ = std::fs::remove_file(part);
        e
    };
    loop {
        let chunk = match resp.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => { drop(file); return Err(fail(&part, e.to_string())); }
        };
        received += chunk.len() as u64;
        if received > YTDLP_MAX_BYTES {
            drop(file);
            return Err(fail(&part, "download: file too large".into()));
        }
        hasher.update(&chunk);
        if let Err(e) = file.write_all(&chunk) {
            drop(file);
            return Err(fail(&part, e.to_string()));
        }
        if last_emit.elapsed() >= Duration::from_millis(120) {
            last_emit = Instant::now();
            let _ = app.emit(UPDATE_PROGRESS_EVENT, UpdateProgress { received, total });
        }
    }
    let _ = app.emit(UPDATE_PROGRESS_EVENT, UpdateProgress { received, total: Some(received) });
    if let Err(e) = file.flush() {
        drop(file);
        return Err(fail(&part, e.to_string()));
    }
    drop(file);
    let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if hash != expected || total.is_some_and(|t| t != received) {
        return Err(fail(&part, "download: checksum mismatch".into()));
    }

    // Swap it in. The running binary can't be overwritten on Windows (a
    // download may be using it) but it can be renamed: old → .old, new → name.
    let app2 = app.clone();
    blocking(move || {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755));
        }
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("/usr/bin/xattr").arg("-c").arg(&part)
                .stdout(Stdio::null()).stderr(Stdio::null()).status();
        }
        let old = dir.join(format!("{}.old", ytdlp_file_name()));
        let _ = std::fs::remove_file(&old);
        let moved = std::fs::rename(&bin, &old).is_ok();
        if let Err(e) = std::fs::rename(&part, &bin) {
            if moved { let _ = std::fs::rename(&old, &bin); }
            let _ = std::fs::remove_file(&part);
            return Err(format!("could not replace yt-dlp: {e}"));
        }
        let Some(version) = binary_version(&bin) else {
            // The new binary doesn't run: put the old one back.
            if moved {
                let _ = std::fs::remove_file(&bin);
                let _ = std::fs::rename(&old, &bin);
            }
            write_log(&app2, "yt-dlp update", "new binary did not start");
            return Err("the new yt-dlp did not start".into());
        };
        let _ = std::fs::remove_file(&old); // fails while an old download still runs: removed next time
        Ok(version)
    })
    .await
}

// ---------------------------------------------------------------------------
// Command: download
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOpts {
    url: String,
    directory: String,
    stem: String,
    /// "video" | "audio" | "video_only"
    format_type: String,
    ext: String,
    /// Maximum height (e.g. 1080); None = best available.
    height: Option<u32>,
    audio_kbps: Option<u32>,
    #[serde(default)]
    cookies: Cookies,
    /// The user chose "Replace" for a file that already existed in the folder.
    #[serde(default)]
    overwrite: bool,
    /// Trim: only this part of the video (seconds).
    #[serde(default)]
    section: Option<Section>,
    /// Trim: exact cut (re-encodes the edges: slower, heavier) instead of the
    /// nearest keyframes.
    #[serde(default)]
    precise_cut: bool,
}

#[derive(Deserialize, Clone, Copy)]
pub struct Section {
    start: f64,
    end: f64,
}

/// yt-dlp args for a trimmed download (validated: finite, start ≥ 0,
/// at least half a second long, under 7 days).
fn section_args(section: Option<Section>, precise: bool) -> Result<Vec<String>, String> {
    let Some(s) = section else { return Ok(Vec::new()) };
    if !s.start.is_finite() || !s.end.is_finite() || s.start < 0.0 || s.end - s.start < 0.5 || s.end > 604_800.0 {
        return Err("invalid section".into());
    }
    let mut args = vec![
        "--download-sections".into(),
        format!("*{:.3}-{:.3}", s.start, s.end),
    ];
    if precise {
        args.push("--force-keyframes-at-cuts".into());
    }
    Ok(args)
}

// ---------------------------------------------------------------------------
// Command: trim preview clip
// ---------------------------------------------------------------------------
// "Play" in the trim view plays the real video: the selected part is fetched
// with yt-dlp in a light quality (≤ 360p, no re-encoding: it starts at the
// keyframe just before the cut) into the app's data folder, and the webview
// plays it through flowmedia:// (actions.rs). Clips are reused for the same
// link + range, and old ones are deleted (older than 3 h, at most 12 kept).

pub const PREVIEW_DIR: &str = "trim-preview";
const PREVIEW_MAX_LEN: f64 = 20.0 * 60.0; // a longer part previews its first 20 min
const PREVIEW_KEEP: usize = 12;
const PREVIEW_TTL: Duration = Duration::from_secs(3 * 3600);

fn tidy_previews(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(PathBuf, std::time::SystemTime)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.path(), e.metadata().ok()?.modified().ok()?)))
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1)); // newest first
    for (i, (path, at)) in files.iter().enumerate() {
        let age = at.elapsed().unwrap_or_default();
        // Files touched in the last 10 minutes may belong to a download still
        // running (a preview clip or a waveform, with its fragment files).
        if age < Duration::from_secs(600) { continue; }
        let old = age > PREVIEW_TTL;
        if old || i >= PREVIEW_KEEP {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewClip {
    /// Full path of the clip (played via flowmedia://).
    path: String,
    /// Range asked for (the clip may start a little earlier, at a keyframe).
    start: f64,
    end: f64,
}

#[tauri::command]
pub async fn ytdlp_preview_clip(
    app: AppHandle,
    url: String,
    start: f64,
    end: f64,
    cookies: Option<Cookies>,
) -> Result<PreviewClip, String> {
    let url = validate_url(&url)?;
    let cookie = cookie_args(&cookies.unwrap_or_default())?;
    let end = end.min(start + PREVIEW_MAX_LEN);
    // Same checks as a download's section.
    let section = section_args(Some(Section { start, end }), false)?;

    blocking(move || {
        let bin = ytdlp_path(&app)?;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(PREVIEW_DIR);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        tidy_previews(&dir);

        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (url.as_str(), (start * 10.0).round() as i64, (end * 10.0).round() as i64).hash(&mut h);
        let stem = format!("{:016x}", h.finish());
        let file = dir.join(format!("{stem}.mp4"));
        let done = |f: &Path| PreviewClip { path: f.to_string_lossy().into_owned(), start, end };
        if file.is_file() {
            return Ok(done(&file));
        }

        let folder = dir.to_string_lossy().replace('\\', "/").replace('%', "%%");
        let mut args: Vec<String> = vec![
            "--format".into(),
            // Light and playable everywhere: H.264 + AAC up to 360p. Separate
            // video + audio streams first: the single-file 360p stream (YouTube
            // "18") is now refused (403) when ffmpeg opens it for a section, so
            // it's only the last resort.
            "bv*[height<=360][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=480][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=480][ext=mp4]+ba[ext=m4a]/bv*[height<=480]+ba/best[height<=480][ext=mp4]/worst".into(),
            "--merge-output-format".into(), "mp4".into(),
            "--output".into(), format!("{}/{}.%(ext)s", folder.trim_end_matches('/'), stem),
            "--no-playlist".into(),
            "--no-part".into(),
            "--force-overwrites".into(),
        ];
        args.extend(section);
        args.extend(common_args());
        args.extend(cookie);
        if let Some(ffmpeg) = bundled_binary("ffmpeg") {
            args.push("--ffmpeg-location".into());
            args.push(ffmpeg.to_string_lossy().into_owned());
        }
        let fresh = |mut a: Vec<String>| { a.push("--".into()); a.push(url.clone()); a };
        let cached = cached_info(&url);
        let used_cache = cached.is_some();
        let first = match cached {
            Some(info) => { let mut a = args.clone(); a.push("--load-info-json".into()); a.push(info.to_string_lossy().into_owned()); a }
            None => fresh(args.clone()),
        };
        let mut out = run_to_end(&bin, &first)?;
        if out.code == Some(0) && file.is_file() {
            return Ok(done(&file));
        }
        // The links saved when the video was analyzed may have been refused
        // (expired / tied to another request): once more with fresh ones.
        if used_cache {
            out = run_to_end(&bin, &fresh(args))?;
            if out.code == Some(0) && file.is_file() {
                return Ok(done(&file));
            }
        }
        // Leftovers of a failed attempt.
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().starts_with(&stem) {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        write_log(&app, &format!("preview clip failed: {} (exit {:?})", host_of(&url), out.code), &out.stderr);
        Err(tail(&out.stderr, 600))
    })
    .await
}

// ---------------------------------------------------------------------------
// Command: audio waveform (trim timeline)
// ---------------------------------------------------------------------------
// The video's sound as a waveform for the trim timeline: the lightest audio
// stream is fetched with yt-dlp (≈ 1 MB for 3 min), ffmpeg decodes it to raw
// mono samples, and their loudness is reduced to `points` values (0–1). The
// audio file is deleted right after; the result is kept in memory for the
// session (same link → instant).

const WAVE_RATE: u32 = 2000; // samples per second decoded (plenty for a waveform)…
const WAVE_MAX_SAMPLES: f64 = 20_000_000.0; // …but at most ~40 MB of samples in memory (long videos: lower rate)
static WAVE_CACHE: Mutex<Vec<(String, Vec<f32>)>> = Mutex::new(Vec::new());

/// Raw signed 16-bit little-endian mono samples → `points` loudness values,
/// each the peak of its slice, normalised so the loudest is 1.
fn wave_peaks(raw: &[u8], points: usize) -> Vec<f32> {
    let samples: Vec<i16> = raw.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
    if samples.is_empty() || points == 0 {
        return Vec::new();
    }
    let per = (samples.len() as f64 / points as f64).max(1.0);
    let mut out = Vec::with_capacity(points);
    for i in 0..points {
        let a = (i as f64 * per) as usize;
        let b = (((i + 1) as f64 * per) as usize).min(samples.len());
        if a >= b { out.push(0.0); continue; }
        // Peak blended with RMS: keeps transients visible without spiky noise.
        let (mut peak, mut sum) = (0f32, 0f64);
        for &v in &samples[a..b] {
            let x = (v as f32 / 32768.0).abs();
            peak = peak.max(x);
            sum += (x as f64) * (x as f64);
        }
        let rms = (sum / (b - a) as f64).sqrt() as f32;
        out.push(peak * 0.4 + rms * 0.6);
    }
    let max = out.iter().cloned().fold(0f32, f32::max);
    if max > 0.0 { for v in &mut out { *v /= max; } }
    out
}

#[tauri::command]
pub async fn ytdlp_waveform(
    app: AppHandle,
    url: String,
    points: Option<u32>,
    duration: Option<f64>,
    cookies: Option<Cookies>,
) -> Result<Vec<f32>, String> {
    let url = validate_url(&url)?;
    let cookie = cookie_args(&cookies.unwrap_or_default())?;
    let points = points.unwrap_or(2000).clamp(100, 20000) as usize;
    let key = format!("{url}#{points}");
    if let Some((_, v)) = WAVE_CACHE.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|(k, _)| *k == key) {
        return Ok(v.clone());
    }

    blocking(move || {
        let bin = ytdlp_path(&app)?;
        let ffmpeg = bundled_binary("ffmpeg").ok_or("ffmpeg not found")?;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(PREVIEW_DIR);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        url.hash(&mut h);
        // A name of its own per request: two requests running at once (even
        // for the same video) never write over each other's files.
        static WAVE_RUN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let run = WAVE_RUN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let stem = format!("{:016x}-audio-{run}", h.finish());
        let cleanup = || {
            if let Ok(rd) = std::fs::read_dir(&dir) {
                for e in rd.flatten() {
                    if e.file_name().to_string_lossy().starts_with(&stem) { let _ = std::fs::remove_file(e.path()); }
                }
            }
        };
        cleanup();

        // 1) The lightest audio stream (no re-encoding).
        let folder = dir.to_string_lossy().replace('\\', "/").replace('%', "%%");
        let mut args: Vec<String> = vec![
            "--format".into(), "worstaudio/bestaudio/worst".into(),
            "--output".into(), format!("{}/{}.%(ext)s", folder.trim_end_matches('/'), stem),
            "--no-playlist".into(), "--no-part".into(), "--force-overwrites".into(),
        ];
        args.extend(common_args());
        args.extend(cookie);
        args.push("--ffmpeg-location".into());
        args.push(ffmpeg.to_string_lossy().into_owned());
        if let Some(info) = cached_info(&url) {
            args.push("--load-info-json".into());
            args.push(info.to_string_lossy().into_owned());
        } else {
            args.push("--".into());
            args.push(url.clone());
        }
        let out = run_to_end(&bin, &args)?;
        let file = std::fs::read_dir(&dir).ok().and_then(|rd| {
            rd.flatten().map(|e| e.path()).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&stem)))
        });
        let Some(file) = file.filter(|_| out.code == Some(0)) else {
            cleanup();
            return Err(tail(&out.stderr, 400));
        };

        // 2) Decode to raw mono samples and measure.
        // Long videos are decoded at a lower rate (a 10 h video: ~550 samples/s),
        // so memory stays bounded; still far more samples than the bars.
        let rate = duration
            .filter(|d| d.is_finite() && *d > 0.0)
            .map(|d| ((WAVE_MAX_SAMPLES / d) as u32).clamp(200, WAVE_RATE))
            .unwrap_or(WAVE_RATE)
            .to_string();
        let decoded = base_command(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(&file)
            .args(["-vn", "-ac", "1", "-ar", rate.as_str(), "-f", "s16le", "-"])
            .output()
            .map_err(|e| format!("could not start ffmpeg: {e}"));
        cleanup();
        let decoded = decoded?;
        if decoded.stdout.is_empty() {
            return Err(tail(&String::from_utf8_lossy(&decoded.stderr), 400));
        }
        let peaks = wave_peaks(&decoded.stdout, points);
        let mut cache = WAVE_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if cache.len() > 8 { cache.remove(0); }
        cache.push((key, peaks.clone()));
        Ok(peaks)
    })
    .await
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    code: Option<i32>,
    stderr: String,
    cancelled: bool,
    output_file: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    run_id: String,
    /// "download" | "processing"
    phase: &'static str,
    percent: Option<f64>,
    speed: Option<String>,
    eta: Option<String>,
}

/// Builds the format selection and post-processing for a request.
/// Returns (arguments, final file extension).
fn format_selection(o: &DownloadOpts) -> Result<(Vec<String>, String), String> {
    let ext = o.ext.trim_start_matches('.').to_ascii_lowercase();
    let height = o.height.filter(|h| (1..=8640).contains(h));
    let res = height.map(|h| format!("[height<={h}]")).unwrap_or_default();
    // YouTube serves H.264 (avc1) only up to 1080p; above that it's VP9/AV1.
    // Prefer the editor-friendly H.264 stream for mp4 whenever it exists.
    let above_1080 = height.is_some_and(|h| h > 1080);
    let avc = if ext == "mp4" && !above_1080 { "[vcodec^=avc1]" } else { "" };

    match o.format_type.as_str() {
        "audio" => {
            let ext = if ext == "mp4" { "m4a".to_string() } else { ext };
            if !AUDIO_EXTS.contains(&ext.as_str()) {
                return Err("invalid audio format".into());
            }
            let kbps = o.audio_kbps.unwrap_or(160).clamp(32, 320);
            Ok((
                vec![
                    "--format".into(), "bestaudio/best".into(),
                    "--extract-audio".into(),
                    "--audio-format".into(), ext.clone(),
                    "--audio-quality".into(), format!("{kbps}K"),
                ],
                ext,
            ))
        }
        "video" | "video_only" => {
            if !VIDEO_EXTS.contains(&ext.as_str()) {
                return Err("invalid video format".into());
            }
            let video_only = o.format_type == "video_only";
            let format = match (ext.as_str(), video_only) {
                ("mp4", false) => format!("bestvideo{res}{avc}[ext=mp4]+bestaudio[ext=m4a]/bestvideo{res}+bestaudio/best{res}/best"),
                ("webm", false) => format!("bestvideo{res}[ext=webm]+bestaudio[ext=webm]/bestvideo{res}+bestaudio/best{res}/best"),
                (_, false) => format!("bestvideo{res}+bestaudio/best{res}/best"),
                // Video only: the video stream alone, no audio track.
                ("mp4", true) => format!("bestvideo{res}{avc}[ext=mp4]/bestvideo{res}/best{res}/best"),
                ("webm", true) => format!("bestvideo{res}[ext=webm]/bestvideo{res}/best{res}/best"),
                (_, true) => format!("bestvideo{res}/best{res}/best"),
            };
            // Native streams only, never re-encoded: merged (video + audio) or
            // remuxed (video only) into the chosen container.
            let container_flag = if video_only { "--remux-video" } else { "--merge-output-format" };
            Ok((
                vec!["--format".into(), format, container_flag.into(), ext.clone()],
                ext,
            ))
        }
        _ => Err("invalid format type".into()),
    }
}

/// Raw numbers from our progress template line:
/// "[flowprog]<downloaded>|<total>|<estimate>|<speed>|<eta>|<whole size>|<video size>|<audio size>"
/// (numbers or "NA"). Returns (downloaded, this stream's size, whole download size).
/// The whole size is the sum of the real sizes of the requested streams
/// (video + audio, from the site's metadata) when both are known — far more
/// accurate than yt-dlp's running estimate.
fn parse_progress(line: &str) -> Option<(f64, Option<f64>, Option<f64>)> {
    let rest = line.trim().strip_prefix("[flowprog]")?;
    let f: Vec<Option<f64>> = rest.split('|').map(|v| v.trim().parse::<f64>().ok()).collect();
    let get = |i: usize| f.get(i).copied().flatten().filter(|v| *v > 0.0);
    let downloaded = f.first().copied().flatten()?;
    let whole = match (get(6), get(7)) {
        (Some(v), Some(a)) => Some(v + a),
        _ => get(5),
    };
    Some((downloaded, get(1).or(get(2)), whole))
}

/// What the queue shows: overall percent, plus the speed / time-left texts
/// (None = keep the previous text).
struct ProgressUpdate {
    percent: f64,
    speed: Option<String>,
    eta: Option<String>,
}

/// Turns yt-dlp's raw per-stream numbers into calm, realistic figures.
///
/// yt-dlp reports each stream separately (the video, then the audio, each
/// starting again at 0 %), its own size/speed/ETA values are estimates that
/// jump around several times per second. Here instead:
/// - progress is for the WHOLE download (all streams, using their real sizes
///   from the site's metadata when available) and never goes back;
/// - speed = bytes really received over the last 8 s;
/// - time left = bytes left ÷ a blend of that recent speed and the average
///   speed of the whole download so far (short dips/spikes don't swing it);
/// - the time left then counts down second by second like a real clock and is
///   only nudged toward new estimates, so it doesn't jump back and forth;
/// - the bar moves ~4×/s, but the speed / time texts change only once a second.
struct ProgressTracker {
    completed: f64,           // bytes of the streams already finished
    last_downloaded: f64,
    last_stream_total: f64,
    samples: std::collections::VecDeque<(Instant, f64)>,
    started: Option<Instant>, // first byte received
    speed: Option<f64>,       // recent bytes/s (shown)
    eta: Option<(f64, Instant)>, // last time-left value and when it was computed
    percent: f64,
    last_bar: Option<Instant>,
    last_text: Option<Instant>,
}

const SPEED_WINDOW: Duration = Duration::from_secs(8);
const BAR_INTERVAL: Duration = Duration::from_millis(250);
const TEXT_INTERVAL: Duration = Duration::from_millis(1000);
const WARMUP: Duration = Duration::from_millis(2000);

impl ProgressTracker {
    fn new() -> Self {
        Self {
            completed: 0.0, last_downloaded: 0.0, last_stream_total: 0.0,
            samples: std::collections::VecDeque::new(), started: None,
            speed: None, eta: None, percent: 0.0, last_bar: None, last_text: None,
        }
    }

    fn feed(&mut self, downloaded: f64, stream_total: Option<f64>, whole_total: Option<f64>) -> Option<ProgressUpdate> {
        let now = Instant::now();

        // A new stream started (e.g. audio after video): bytes restart near 0.
        if self.last_downloaded > 0.0 && downloaded + 1024.0 < self.last_downloaded * 0.5 {
            self.completed += self.last_stream_total.max(self.last_downloaded);
        }
        self.last_downloaded = downloaded;
        if let Some(t) = stream_total { self.last_stream_total = t.max(downloaded); }

        let overall = self.completed + downloaded;
        let expected = match whole_total {
            Some(w) if w >= overall => w,
            _ => self.completed + stream_total.unwrap_or(downloaded).max(downloaded),
        };
        let remaining = (expected - overall).max(0.0);

        // Overall percent: only forward; 100 % is shown when the file is done.
        if expected > 0.0 {
            self.percent = self.percent.max((overall / expected * 100.0).min(99.5));
        }

        // Recent speed: bytes received during the last 8 s.
        if overall > 0.0 { self.started.get_or_insert(now); }
        self.samples.push_back((now, overall));
        while let Some(&(t, _)) = self.samples.front() {
            if now.duration_since(t) > SPEED_WINDOW && self.samples.len() > 2 { self.samples.pop_front(); } else { break; }
        }
        let recent = self.samples.front().and_then(|&(t0, b0)| {
            let span = now.duration_since(t0).as_secs_f64();
            (span >= 1.0).then(|| ((overall - b0) / span).max(0.0))
        });
        if recent.is_some() { self.speed = recent; }

        // Average speed of the whole download so far.
        let elapsed = self.started.map_or(0.0, |t| now.duration_since(t).as_secs_f64());
        let average = (elapsed >= 2.0).then(|| overall / elapsed);

        // Speed used for the prediction: mostly recent, steadied by the average.
        let basis = match (recent, average) {
            (Some(r), Some(a)) if elapsed >= 8.0 => Some(r * 0.65 + a * 0.35),
            (Some(r), _) => Some(r),
            (None, a) => a,
        };
        if let Some(sp) = basis.filter(|s| *s > 1.0) {
            let raw = remaining / sp;
            let next = match self.eta {
                Some((prev, at)) => {
                    // Count down like a clock, then move gently toward the new estimate
                    // (a bit faster when they disagree a lot).
                    let predicted = (prev - now.duration_since(at).as_secs_f64()).max(0.0);
                    let gap = (raw - predicted).abs() / predicted.max(1.0);
                    let k = if gap > 0.5 { 0.35 } else { 0.15 };
                    predicted + (raw - predicted) * k
                }
                None => raw,
            };
            self.eta = Some((next, now));
        }

        let warmed = self.started.is_some_and(|t| now.duration_since(t) >= WARMUP);
        let text_due = warmed && self.last_text.is_none_or(|t| now.duration_since(t) >= TEXT_INTERVAL);
        let bar_due = self.last_bar.is_none_or(|t| now.duration_since(t) >= BAR_INTERVAL);
        if !text_due && !bar_due {
            return None;
        }
        self.last_bar = Some(now);
        let (speed, eta) = if text_due {
            self.last_text = Some(now);
            (self.speed.map(format_speed), self.eta.map(|(e, _)| format_eta(e)))
        } else {
            (None, None)
        };
        Some(ProgressUpdate { percent: self.percent, speed, eta })
    }
}

fn format_speed(bps: f64) -> String {
    const UNITS: [&str; 4] = ["B/s", "KB/s", "MB/s", "GB/s"];
    let mut v = bps;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 { format!("{v:.0} {}", UNITS[i]) } else { format!("{v:.1} {}", UNITS[i]) }
}

/// ffmpeg's stats line ("frame= 120 … size=  2048KiB time=00:00:05.12 …
/// speed=1.9x") → (seconds written, bytes written). Sizes in kB/KiB/MiB/B.
fn parse_ffmpeg_stats(line: &str) -> Option<(f64, Option<f64>)> {
    let t = line.split("time=").nth(1)?.split_whitespace().next()?;
    let mut secs = 0.0;
    for part in t.split(':') {
        secs = secs * 60.0 + part.trim().parse::<f64>().ok()?;
    }
    if !secs.is_finite() || secs < 0.0 { return None; }
    let size = line.split("size=").nth(1).and_then(|r| {
        let r = r.trim_start();
        let end = r.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(r.len());
        let n: f64 = r[..end].parse().ok()?;
        let unit = r[end..].split_whitespace().next().unwrap_or("");
        let mult = match unit.to_ascii_lowercase().as_str() {
            "kb" | "kib" => 1024.0,
            "mb" | "mib" => 1024.0 * 1024.0,
            "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
            "b" | "" => 1.0,
            _ => return None,
        };
        Some(n * mult)
    });
    Some((secs, size))
}

/// Progress of a trimmed download from ffmpeg's stats: percent of the part's
/// length written, speed = bytes over the last few seconds, time left = media
/// still to write ÷ how fast media is being written. Updates ≤ 4×/s (texts 1×/s).
struct SectionProgress {
    len: f64,
    started: Instant,
    samples: std::collections::VecDeque<(Instant, f64, f64)>, // (when, media s, bytes)
    percent: f64,
    last_bar: Option<Instant>,
    last_text: Option<Instant>,
}

impl SectionProgress {
    fn new(len: f64) -> Self {
        Self { len, started: Instant::now(), samples: Default::default(), percent: 0.0, last_bar: None, last_text: None }
    }

    fn feed(&mut self, t: f64, size: Option<f64>) -> Option<ProgressUpdate> {
        let now = Instant::now();
        self.percent = self.percent.max((t / self.len * 100.0).min(99.5));
        self.samples.push_back((now, t, size.unwrap_or(0.0)));
        while self.samples.len() > 2 && now.duration_since(self.samples[0].0) > SPEED_WINDOW {
            self.samples.pop_front();
        }
        let bar_due = self.last_bar.is_none_or(|x| now.duration_since(x) >= BAR_INTERVAL);
        let text_due = now.duration_since(self.started) >= Duration::from_millis(1500)
            && self.last_text.is_none_or(|x| now.duration_since(x) >= TEXT_INTERVAL);
        if !bar_due && !text_due { return None; }
        self.last_bar = Some(now);
        let (speed, eta) = if text_due {
            self.last_text = Some(now);
            let (t0, m0, b0) = *self.samples.front()?;
            let span = now.duration_since(t0).as_secs_f64().max(0.001);
            let bytes = ((size.unwrap_or(0.0) - b0) / span).max(0.0);
            let media_rate = ((t - m0) / span).max(0.0);
            (
                (bytes > 0.0).then(|| format_speed(bytes)),
                (media_rate > 0.01).then(|| format_eta((self.len - t).max(0.0) / media_rate)),
            )
        } else {
            (None, None)
        };
        Some(ProgressUpdate { percent: self.percent, speed, eta })
    }
}

/// Time left, rounded the way people read it: "< 5 s", "40 s", "3 min 30 s",
/// "12 min", "1 h 05 min". Small changes don't make the text flicker.
fn format_eta(secs: f64) -> String {
    let s = secs.max(0.0).round() as u64;
    if s < 5 {
        "< 5 s".into()
    } else if s < 60 {
        format!("{} s", s.div_ceil(5) * 5)                  // 5 s steps
    } else if s < 600 {
        let r = s.div_ceil(10) * 10;                         // 10 s steps
        if r.is_multiple_of(60) { format!("{} min", r / 60) } else { format!("{} min {:02} s", r / 60, r % 60) }
    } else if s < 3600 {
        format!("{} min", s.div_ceil(60))
    } else {
        let m = s.div_ceil(60);
        format!("{} h {:02} min", m / 60, m % 60)
    }
}

/// Downloads one item. Resolves when yt-dlp exits; progress is streamed via
/// `ytdlp://progress` events tagged with `run_id`. If the download is
/// cancelled, the partial files it created are deleted before returning
/// (files for the same name that existed BEFORE it started are kept).
#[tauri::command]
pub async fn ytdlp_download(
    app: AppHandle,
    run_id: String,
    opts: DownloadOpts,
) -> Result<DownloadResult, String> {
    let url = validate_url(&opts.url)?;
    validate_stem(&opts.stem)?;
    let dir = validate_dir(&opts.directory)?;
    let cookie = cookie_args(&opts.cookies)?;
    let (fmt, final_ext) = format_selection(&opts)?;
    let trim = section_args(opts.section, opts.precise_cut)?;
    if run_id.is_empty() || run_id.len() > 64 {
        return Err("invalid run id".into());
    }

    blocking(move || {
        let bin = ytdlp_path(&app)?;
        // A free name: never the file of another video with the same title,
        // nor the target of a download still running (`_reserved` frees it).
        let (stem, _reserved) = if opts.overwrite {
            exact_stem(&dir, &opts.stem, &final_ext)
        } else {
            unique_stem(&dir, &opts.stem, &final_ext)
        };

        // Output template: '%' in the folder name must not be read as a field.
        let folder = dir.to_string_lossy().replace('\\', "/").replace('%', "%%");
        let mut args: Vec<String> = fmt;
        args.extend([
            "--output".into(),
            format!("{}/{}.%(ext)s", folder.trim_end_matches('/'), stem),
            "--no-playlist".into(),
            "--newline".into(),
            "--progress-template".into(),
            // Raw numbers only (ProgressTracker computes the shown values). The last
            // field is the size of the whole download (all streams), when known.
            "download:[flowprog]%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.filesize,info.filesize_approx)s|%(info.requested_formats.0.filesize,info.requested_formats.0.filesize_approx)s|%(info.requested_formats.1.filesize,info.requested_formats.1.filesize_approx)s".into(),
            // Several fragments in parallel: fast downloads on fragmented streams.
            "--concurrent-fragments".into(), "5".into(),
            // Signature in the file's metadata comment (file properties / VLC).
            "--embed-metadata".into(),
            "--postprocessor-args".into(),
            format!("Metadata:-metadata comment=\"{SIGNATURE_COMMENT}\""),
        ]);
        args.extend(common_args());
        args.extend(cookie);
        if opts.overwrite {
            args.push("--force-overwrites".into());
        }
        args.extend(trim);
        let host = host_of(&url);
        if let Some(ffmpeg) = bundled_binary("ffmpeg") {
            args.push("--ffmpeg-location".into());
            args.push(ffmpeg.to_string_lossy().into_owned());
        }
        // The info read when the card opened, if fresh: no second extraction.
        let info_file = cached_info(&url);
        if let Some(info) = &info_file {
            args.push("--load-info-json".into());
            args.push(info.to_string_lossy().into_owned());
        } else {
            args.push("--".into());
            args.push(url.clone());
        }

        // Files for this name that already exist are never deleted on cancel.
        let keep = crate::download_artifacts(&dir, &stem);
        let output_file = format!("{stem}.{final_ext}");

        let registry = app.state::<Registry>();
        let mut child = {
            let mut g = registry.lock();
            if g.cancelled.remove(&run_id) {
                return Ok(DownloadResult { cancelled: true, output_file, ..Default::default() });
            }
            let child = base_command(&bin)
                .args(&args)
                .spawn()
                .map_err(|e| format!("could not start yt-dlp: {e}"))?;
            g.running.insert(run_id.clone(), child.id());
            child
        };

        // stderr in its own thread (keeps the pipe from filling up).
        // Trimmed downloads go through ffmpeg, which doesn't feed yt-dlp's
        // progress lines; its own stats on stderr ("size=… time=…") are read
        // instead: progress = time written ÷ length of the part.
        let section_len = opts.section.map(|s| (s.end - s.start).max(0.5));
        let (stats_app, stats_run) = (app.clone(), run_id.clone());
        let stderr_reader = child.stderr.take().map(|mut err| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                match section_len {
                    None => { let _ = err.read_to_end(&mut buf); }
                    Some(len) => {
                        let mut stats = SectionProgress::new(len);
                        let mut chunk = [0u8; 4096];
                        let mut line: Vec<u8> = Vec::new();
                        loop {
                            let n = match err.read(&mut chunk) { Ok(0) | Err(_) => break, Ok(n) => n };
                            buf.extend_from_slice(&chunk[..n]);
                            for &b in &chunk[..n] {
                                if b == b'\r' || b == b'\n' {
                                    if let Some((t, size)) = parse_ffmpeg_stats(&String::from_utf8_lossy(&line)) {
                                        if let Some(u) = stats.feed(t, size) {
                                            let _ = stats_app.emit(PROGRESS_EVENT, ProgressEvent {
                                                run_id: stats_run.clone(), phase: "download",
                                                percent: Some(u.percent), speed: u.speed, eta: u.eta,
                                            });
                                        }
                                    }
                                    line.clear();
                                } else if line.len() < 4096 {
                                    line.push(b);
                                }
                            }
                            // Only the end of stderr is kept for error messages.
                            if buf.len() > 4 * STDERR_TAIL { buf.drain(..buf.len() - 2 * STDERR_TAIL); }
                        }
                    }
                }
                tail(&String::from_utf8_lossy(&buf), STDERR_TAIL)
            })
        });

        if let Some(out) = child.stdout.take() {
            let mut tracker = ProgressTracker::new();
            let mut processing = false;
            // ffmpeg's machine-readable progress ("-progress pipe:1": key=value
            // lines on stdout), in case this yt-dlp version asks for it.
            let mut kv_progress = section_len.map(SectionProgress::new);
            let mut kv_size: Option<f64> = None;
            for line in BufReader::new(out).split(b'\n').map_while(Result::ok) {
                let text = String::from_utf8_lossy(&line);
                let text = text.trim();
                if let Some(p) = kv_progress.as_mut() {
                    if let Some(v) = text.strip_prefix("total_size=") { kv_size = v.trim().parse().ok(); continue; }
                    if let Some(v) = text.strip_prefix("out_time_us=").or_else(|| text.strip_prefix("out_time_ms=")) {
                        if let Ok(us) = v.trim().parse::<f64>() {
                            if let Some(u) = p.feed(us / 1_000_000.0, kv_size) {
                                let _ = app.emit(PROGRESS_EVENT, ProgressEvent {
                                    run_id: run_id.clone(), phase: "download",
                                    percent: Some(u.percent), speed: u.speed, eta: u.eta,
                                });
                            }
                        }
                        continue;
                    }
                }
                if !processing && PROCESSING_MARKERS.iter().any(|m| text.starts_with(m)) {
                    processing = true;
                    let _ = app.emit(PROGRESS_EVENT, ProgressEvent {
                        run_id: run_id.clone(), phase: "processing",
                        percent: Some(100.0), speed: None, eta: None,
                    });
                    continue;
                }
                // Trimmed: progress comes from ffmpeg (above / stderr), not from
                // yt-dlp's lines (their sizes are for the whole video).
                if section_len.is_some() { continue; }
                if let Some((downloaded, stream_total, whole_total)) = parse_progress(text) {
                    if let Some(u) = tracker.feed(downloaded, stream_total, whole_total) {
                        let _ = app.emit(PROGRESS_EVENT, ProgressEvent {
                            run_id: run_id.clone(), phase: "download",
                            percent: Some(u.percent), speed: u.speed, eta: u.eta,
                        });
                    }
                }
            }
        }

        let status = child.wait();
        let stderr = stderr_reader.and_then(|h| h.join().ok()).unwrap_or_default();
        let cancelled = {
            let mut g = registry.lock();
            g.running.remove(&run_id);
            g.cancelled.remove(&run_id)
        };

        let mut code = status.ok().and_then(|s| s.code());
        let mut stderr = stderr;

        // "Video only": make sure the file really has no audio track. yt-dlp
        // asks for a video-only stream, but when a site (or YouTube in some
        // situations) only offers combined video+audio files it falls back to
        // one of those — so the audio is removed here with a lossless copy.
        if !cancelled && code == Some(0) && opts.format_type == "video_only" {
            let _ = app.emit(PROGRESS_EVENT, ProgressEvent {
                run_id: run_id.clone(), phase: "processing",
                percent: Some(100.0), speed: None, eta: None,
            });
            if let Err(e) = strip_audio(&dir.join(&output_file)) {
                code = Some(1);
                stderr = format!("{stderr}\nffmpeg: could not remove the audio track: {e}");
            }
        }

        // A failed download from cached info (e.g. its stream links expired):
        // the retry reads the link again.
        if info_file.is_some() && !cancelled && code != Some(0) {
            forget_info(&url);
        }

        if cancelled {
            crate::remove_artifacts_except(&dir, &stem, &keep);
        } else if code != Some(0) {
            write_log(
                &app,
                &format!("download failed: {host} [{} .{final_ext}] (exit {code:?})", opts.format_type),
                &stderr,
            );
        }

        Ok(DownloadResult {
            code,
            stderr,
            cancelled,
            output_file,
        })
    })
    .await
}

/// Targets of the downloads currently running (see unique_stem).
static RESERVED_TARGETS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Frees a reserved target when the download ends (any way it ends).
struct Reservation(PathBuf);
impl Drop for Reservation {
    fn drop(&mut self) {
        let mut list = RESERVED_TARGETS.lock().unwrap_or_else(|e| e.into_inner());
        list.retain(|p| p != &self.0);
    }
}

/// "Title", or "Title_(2)", "Title_(3)"… when "Title.<ext>" already exists in
/// the folder or is being written by another download right now. Without this,
/// two different videos with the same title would map to the same file (yt-dlp
/// would then skip the second one as "already downloaded").
fn unique_stem(dir: &Path, stem: &str, ext: &str) -> (String, Reservation) {
    let mut list = RESERVED_TARGETS.lock().unwrap_or_else(|e| e.into_inner());
    let mut n = 1u32;
    loop {
        let candidate = if n == 1 { stem.to_string() } else { format!("{stem}_({n})") };
        let target = dir.join(format!("{candidate}.{ext}"));
        if (!target.exists() && !list.iter().any(|p| same_path(p, &target))) || n >= 999 {
            list.push(target.clone());
            return (candidate, Reservation(target));
        }
        n += 1;
    }
}

/// The exact name, reserved — for "Replace" (the user chose to overwrite the
/// file already in the folder). Still never the target of a running download.
fn exact_stem(dir: &Path, stem: &str, ext: &str) -> (String, Reservation) {
    let target = dir.join(format!("{stem}.{ext}"));
    let busy = {
        let list = RESERVED_TARGETS.lock().unwrap_or_else(|e| e.into_inner());
        list.iter().any(|p| same_path(p, &target))
    };
    if busy {
        return unique_stem(dir, stem, ext);
    }
    let mut list = RESERVED_TARGETS.lock().unwrap_or_else(|e| e.into_inner());
    list.push(target.clone());
    (stem.to_string(), Reservation(target))
}

/// Same file? On Windows and macOS file names ignore upper/lower case, so
/// "Title.mp4" and "title.mp4" are the same file (two downloads writing them
/// at once both failed with "file is being used by another process").
fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(any(windows, target_os = "macos")) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// Removes every audio track from a downloaded video, keeping the video stream
/// and the metadata (signature) untouched — no re-encoding ("-c copy").
/// Uses the bundled ffmpeg (or one on the PATH).
fn strip_audio(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("output file not found".into());
    }
    let ffmpeg = bundled_binary("ffmpeg").unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
    let tmp = path.with_extension(format!("noaudio.{ext}"));
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(path)
        .args(["-map", "0:v", "-map_metadata", "0", "-c", "copy", "-an"])
        .arg(&tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().map_err(|e| format!("could not start ffmpeg: {e}"))?;
    if !out.status.success() || !tmp.is_file() {
        let _ = std::fs::remove_file(&tmp);
        return Err(tail(&String::from_utf8_lossy(&out.stderr), 600));
    }
    // Replace the original (Windows can't rename over an existing file).
    std::fs::remove_file(path).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Cancels one download (kills its process tree). Safe to call before the
/// process exists: the download then stops right before starting.
#[tauri::command]
pub async fn ytdlp_cancel(app: AppHandle, run_id: String) -> Result<bool, String> {
    let pid = {
        let reg = app.state::<Registry>();
        let mut g = reg.lock();
        g.cancelled.insert(run_id.clone());
        g.running.get(&run_id).copied()
    };
    match pid {
        Some(pid) => blocking(move || { kill_tree(pid); Ok(true) }).await,
        None => Ok(false),
    }
}

/// Cancels every running download (closing the app, hot reload).
#[tauri::command]
pub async fn ytdlp_cancel_all(app: AppHandle) -> Result<(), String> {
    blocking(move || { kill_all(&app); Ok(()) }).await
}

// ---------------------------------------------------------------------------
// Command: thumbnail
// ---------------------------------------------------------------------------

/// Builds an EXIF APP1 segment carrying the signature in two tags:
/// ImageDescription (0x010E, ASCII; read by most tools) and XPComment
/// (0x9C9C, UTF-16LE; shown by Windows Explorer under "Comments").
fn exif_app1(comment: &str) -> Vec<u8> {
    let mut ascii: Vec<u8> = comment
        .chars()
        .map(|c| if (c as u32) < 128 { c as u8 } else { b'?' })
        .collect();
    ascii.push(0);
    let mut xp: Vec<u8> = comment.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    xp.extend([0u8, 0u8]);

    let ifd_start: u32 = 8;
    let data_start: u32 = ifd_start + 2 + 2 * 12 + 4;
    let ascii_off = data_start;
    let xp_off = data_start + ascii.len() as u32;

    let mut tiff: Vec<u8> = Vec::new();
    tiff.extend(b"II"); // little-endian
    tiff.extend(42u16.to_le_bytes());
    tiff.extend(ifd_start.to_le_bytes());
    tiff.extend(2u16.to_le_bytes()); // two entries, ascending tag order
    for (tag, kind, len, off) in [
        (0x010Eu16, 2u16, ascii.len() as u32, ascii_off),
        (0x9C9Cu16, 1u16, xp.len() as u32, xp_off),
    ] {
        tiff.extend(tag.to_le_bytes());
        tiff.extend(kind.to_le_bytes());
        tiff.extend(len.to_le_bytes());
        tiff.extend(off.to_le_bytes());
    }
    tiff.extend(0u32.to_le_bytes()); // no next IFD
    tiff.extend(&ascii);
    tiff.extend(&xp);

    let seg_len = (2 + 6 + tiff.len()) as u16;
    let mut app1 = vec![0xFF, 0xE1];
    app1.extend(seg_len.to_be_bytes());
    app1.extend(b"Exif\0\0");
    app1.extend(tiff);
    app1
}

/// Inserts the signature EXIF segment right after a JPEG's SOI marker.
fn embed_signature(bytes: Vec<u8>) -> Vec<u8> {
    if bytes.len() < 2 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return bytes; // not a JPEG
    }
    let app1 = exif_app1(SIGNATURE_COMMENT);
    let mut out = Vec::with_capacity(bytes.len() + app1.len());
    out.extend(&bytes[..2]);
    out.extend(app1);
    out.extend(&bytes[2..]);
    out
}

/// Image type from the file's first bytes (not from the URL).
fn image_ext(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8]) {
        Some("jpg")
    } else if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else if b.len() > 12 && &b[4..8] == b"ftyp" && (&b[8..12] == b"avif" || &b[8..12] == b"avis") {
        Some("avif")
    } else {
        None
    }
}

/// Downloads the first thumbnail that works from `urls` (best first), embeds
/// the signature (JPEG) and saves it as "<directory>/<stem>.<ext>".
/// Works for any site: the request is made here, not by the webview.
/// Returns the saved path (forward slashes).
#[tauri::command]
pub async fn save_thumbnail(urls: Vec<String>, directory: String, stem: String) -> Result<String, String> {
    validate_stem(&stem)?;
    let dir = validate_dir(&directory)?;
    const MAX_BYTES: usize = 25 * 1024 * 1024;

    let client = tauri_plugin_http::reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    for url in urls.iter().take(6) {
        let Ok(url) = validate_url(url) else { continue };
        if !url.to_ascii_lowercase().starts_with("https://") {
            continue;
        }
        let Ok(resp) = client.get(&url).send().await else { continue };
        if !resp.status().is_success() || resp.content_length().is_some_and(|l| l as usize > MAX_BYTES) {
            continue;
        }
        let Ok(body) = resp.bytes().await else { continue };
        // Tiny responses are placeholders / "no image" pictures.
        if body.len() <= 1024 || body.len() > MAX_BYTES {
            continue;
        }
        let Some(ext) = image_ext(&body) else { continue };
        let bytes = embed_signature(body.to_vec());
        let path = dir.join(format!("{stem}.{ext}"));
        let to_write = path.clone();
        blocking(move || std::fs::write(&to_write, bytes).map_err(|e| e.to_string())).await?;
        return Ok(path.to_string_lossy().replace('\\', "/"));
    }
    Err("no thumbnail available".into())
}

// ---------------------------------------------------------------------------
// Command: diagnostics
// ---------------------------------------------------------------------------

/// A plain-text report the user can copy and send when asking for help:
/// versions, which bundled tools were found, and the end of the log file.
/// It contains no links (only site names) and no personal paths beyond the
/// app's own folders.
#[tauri::command]
pub async fn get_diagnostics(app: AppHandle) -> Result<String, String> {
    blocking(move || {
        let found = |name: &str| if bundled_binary(name).is_some() { "bundled" } else { "NOT FOUND" };
        let (ytdlp_version, ytdlp_kind) = match ytdlp_path(&app) {
            Ok(bin) => {
                let v = run_to_end(&bin, &["--version".to_string()])
                    .map(|o| o.stdout.trim().to_string())
                    .unwrap_or_else(|e| format!("error: {e}"));
                let kind = if is_writable_copy(&app, &bin) { "updatable copy" } else { "bundled (read-only)" };
                (v, kind)
            }
            Err(e) => (format!("error: {e}"), "missing"),
        };
        let running = app.state::<Registry>().lock().running.len();
        let log = log_path(&app)
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|l| tail(&clean_log(&l), 6000))
            .filter(|l| !l.trim().is_empty())
            .unwrap_or_else(|| "(empty)".into());

        Ok(format!(
            "Flow Downloader {app_version}\n\
             Generated: {now} UTC\n\
             OS: {os} {arch}\n\
             yt-dlp: {ytdlp_version} ({ytdlp_kind})\n\
             ffmpeg: {ffmpeg}\n\
             deno: {deno}\n\
             Running downloads: {running}\n\
             \n--- Recent log ---\n{log}",
            app_version = app.package_info().version,
            now = utc_now(),
            os = std::env::consts::OS,
            arch = std::env::consts::ARCH,
            ffmpeg = found("ffmpeg"),
            deno = found("deno"),
        ))
    })
    .await
}

#[cfg(test)]
mod tests {

    #[test]
    fn update_versions() {
        assert!(is_newer("2026.08.19", "2026.07.30"));
        assert!(is_newer("2026.08.19.1", "2026.08.19"));
        assert!(is_newer("2027.01.02", "2026.12.31"));
        assert!(!is_newer("2026.08.19", "2026.08.19"));
        assert!(!is_newer("2026.08.19", "2026.09.01"));
        assert!(!is_newer("2026.08.19", "stable@2026.08.19"));
        assert!(!is_newer("garbage", "2026.08.19"));
    }

    #[test]
    fn log_redacts_links() {
        assert_eq!(
            redact_urls("ERROR: Unsupported URL: https://gitlab.com/a/b?x=1 (try again)"),
            "ERROR: Unsupported URL: <gitlab.com link> (try again)"
        );
        assert_eq!(redact_urls("no links here"), "no links here");
    }

    #[test]
    fn log_cleaning() {
        let today = days_ago_date(0);
        let old = days_ago_date(LOG_KEEP_DAYS + 5);
        let raw = format!(
            "[{old} 10:00:00 UTC] download failed: a.com\nERROR: old\n\n\
             [{today} 10:00:00 UTC] analyze failed: gitlab.com (exit Some(1))\nERROR: Unsupported URL: https://gitlab.com/x\n\n\
             [{today} 10:00:01 UTC] download failed: www.youtube.com\nERROR: HTTP Error 403: Forbidden https://x.y/z\n\n\
             [{today} 10:00:02 UTC] download failed: www.youtube.com\nERROR: HTTP Error 403: Forbidden https://x.y/z\n\n"
        );
        let clean = clean_log(&raw);
        assert!(!clean.contains("old"));
        assert!(!clean.contains("gitlab"));
        assert!(clean.contains("<x.y link>"));
        assert_eq!(clean.matches("download failed").count(), 1);
        assert!(clean.contains("repeated 1 more time"));
    }

    #[test]
    fn unique_names() {
        let dir = std::env::temp_dir().join(format!("flow-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Same_Title.mp4"), b"x").unwrap();
        let (a, _ra) = unique_stem(&dir, "Same_Title", "mp4"); // file exists
        let (b, _rb) = unique_stem(&dir, "Same_Title", "mp4"); // "_(2)" is reserved
        let (c, _rc) = unique_stem(&dir, "Other", "mp4");
        assert_eq!(a, "Same_Title_(2)");
        assert_eq!(b, "Same_Title_(3)");
        assert_eq!(c, "Other");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_741), (2026, 10, 15));
    }
    use super::*;

    #[test]
    fn urls() {
        assert!(validate_url("https://example.com/watch?v=1").is_ok());
        assert!(validate_url("--exec calc").is_err());
        assert!(validate_url("https://a.com/ x").is_err());
        assert!(validate_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn stems() {
        assert!(validate_stem("01_My_Video_😀").is_ok());
        assert!(validate_stem("-x").is_err());
        assert!(validate_stem("a/b").is_err());
        assert!(validate_stem("100%").is_err());
    }

    #[test]
    fn hosts_and_dates() {
        assert_eq!(host_of("https://user@www.example.com/watch?v=1"), "www.example.com");
        assert_eq!(utc_now().len(), 19);
    }

    #[test]
    fn waveform_peaks() {
        let mut raw = Vec::new();
        for i in 0..1000i32 { let v: i16 = if i < 500 { 1000 } else { 16000 }; raw.extend_from_slice(&v.to_le_bytes()); }
        let p = wave_peaks(&raw, 10);
        assert_eq!(p.len(), 10);
        assert!((p[9] - 1.0).abs() < 1e-6);
        assert!(p[0] < 0.1);
        assert!(wave_peaks(&[], 10).is_empty());
    }

    #[test]
    fn ffmpeg_stats() {
        let (t, s) = parse_ffmpeg_stats("frame=  120 fps= 30 q=-1.0 size=    2048KiB time=00:01:05.50 bitrate= 256.0kbits/s speed=1.9x").unwrap();
        assert!((t - 65.5).abs() < 1e-9);
        assert_eq!(s, Some(2048.0 * 1024.0));
        let (t, s) = parse_ffmpeg_stats("size=     512kB time=00:00:03.00 bitrate=1398.1kbits/s").unwrap();
        assert!((t - 3.0).abs() < 1e-9);
        assert_eq!(s, Some(512.0 * 1024.0));
        assert!(parse_ffmpeg_stats("Stream mapping:").is_none());
    }

    #[test]
    fn sections() {
        assert!(section_args(None, true).unwrap().is_empty());
        let a = section_args(Some(Section { start: 1.5, end: 10.0 }), true).unwrap();
        assert_eq!(a, vec!["--download-sections", "*1.500-10.000", "--force-keyframes-at-cuts"]);
        assert!(section_args(Some(Section { start: 5.0, end: 5.2 }), false).is_err());
        assert!(section_args(Some(Section { start: -1.0, end: 5.0 }), false).is_err());
        assert!(section_args(Some(Section { start: 0.0, end: f64::NAN }), false).is_err());
    }

    #[test]
    fn progress() {
        let (d, t, w) = parse_progress("[flowprog]50|100|NA|2048|65|400").unwrap();
        assert_eq!((d, t, w), (50.0, Some(100.0), Some(400.0)));
        // Real video + audio sizes win over the whole-size estimate.
        let (_, _, w) = parse_progress("[flowprog]50|100|NA|NA|NA|400|300|200").unwrap();
        assert_eq!(w, Some(500.0));
        let (_, t, w) = parse_progress("[flowprog]50|NA|200|NA|NA|NA").unwrap();
        assert_eq!((t, w), (Some(200.0), None));
        assert_eq!(format_eta(3.0), "< 5 s");
        assert_eq!(format_eta(41.0), "45 s");
        assert_eq!(format_eta(125.0), "2 min 10 s");
        assert_eq!(format_eta(3700.0), "1 h 02 min");
        assert_eq!(format_speed(2.5 * 1024.0 * 1024.0), "2.5 MB/s");
    }
}
