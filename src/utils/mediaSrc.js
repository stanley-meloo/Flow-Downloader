// Video wallpapers on disk (wallpaper pack, the user's own videos) are played
// through the app's flowmedia:// protocol (Rust actions.rs → media_protocol):
// streamed in small byte ranges like from a media server, instead of reading
// the whole file (up to ~90 MB in 4K) into memory first.
//
// If a system's webview can't play from it (the <video> fires "error"), the
// caller falls back to the old way (whole file → blob URL); streamFailed()
// remembers it for the rest of the session.

import { convertFileSrc } from "@tauri-apps/api/core";

let failed = false;

/** URL that streams a file from the app's wallpaper folders. */
export const streamSrc = (path) => convertFileSrc(path, "flowmedia");

/** Is this URL one of ours? */
export const isStreamSrc = (url) => typeof url === "string" && /^(flowmedia:|https?:\/\/flowmedia\.localhost)/i.test(url);

/** Streaming didn't work here: use blob URLs from now on. */
export const markStreamFailed = () => { failed = true; };

/** Whether streaming is still worth trying. */
export const canStream = () => !failed;
