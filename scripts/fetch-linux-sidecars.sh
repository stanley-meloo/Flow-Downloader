#!/usr/bin/env bash
# Downloads the Linux (x86_64) sidecars that Flow Downloader bundles:
#   yt-dlp  (standalone build, no Python needed)
#   ffmpeg  (static build from yt-dlp's FFmpeg-Builds: works on any distro)
#   deno    (JS runtime yt-dlp uses for some sites)
# and saves them in src-tauri/ with the names Tauri expects for
# `bundle.externalBin` on Linux (tauri.linux.conf.json): flowdl-<name>-x86_64-unknown-linux-gnu.
# The "flowdl-" prefix: Linux packages install them into /usr/bin, where a plain
# "ffmpeg" / "deno" would clash with the system's own packages.
#
# Used by the release workflow (.github/workflows/release.yml) and for local
# Linux builds:   bash scripts/fetch-linux-sidecars.sh
# The files are large and NOT committed (see .gitignore).

set -euo pipefail

TRIPLE="x86_64-unknown-linux-gnu"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
FFMPEG_URL="https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
DENO_URL="https://github.com/denoland/deno/releases/latest/download/deno-${TRIPLE}.zip"

fetch() { curl -fL --retry 3 --retry-delay 2 -o "$2" "$1"; }

echo "→ yt-dlp"
fetch "$YTDLP_URL" "$OUT/flowdl-ytdlp-$TRIPLE"

echo "→ ffmpeg"
fetch "$FFMPEG_URL" "$TMP/ffmpeg.tar.xz"
tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"
cp "$(find "$TMP" -type f -path '*/bin/ffmpeg' | head -n1)" "$OUT/flowdl-ffmpeg-$TRIPLE"

echo "→ deno"
fetch "$DENO_URL" "$TMP/deno.zip"
unzip -o -q "$TMP/deno.zip" -d "$TMP/deno"
cp "$TMP/deno/deno" "$OUT/flowdl-deno-$TRIPLE"

chmod +x "$OUT/flowdl-ytdlp-$TRIPLE" "$OUT/flowdl-ffmpeg-$TRIPLE" "$OUT/flowdl-deno-$TRIPLE"
ls -lh "$OUT"/flowdl-*-"$TRIPLE"
echo "Linux sidecars ready."
