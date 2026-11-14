//! Wallpaper pack: the built-in wallpapers that don't ship inside the app
//! (to keep the installer small). Made by scripts/pack-wallpapers.mjs and
//! uploaded to the GitHub release "wallpapers"; Settings downloads it here
//! into <app data>/wallpaper-pack, and the frontend (utils/backgrounds.js)
//! adds its wallpapers to the galleries.
//!   - wallpaper_pack_local: the downloaded pack (folder + manifest + which
//!     files are there), if any
//!   - download_wallpaper_pack: downloads / updates it (only missing or
//!     changed files), with "wallpaper-pack-progress" events
//!   - cancel_wallpaper_pack: stops a download (what's done is kept)
//!
//! Each gallery downloads only its own part: `category` "GIFs" (animated) or
//! "JPGs" (images) — pack file names start with "<category>--". Files of the
//! other part are left as they are.
//!
//! Which sizes are downloaded depends on the user's screen: on a screen bigger
//! than Full HD (any monitor taller than 1080 or wider than 1920 physical
//! pixels) every video also gets its biggest version (4K); otherwise only the
//! Full HD one. Thumbnails, previews and images are always downloaded.
//!
//! Integrity: every file in the manifest has its SHA-256. A download is
//! hashed while it streams and thrown away if the hash doesn't match (a
//! corrupted or tampered file never lands in the pack). Files already checked
//! are remembered in `verified.json` (name → hash), so an update only
//! re-downloads what changed, without re-hashing the whole pack.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// Where the pack's files are published (fixed here, not sent by the webview).
const PACK_URL: &str = "https://github.com/stanley-meloo/Flow-Downloader/releases/download/wallpapers/";
const MANIFEST: &str = "manifest.json";
const VERIFIED: &str = "verified.json";
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 300 * 1024 * 1024;

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(serde::Deserialize)]
struct FileEntry {
    size: u64,
    sha256: String,
}

#[derive(serde::Deserialize)]
struct Manifest {
    files: HashMap<String, FileEntry>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalPack {
    /// Folder holding the files (forward slashes).
    dir: String,
    /// manifest.json as text (parsed by the frontend).
    manifest: String,
    /// Names of the pack files present on disk (a video's 4K version is only
    /// there on big screens): the frontend only offers what exists.
    files: Vec<String>,
    /// Galleries ("GIFs" / "JPGs") whose download was started but not finished
    /// (canceled or failed): their wallpapers done so far are shown, and the
    /// download button stays so the rest can be fetched.
    incomplete: Vec<String>,
}

/// Marker file "<dir>/.incomplete-<category>": written when a gallery's
/// download starts, removed when it finishes.
const INCOMPLETE: &str = ".incomplete-";
const PARTS: [&str; 2] = ["GIFs", "JPGs"];

/// One more file of the pack is on disk and verified (the frontend adds the
/// wallpapers that are now complete to the galleries right away).
#[derive(serde::Serialize, Clone)]
struct FileDone {
    name: String,
}

#[derive(serde::Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
}

fn pack_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("wallpaper-pack"))
}

/// Plain file names only (no folders, no "..").
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.@".contains(c))
}

fn valid_hash(h: &str) -> bool {
    h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

fn local(dir: &PathBuf) -> Option<LocalPack> {
    let manifest = std::fs::read_to_string(dir.join(MANIFEST)).ok()?;
    let files = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n != MANIFEST && n != VERIFIED && !n.ends_with(".part") && !n.starts_with(INCOMPLETE))
                .collect()
        })
        .unwrap_or_default();
    let incomplete = PARTS
        .iter()
        .filter(|c| dir.join(format!("{INCOMPLETE}{c}")).exists())
        .map(|c| c.to_string())
        .collect();
    Some(LocalPack { dir: dir.to_string_lossy().replace('\\', "/"), manifest, files, incomplete })
}

/// The downloaded pack, or None.
#[tauri::command]
pub fn wallpaper_pack_local(app: AppHandle) -> Result<Option<LocalPack>, String> {
    Ok(local(&pack_dir(&app)?))
}

#[tauri::command]
pub fn cancel_wallpaper_pack() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// A screen bigger than Full HD on any monitor (physical pixels, so a 4K
/// screen at 150 % scaling counts as 4K).
fn wants_4k(app: &AppHandle) -> bool {
    app.available_monitors()
        .map(|list| list.iter().any(|m| m.size().height > 1080 || m.size().width > 1920))
        .unwrap_or(false)
}

/// "<base>@<height>.mp4" → (base, height).
fn tier_of(name: &str) -> Option<(&str, u32)> {
    let stem = name.strip_suffix(".mp4")?;
    let (base, h) = stem.rsplit_once('@')?;
    Some((base, h.parse().ok()?))
}

/// The files to have for this screen: everything that isn't a bigger video
/// version, plus — on a screen above Full HD — the biggest version of each video.
fn selected(files: &HashMap<String, FileEntry>, big_screen: bool) -> HashSet<String> {
    let mut keep: HashSet<String> = files.keys().filter(|n| tier_of(n).is_none()).cloned().collect();
    if big_screen {
        let mut best: HashMap<&str, (u32, &String)> = HashMap::new();
        for name in files.keys() {
            if let Some((base, h)) = tier_of(name) {
                if best.get(base).map_or(true, |(bh, _)| h > *bh) {
                    best.insert(base, (h, name));
                }
            }
        }
        keep.extend(best.into_values().map(|(_, n)| n.clone()));
    }
    keep
}

