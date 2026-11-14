// Optimizes the built-in wallpapers (step 1 of `npm run optimize-wallpapers`;
// step 2, scripts/pack-wallpapers.mjs, splits them between the app and the
// downloadable wallpaper pack).
//
//   assets-src/backgrounds/<folder>/*  original files (GIF/JPG/PNG/...), NOT bundled
//   wallpapers-build/<folder>/*        optimized files (not committed)
//   wallpapers-build/_thumbs/...       small still previews for the Settings gallery
//   wallpapers-build/_previews/...     small ANIMATED previews (GIFs only),
//                                      played while hovering a card in Settings
//   wallpapers-build/_hd/<h>/...       bigger versions of the video wallpapers
//
// Folders: "GIFs" (animated), "JPGs" (static).
// - Stills  -> WebP, at most 2560x1440.
// - GIFs    -> animated WebP, at most 1280 px wide (kept as GIF if that is smaller).
// - Thumbs  -> first frame, 320x180 WebP.
// - Previews (GIFs) -> animated 320x180 WebP, about the size the card shows.
// - MP4 loops (GIFs folder, from motionbgs.com) -> H.264 MP4 (no audio,
//   "faststart", at most 30 fps) in up to three sizes; the app plays the
//   smallest one that still fills the window pixel for pixel (utils/videoTiers):
//     GIFs/<name>.mp4           <= 1920x1080 (always)
//     _hd/1440/GIFs/<name>.mp4  <= 2560x1440 (if the source is bigger than 1080p)
//     _hd/2160/GIFs/<name>.mp4  <= 3840x2160 (if the source is bigger than 1440p)
//   Small H.264 files are kept as is when re-encoding isn't smaller; thumb =
//   a frame at 0.5 s. No preview file: the gallery plays the video itself.
//   Needs ffmpeg: $FFMPEG, the one on the PATH, or the app's bundled sidecar.
//
// Usage: add/remove originals in assets-src/backgrounds/<folder>, then run
//   npm run optimize-wallpapers
// Only new or changed files are processed; outputs whose original was removed
// are deleted. On the first run, originals still sitting in src/assets are
// moved to assets-src automatically.

import sharp from 'sharp';
import { promises as fs, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src', 'backgrounds');
const OUT = path.join(ROOT, 'wallpapers-build');
// Where the optimized files used to be written (and the bundled ones are copied to).
const ASSETS = path.join(ROOT, 'src', 'assets', 'backgrounds');
const THUMBS = path.join(OUT, '_thumbs');
const PREVIEWS = path.join(OUT, '_previews');
const HD = path.join(OUT, '_hd');
const FOLDERS = ['GIFs', 'JPGs'];
const INPUT_EXT = /\.(gif|jpe?g|png|webp|avif|tiff?|mp4)$/i;
const OUTPUT_EXT = /\.(webp|gif|mp4)$/i;

// ffmpeg for the video wallpapers: $FFMPEG, then the app's own sidecar for
// this system, then "ffmpeg" on the PATH.
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const tauri = path.join(ROOT, 'src-tauri');
  const candidates = {
    win32: ['ffmpeg-x86_64-pc-windows-msvc.exe'],
    darwin: [process.arch === 'arm64' ? 'ffmpeg-aarch64-apple-darwin' : 'ffmpeg-x86_64-apple-darwin'],
    linux: ['flowdl-ffmpeg-x86_64-unknown-linux-gnu'],
  }[process.platform] || [];
  return candidates.map((n) => path.join(tauri, n)).find((p) => existsSync(p)) || 'ffmpeg';
}
const ffmpeg = (args) => execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });

// Video wallpapers: the base file is capped at 1080p / 30 fps; bigger sources
// also get 1440p / 2160p versions (_hd/), and the app picks the size that
// matches the window's real pixels — a 4K screen in full screen gets 4K, a
// normal window doesn't pay for decoding 4K non-stop. Sources above a cap (or
// not H.264, e.g. HEVC, which webviews can't always play) are re-encoded;
// small H.264 files are kept as is when that is smaller.
const VIDEO_MAX_W = 1920;
const VIDEO_MAX_H = 1080;
const VIDEO_MAX_FPS = 30;
const VIDEO_CRF = '23'; // higher-quality sources: keep the detail at 1080p

