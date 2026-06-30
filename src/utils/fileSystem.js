import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { exists } from '@tauri-apps/plugin-fs';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { fetch } from '@tauri-apps/plugin-http';

// Digital signature embedded in every downloaded file (video/audio via ffmpeg in
// useDownloader; images via a JPEG comment marker, below).
// >>> Replace the URL below with your own GitHub repository <<<
export const SIGNATURE_COMMENT = 'Downloaded with Flow Downloader - https://github.com/stanley-meloo/Flow-Downloader';

// Builds an EXIF APP1 segment carrying the signature in two tags:
//   - ImageDescription (0x010E, ASCII)  -> read by most image tools / exiftool
//   - XPComment        (0x9C9C, UTF-16) -> what Windows Explorer shows under
//                                          Properties > Details > "Comments"
// We use both so the signature is visible in Windows AND in cross-platform tools.
// Little-endian ("II") TIFF; IFD entries must be ordered by ascending tag id.
function buildExifApp1(comment) {
  // ImageDescription as ASCII (non-ASCII chars degraded to '?'), null-terminated.
  const ascii = [];
  for (let i = 0; i < comment.length; i++) {
    const c = comment.charCodeAt(i);
    ascii.push(c < 128 ? c : 0x3F);
  }
  ascii.push(0);
  const asciiBytes = new Uint8Array(ascii);

  // XPComment as UTF-16LE, null-terminated (the format Windows expects).
  const u16 = [];
  for (let i = 0; i < comment.length; i++) {
    const c = comment.charCodeAt(i);
    u16.push(c & 0xFF, (c >> 8) & 0xFF);
  }
  u16.push(0, 0);
  const xpBytes = new Uint8Array(u16);

  const numEntries = 2;
  const ifdStart = 8;                              // right after the 8-byte TIFF header
  const ifdSize = 2 + numEntries * 12 + 4;         // count + entries + next-IFD offset
  const dataStart = ifdStart + ifdSize;            // value data for entries that don't fit in 4 bytes
  const asciiOffset = dataStart;
  const xpOffset = dataStart + asciiBytes.length;
  const tiffLength = dataStart + asciiBytes.length + xpBytes.length;

  const tiff = new Uint8Array(tiffLength);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x49; tiff[1] = 0x49;                  // 'II' = little-endian
  dv.setUint16(2, 0x002A, true);                  // TIFF magic (42)
  dv.setUint32(4, ifdStart, true);                // offset to IFD0

  let p = ifdStart;
  dv.setUint16(p, numEntries, true); p += 2;
  // ImageDescription (0x010E), type 2 = ASCII
  dv.setUint16(p, 0x010E, true); p += 2;
  dv.setUint16(p, 2, true); p += 2;
  dv.setUint32(p, asciiBytes.length, true); p += 4;
  dv.setUint32(p, asciiOffset, true); p += 4;
  // XPComment (0x9C9C), type 1 = BYTE
  dv.setUint16(p, 0x9C9C, true); p += 2;
  dv.setUint16(p, 1, true); p += 2;
  dv.setUint32(p, xpBytes.length, true); p += 4;
  dv.setUint32(p, xpOffset, true); p += 4;
  dv.setUint32(p, 0, true); p += 4;               // next IFD = none
  tiff.set(asciiBytes, asciiOffset);
  tiff.set(xpBytes, xpOffset);

  // Wrap the TIFF block in an APP1 segment: FFE1 + length + "Exif\0\0" + TIFF.
  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segLen = 2 + exifHeader.length + tiff.length; // length field counts itself
  const app1 = new Uint8Array(2 + segLen);
  app1[0] = 0xFF; app1[1] = 0xE1;
  app1[2] = (segLen >> 8) & 0xFF; app1[3] = segLen & 0xFF;
  app1.set(exifHeader, 4);
  app1.set(tiff, 4 + exifHeader.length);
  return app1;
}