/// Downloads the pack (or what's missing / changed in it). The manifest is
/// written first, so each wallpaper shows up as soon as its files are there;
/// a gallery counts as fully downloaded once its ".incomplete-" marker is gone.
#[tauri::command]
pub async fn download_wallpaper_pack(app: AppHandle, category: Option<String>) -> Result<LocalPack, String> {
    let category = match category.as_deref() {
        None | Some("") => None,
        Some(c @ ("GIFs" | "JPGs")) => Some(format!("{c}--")),
        Some(_) => return Err("invalid category".into()),
    };
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("already downloading".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let result = download(&app, category.as_deref()).await;
    BUSY.store(false, Ordering::SeqCst);
    result
}

async fn download(app: &AppHandle, prefix: Option<&str>) -> Result<LocalPack, String> {
    let dir = pack_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let client = tauri_plugin_http::reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(format!("{PACK_URL}{MANIFEST}")).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if text.len() > MAX_MANIFEST_BYTES {
        return Err("manifest too large".into());
    }
    let manifest: Manifest = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if manifest.files.iter().any(|(n, f)| {
        !safe_name(n) || n == MANIFEST || n == VERIFIED || f.size > MAX_FILE_BYTES || !valid_hash(&f.sha256)
    }) {
        return Err("invalid manifest".into());
    }

    // This gallery's files (or the whole pack without a category).
    let in_part = |n: &str| prefix.map_or(true, |p| n.starts_with(p));
    let wanted: HashSet<String> = selected(&manifest.files, wants_4k(app))
        .into_iter()
        .filter(|n| in_part(n.as_str()))
        .collect();

    // Manifest now (wallpapers appear one by one while downloading) and this
    // gallery marked unfinished until the end.
    std::fs::write(dir.join(MANIFEST), &text).map_err(|e| e.to_string())?;
    let parts: Vec<&str> = PARTS.iter().copied().filter(|c| prefix.map_or(true, |p| p.starts_with(c))).collect();
    for c in &parts {
        let _ = std::fs::write(dir.join(format!("{INCOMPLETE}{c}")), b"");
    }

    // Files already downloaded and checked (name → hash).
    let mut verified: HashMap<String, String> = std::fs::read_to_string(dir.join(VERIFIED))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let save_verified = |v: &HashMap<String, String>| {
        if let Ok(t) = serde_json::to_string(v) {
            let _ = std::fs::write(dir.join(VERIFIED), t);
        }
    };
    let is_done = |name: &str, f: &FileEntry, v: &HashMap<String, String>| {
        v.get(name).map_or(false, |h| h.eq_ignore_ascii_case(&f.sha256))
            && std::fs::metadata(dir.join(name)).map_or(false, |m| m.len() == f.size)
    };

    let total: u64 = wanted.iter().map(|n| manifest.files[n].size).sum();
    let mut done: u64 = wanted
        .iter()
        .filter(|n| is_done(n.as_str(), &manifest.files[*n], &verified))
        .map(|n| manifest.files[n].size)
        .sum();
    let _ = app.emit("wallpaper-pack-progress", Progress { done, total });
    let mut last_emit = Instant::now();

    // Order: every thumbnail / preview first (small: the cards can show as
    // soon as their wallpaper arrives), then the Full HD wallpapers one by one
    // (each completes a card), then the big 1440p / 4K versions.
    let rank = |n: &str| if tier_of(n).is_some() { 2 } else if n.contains(".thumb.") || n.contains(".preview.") { 0 } else { 1 };
    let mut names: Vec<&String> = wanted.iter().collect();
    names.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.cmp(b)));
    for name in names {
        let entry = &manifest.files[name];
        if is_done(name.as_str(), entry, &verified) {
            continue;
        }
        let resp = client.get(format!("{PACK_URL}{name}")).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("{name}: http {}", resp.status()));
        }
        let part = dir.join(format!("{name}.part"));
        let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut resp = resp;
        let mut hasher = Sha256::new();
        let mut got: u64 = 0;
        loop {
            if CANCEL.load(Ordering::SeqCst) {
                drop(file);
                let _ = std::fs::remove_file(&part);
                save_verified(&verified);
                return Err("canceled".into());
            }
            let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? else { break };
            got += chunk.len() as u64;
            if got > entry.size {
                drop(file);
                let _ = std::fs::remove_file(&part);
                return Err(format!("{name}: bigger than expected"));
            }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            done += chunk.len() as u64;
            if last_emit.elapsed() >= Duration::from_millis(200) {
                last_emit = Instant::now();
                let _ = app.emit("wallpaper-pack-progress", Progress { done, total });
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if got != entry.size || !hash.eq_ignore_ascii_case(&entry.sha256) {
            let _ = std::fs::remove_file(&part);
            save_verified(&verified);
            return Err(format!("{name}: {}", if got != entry.size { "incomplete download" } else { "checksum mismatch" }));
        }
        std::fs::rename(&part, dir.join(name)).map_err(|e| e.to_string())?;
        verified.insert(name.clone(), hash);
        save_verified(&verified);
        let _ = app.emit("wallpaper-pack-file", FileDone { name: name.clone() });
    }

    // Files no longer wanted: removed from the pack, or a 4K version on a
    // screen that doesn't need it (anymore).
    // Only inside this gallery's part: the other part is left untouched
    // (except files no longer in the pack at all).
    let stale = |n: &str| !manifest.files.contains_key(n) || (in_part(n) && !wanted.contains(n));
    verified.retain(|n, _| !stale(n.as_str()));
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name != MANIFEST && name != VERIFIED && !name.starts_with(INCOMPLETE) && stale(name.as_str()) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    save_verified(&verified);
    for c in &parts {
        let _ = std::fs::remove_file(dir.join(format!("{INCOMPLETE}{c}")));
    }
    let _ = app.emit("wallpaper-pack-progress", Progress { done: total, total });
    local(&dir).ok_or_else(|| "pack not saved".into())
}