// Codec, size and frame rate, read from ffmpeg's own report (no ffprobe needed).
function probeVideo(input) {
  let report = '';
  try {
    execFileSync(ffmpegPath(), ['-hide_banner', '-i', input], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    report = String(err.stderr || ''); // "-i" alone exits with an error but still prints the info
  }
  const line = report.split('\n').find((l) => /Stream #.*Video:/.test(l)) || '';
  const size = line.match(/, (\d{2,5})x(\d{2,5})/);
  const fps = line.match(/([\d.]+) fps/);
  return {
    codec: (line.match(/Video: (\w+)/) || [])[1] || '',
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: fps ? Number(fps[1]) : 0,
  };
}

// Returns the path written (<outBase>.mp4).
async function optimizeVideo(input, outBase) {
  const out = `${outBase}.mp4`;
  const tmp = `${outBase}.tmp.mp4`;
  const info = probeVideo(input);
  const filters = [
    // Only shrinks (never upscales), keeps the aspect ratio, even dimensions for H.264.
    `scale='min(${VIDEO_MAX_W},iw)':'min(${VIDEO_MAX_H},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
  ];
  if (!info.fps || info.fps > VIDEO_MAX_FPS + 0.5) filters.push(`fps=${VIDEO_MAX_FPS}`);
  ffmpeg(['-i', input, '-an', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'slow', '-crf', VIDEO_CRF,
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', tmp]);
  const withinLimits = info.codec === 'h264' && info.width > 0 && info.width <= VIDEO_MAX_W &&
    info.height <= VIDEO_MAX_H && info.fps > 0 && info.fps <= VIDEO_MAX_FPS + 0.5;
  if (!withinLimits || (await fs.stat(tmp)).size < (await fs.stat(input)).size) {
    await fs.rename(tmp, out);
  } else {
    await fs.rm(tmp);
    ffmpeg(['-i', input, '-an', '-c:v', 'copy', '-movflags', '+faststart', out]);
  }
  return out;
}

// Bigger versions of a video wallpaper (see the header). `prevH` = the size
// below it: a version is only made when the source is bigger than that.
const VIDEO_TIERS = [{ w: 2560, h: 1440, prevH: 1080 }, { w: 3840, h: 2160, prevH: 1440 }];
const tierPath = (tier, folder, stem) => path.join(HD, String(tier.h), folder, `${stem}.mp4`);

// Makes / refreshes / removes the bigger versions of one video. Returns their total size.
async function optimizeVideoTiers(input, folder, stem) {
  const srcTime = await mtime(input);
  let info = null;
  let total = 0;
  for (const tier of VIDEO_TIERS) {
    const out = tierPath(tier, folder, stem);
    info ??= probeVideo(input);
    // The size it covers on a 16:9 screen (a wide video counts by its width).
    const coverH = Math.max(info.height, (info.width * 9) / 16);
    if (coverH <= tier.prevH + 8) {
      await fs.rm(out, { force: true });
      continue;
    }
    if (!(await exists(out)) || (await mtime(out)) < srcTime) {
      await fs.mkdir(path.dirname(out), { recursive: true });
      const keep = info.codec === 'h264' && info.width <= tier.w && info.height <= tier.h &&
        info.fps > 0 && info.fps <= VIDEO_MAX_FPS + 0.5;
      if (keep) {
        // Already the right size: just remux (no audio, "faststart").
        ffmpeg(['-i', input, '-an', '-c:v', 'copy', '-movflags', '+faststart', out]);
      } else {
        const filters = [`scale='min(${tier.w},iw)':'min(${tier.h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`];
        if (!info.fps || info.fps > VIDEO_MAX_FPS + 0.5) filters.push(`fps=${VIDEO_MAX_FPS}`);
        ffmpeg(['-i', input, '-an', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', VIDEO_CRF,
          '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', out]);
      }
      console.log(`optimized ${tier.h}p  ${folder}/${stem}.mp4  ${kb((await fs.stat(out)).size)}`);
    }
    total += (await fs.stat(out)).size;
  }
  return total;
}

function makeVideoThumb(input, output) {
  ffmpeg(['-ss', '0.5', '-i', input, '-frames:v', '1',
    '-vf', 'scale=320:180:force_original_aspect_ratio=increase,crop=320:180', '-c:v', 'libwebp', '-quality', '70', output]);
}

const exists = (p) => fs.access(p).then(() => true, () => false);
const mtime = async (p) => (await fs.stat(p)).mtimeMs;
const kb = (n) => `${Math.round(n / 1024)} KB`;

// Optimized files from before wallpapers-build existed (all in src/assets) are
// moved there once, so nothing has to be encoded again.
async function migrateBuild() {
  if ((await exists(OUT)) || !(await exists(ASSETS))) return;
  await fs.mkdir(OUT, { recursive: true });
  for (const name of await fs.readdir(ASSETS)) {
    if (/\.txt$/i.test(name)) continue;
    await fs.rename(path.join(ASSETS, name), path.join(OUT, name));
  }
  console.log('moved the optimized wallpapers to wallpapers-build/');
}

