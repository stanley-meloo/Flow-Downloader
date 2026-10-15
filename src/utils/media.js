// Helpers to tell YouTube apart from the other sites yt-dlp supports.
// YouTube thumbnails can be built from the video id (i.ytimg.com); every other
// site must use the thumbnail URL that yt-dlp returns in the metadata.

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export function isYouTubeUrl(url) {
  return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(hostOf(url));
}

// yt-dlp extractor keys: "Youtube", "YoutubeTab" (playlists/channels), ...
export function isYouTubeExtractor(key) {
  return /^youtube/i.test(key || '');
}

// Windows reserved device names (a file can't be called "CON.mp4").
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Sanitizes a title into a safe filename stem. The Rust side validates the same
// rules, so anything this returns is accepted. Cuts by characters (code points),
// never in the middle of an emoji.
export const sanitizeTitle = (raw) => {
  let s = String(raw || 'download')
    .replace(/[\u0000-\u001f\u007f]/g, '') // control characters
    .replace(/[\\/:*?"<>|]/g, '')           // illegal filename chars
    .replace(/%/g, '')                      // yt-dlp output-template syntax
    .replace(/\s+/g, '_')                   // spaces -> underscore
    .replace(/^[.\-]+/, '');                // no leading dots/dashes
  s = Array.from(s).slice(0, 150).join('')
    .replace(/[. ]+$/, '');                 // Windows drops trailing dots/spaces
  if (RESERVED.test(s)) s = `_${s}`;
  return s || 'download';
};

// i.ytimg.com thumbnail for a YouTube video id ("hqdefault" exists for every video).
export function youtubeThumb(id, size = 'hqdefault') {
  return id ? `https://i.ytimg.com/vi/${id}/${size}.jpg` : null;
}

// Watch URL for a YouTube video id (flat playlist entries may lack a url).
export function youtubeWatchUrl(id) {
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