// Embeds the signature into a JPEG's EXIF metadata by inserting an APP1 segment
// right after the SOI. Non-JPEG inputs (webp/png/...) are returned unchanged.
// Never throws — a failure here must never break a thumbnail download.
function embedJpegComment(bytes, comment) {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 2 || u8[0] !== 0xFF || u8[1] !== 0xD8) return u8; // not a JPEG (no SOI)
    const app1 = buildExifApp1(comment);
    if (app1.length > 0xFFFF + 2) return u8;       // would overflow a single segment
    const out = new Uint8Array(u8.length + app1.length);
    out.set(u8.subarray(0, 2), 0);                 // keep the SOI (FF D8) first
    out.set(app1, 2);                              // EXIF APP1 immediately after the SOI
    out.set(u8.subarray(2), 2 + app1.length);      // then the rest of the original file
    return out;
  } catch (e) {
    return bytes; // on any error, return the original bytes untouched
  }
}

/**
 * Fetches the highest-resolution thumbnail available for a YouTube video id.
 * Tries maxresdefault (1280x720+) -> sddefault (640x480) -> hqdefault (480x360),
 * each of which 404s when unavailable, and finally falls back to the URL yt-dlp
 * provided. Returns { bytes, ext } or throws if nothing could be fetched.
 */
export async function fetchBestThumbnail(videoId, fallbackUrl) {
  const candidates = [];
  if (videoId) {
    candidates.push(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
    candidates.push(`https://i.ytimg.com/vi/${videoId}/sddefault.jpg`);
    candidates.push(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  }
  if (fallbackUrl) candidates.push(fallbackUrl);

  for (const url of candidates) {
    try {
      const r = await fetch(url, { method: 'GET', connectTimeout: 30000 });
      if (r && r.ok) {
        const buffer = await r.arrayBuffer();
        if (buffer && buffer.byteLength > 1024) { // ignore tiny 404/placeholder images
          const lower = url.toLowerCase();
          const ext = lower.includes('.webp') ? 'webp' : lower.includes('.png') ? 'png' : 'jpg';
          // Embed the signature into the JPEG (non-JPEG formats pass through unchanged).
          return { bytes: embedJpegComment(new Uint8Array(buffer), SIGNATURE_COMMENT), ext };
        }
      }
    } catch (e) { /* try the next candidate */ }
  }
  throw new Error('No thumbnail available');
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

/**
 * Reveals a downloaded file in the OS file manager (Explorer/Finder), highlighting
 * the file when possible. It tries, in order of confidence:
 *   1. the predicted output filename (outputFile),
 *   2. a name rebuilt from the title + extension,
 *   3. and finally just opens the containing folder.
 * Shows an error toast only if nothing could be opened.
 */
export async function openMediaLocation(directory, outputFile, fallbackTitle, fallbackExt, showToast) {
  try {
    const cleanDir = directory.endsWith('/') || directory.endsWith('\\')
      ? directory.slice(0, -1)
      : directory;

    // Candidate filenames, most reliable first.
    const candidates = [];
    if (outputFile) candidates.push(outputFile);
    if (fallbackTitle) {
      const safeTitle = String(fallbackTitle)
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/%/g, "")
        .replace(/\s+/g, "_")
        .replace(/^[.\-]+/, "");
      candidates.push(`${safeTitle}.${fallbackExt || 'mp4'}`);
    }

    for (const name of candidates) {
      const fullPath = `${cleanDir}/${name}`;
      try {
        if (await exists(fullPath)) {
          await revealItemInDir(fullPath);
          return;
        }
      } catch (e) { /* outside the allowed FS scope — try the next candidate */ }
    }

    // File not found: fall back to opening the containing folder.
    try {
      if (await exists(cleanDir)) {
        await revealItemInDir(cleanDir);
        showToast("open_error", "error");
        return;
      }
    } catch (e) { /* ignore */ }

    console.warn("File/folder not found:", cleanDir);
    showToast("open_error", "error");

  } catch (err) {
    console.error("Failed to open file location:", err);
    showToast("open_error", "error");
  }
}