// First run: move originals out of src/assets so they are no longer bundled.
async function migrateOriginals() {
  for (const folder of FOLDERS) {
    const dir = path.join(ASSETS, folder);
    if (!(await exists(dir))) continue;
    for (const name of await fs.readdir(dir)) {
      if (!INPUT_EXT.test(name)) continue;
      const optimizedOutput = /\.webp$/i.test(name) ||
        (/\.(gif|mp4)$/i.test(name) && await exists(path.join(SRC, folder, name)));
      if (optimizedOutput) continue;
      await fs.mkdir(path.join(SRC, folder), { recursive: true });
      await fs.rename(path.join(dir, name), path.join(SRC, folder, name));
      console.log(`moved original  ${folder}/${name} -> assets-src`);
    }
  }
}

async function optimizeStill(input, output) {
  await sharp(input)
    .rotate()
    .resize({ width: 2560, height: 1440, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(output);
}

// Returns the path actually written (.webp, or .gif when the GIF is smaller).
async function optimizeAnimated(input, outBase) {
  const webp = `${outBase}.webp`;
  await sharp(input, { animated: true, limitInputPixels: false })
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 72, effort: 5, loop: 0 })
    .toFile(webp);
  const [orig, opt] = await Promise.all([fs.stat(input), fs.stat(webp)]);
  if (opt.size >= orig.size) {
    await fs.rm(webp);
    const gif = `${outBase}.gif`;
    await fs.copyFile(input, gif);
    return gif;
  }
  return webp;
}

async function makeThumb(input, output) {
  await sharp(input, { pages: 1 })
    .resize(320, 180, { fit: 'cover' })
    .webp({ quality: 70 })
    .toFile(output);
}

async function makePreview(input, output) {
  await sharp(input, { animated: true, limitInputPixels: false })
    .resize(320, 180, { fit: 'cover' })
    .webp({ quality: 60, effort: 5, loop: 0 })
    .toFile(output);
}

async function main() {
  await migrateOriginals();
  await migrateBuild();
  let before = 0;
  let after = 0;

  for (const folder of FOLDERS) {
    const srcDir = path.join(SRC, folder);
    const outDir = path.join(OUT, folder);
    const thumbDir = path.join(THUMBS, folder);
    const previewDir = path.join(PREVIEWS, folder);
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });

    const originals = (await exists(srcDir)) ? (await fs.readdir(srcDir)).filter((n) => INPUT_EXT.test(n)) : [];
    const stems = new Set();

    for (const name of originals) {
      const input = path.join(srcDir, name);
      const stem = name.replace(/\.[^.]+$/, '');
      stems.add(stem);
      const animated = /\.gif$/i.test(name);
      const video = /\.mp4$/i.test(name);
      const outBase = path.join(outDir, stem);
      const thumb = path.join(thumbDir, `${stem}.webp`);

      const existing = video ? [`${outBase}.mp4`] : [`${outBase}.webp`, `${outBase}.gif`];
      const current = (await Promise.all(existing.map(exists))).findIndex(Boolean);
      const srcTime = await mtime(input);
      const upToDate = current >= 0 && (await mtime(existing[current])) >= srcTime &&
        (await exists(thumb)) && (await mtime(thumb)) >= srcTime;

      // Animated preview for the gallery hover (GIFs only).
      if (animated) {
        const preview = path.join(previewDir, `${stem}.webp`);
        if (!(await exists(preview)) || (await mtime(preview)) < srcTime) {
          await fs.mkdir(previewDir, { recursive: true });
          await makePreview(input, preview);
          console.log(`preview         ${folder}/${stem}.webp  ${kb((await fs.stat(preview)).size)}`);
        }
      }

      let written = current >= 0 ? existing[current] : null;
      if (!upToDate) {
        for (const p of existing) await fs.rm(p, { force: true });
        if (video) {
          written = await optimizeVideo(input, outBase);
          makeVideoThumb(input, thumb);
        } else {
          written = animated ? await optimizeAnimated(input, outBase) : (await optimizeStill(input, `${outBase}.webp`), `${outBase}.webp`);
          await makeThumb(input, thumb);
        }
        console.log(`optimized       ${folder}/${name}  ${kb((await fs.stat(input)).size)} -> ${kb((await fs.stat(written)).size)}`);
      }
      before += (await fs.stat(input)).size;
      after += (await fs.stat(written)).size;
      if (video) after += await optimizeVideoTiers(input, folder, stem);
    }

    // Remove outputs whose original no longer exists.
    for (const dir of [outDir, thumbDir, previewDir, ...VIDEO_TIERS.map((t) => path.join(HD, String(t.h), folder))]) {
      if (!(await exists(dir))) continue;
      for (const name of await fs.readdir(dir)) {
        if (!OUTPUT_EXT.test(name)) continue;
        if (!stems.has(name.replace(/\.[^.]+$/, ''))) {
          await fs.rm(path.join(dir, name));
          console.log(`removed stale   ${path.relative(OUT, path.join(dir, name))}`);
        }
      }
    }
  }

  console.log(`\nWallpapers: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
