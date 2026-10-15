import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';
import { downloadDir } from '@tauri-apps/api/path';
import { sanitizeTitle, youtubeThumb } from './media';

/**
 * Saves the best available thumbnail to the Downloads folder and returns its
 * path. For YouTube it tries maxresdefault -> sddefault -> hqdefault first;
 * for every site it then falls back to the URL yt-dlp reported. The download,
 * the signature (EXIF, see SIGNATURE_COMMENT in src-tauri/src/ytdlp.rs) and the
 * write all happen in Rust, so it works for any site. Throws if nothing worked.
 */
export async function saveBestThumbnail({ videoId, isYouTube, fallbackUrl, title }) {
  const urls = [];
  if (isYouTube && videoId) {
    urls.push(youtubeThumb(videoId, 'maxresdefault'), youtubeThumb(videoId, 'sddefault'), youtubeThumb(videoId, 'hqdefault'));
  }
  if (fallbackUrl && !urls.includes(fallbackUrl)) urls.push(fallbackUrl);
  if (urls.length === 0) throw new Error('No thumbnail available');
  return invoke('save_thumbnail', {
    urls,
    directory: await downloadDir(),
    stem: `${sanitizeTitle(title)}_thumb`,
  });
}

/**
 * Reads the clipboard and pastes its text into the search input, with a toast:
 * success when it looks like a URL, otherwise an "invalid" or "empty" notice.
 */
export async function handlePaste(setUrl, showToast) {
  try {
    const clipboardText = await readText();
    
    if (clipboardText && clipboardText.trim().length > 0) {
      setUrl(clipboardText);
      
      if (clipboardText.startsWith('http')) {
        showToast("clipboard_success", "success");
      } else {
        showToast("error_invalid", "error");
      }
    } else {
      showToast("clipboard_empty", "info");
    }
  } catch (err) {
    console.error("Failed to read clipboard:", err);
    showToast("clipboard_error", "error");
  }
}

// Candidate file names for a queue item, most reliable first: the real output
// name reported by Rust, then one rebuilt from the title + extension.
function candidateNames(outputFile, fallbackTitle, fallbackExt) {
  const names = [];
  if (outputFile) names.push(outputFile);
  if (fallbackTitle) names.push(`${sanitizeTitle(fallbackTitle)}.${fallbackExt || 'mp4'}`);
  return names;
}

// The existence check runs in Rust (find_media_file), so it works in any folder
// (another drive, a network share), not only inside the webview's FS scope.
async function findMedia(directory, outputFile, fallbackTitle, fallbackExt) {
  if (!directory) return { file: null, folderExists: false };
  return invoke('find_media_file', {
    directory: directory.replace(/[\\/]+$/, '') || directory,
    names: candidateNames(outputFile, fallbackTitle, fallbackExt),
  });
}

/**
 * Reveals a downloaded file in the OS file manager (Explorer/Finder), with the
 * file highlighted. If the file is gone, opens its folder (and says so).
 */
export async function openMediaLocation(directory, outputFile, fallbackTitle, fallbackExt, showToast) {
  try {
    const { file, folderExists } = await findMedia(directory, outputFile, fallbackTitle, fallbackExt);
    if (file) {
      await revealItemInDir(file);
      return;
    }
    if (folderExists) await revealItemInDir(directory.replace(/[\\/]+$/, '') || directory);
    showToast("open_error", "error");
  } catch (err) {
    console.error("Failed to open file location:", err);
    showToast("open_error", "error");
  }
}

/** Full path of a downloaded file, or null if it can't be found. */
export async function resolveMediaPath(directory, outputFile, fallbackTitle, fallbackExt) {
  try {
    return (await findMedia(directory, outputFile, fallbackTitle, fallbackExt)).file || null;
  } catch {
    return null;
  }
}

/** Opens a media file with its default app, or a folder in the file manager (Rust validates it). */
export async function openPath(path) {
  return invoke('open_media_path', { path });
}
