// Step 2 of `npm run optimize-wallpapers`: splits the optimized wallpapers
// (wallpapers-build/, made by optimize-wallpapers.mjs) between
//   - the app: the few in BUNDLED, copied to src/assets/backgrounds/ (same
//     layout as wallpapers-build), so the installer stays small;
//   - the wallpaper pack: all the others, as flat files + manifest.json in
//     wallpaper-pack/, uploaded to the GitHub release "wallpapers". The app
//     downloads it from Settings (Rust download_wallpaper_pack) and its
//     wallpapers show up in the galleries next to the built-in ones.
//
// Pack file names (flat: release assets can't have folders), for a wallpaper
// <folder>/<name>:
//   <folder>--<name>.<mp4|webp|gif>   the wallpaper (videos: the <= 1080p one)
//   <folder>--<name>@1440.mp4         bigger versions of a video (if any)
//   <folder>--<name>@2160.mp4
//   <folder>--<name>.thumb.webp       gallery thumbnail
//   <folder>--<name>.preview.webp     animated hover preview (GIFs only)
// manifest.json lists every file with its size and SHA-256. The app downloads
// the Full HD files on screens up to 1080p, plus each video's biggest version
// (4K) on bigger screens — never the in-between sizes.
//
// After it runs, upload the pack (replaces the files already there):
//   gh release upload wallpapers wallpaper-pack/* --clobber
// (first time: gh release create wallpapers --title "Wallpaper pack" --notes "Wallpapers downloaded from Settings")

import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The wallpapers that ship inside the app ("<folder>/<name>", no extension).
// Only their Full HD version ships; their bigger versions (1440p / 4K) go to
// the pack as "builtin" entries (downloaded on big screens only), so the
// installer stays small.
export const BUNDLED = [
  'GIFs/adventure',
  'GIFs/beneath-falling-stars',
  'GIFs/bus-stop-pixel',
  'GIFs/cat-girl',
  'GIFs/chasing-freedom-at-sunset',
  'GIFs/dream-girl',
  'GIFs/pixel-rain-traffic',
  'GIFs/sleeping-dogs',
  'GIFs/the-forgotten-boat',
  'JPGs/aloha',
  'JPGs/can-we-deep-dive-here',
  'JPGs/edge-of-life',
  'JPGs/i-like-green',
  'JPGs/its-tiiiiime',
  'JPGs/peaceful-cold',
  'JPGs/peace-or-chaos',
  'JPGs/she-is-prettier-than-this',
  'JPGs/thats-what-i-call-living',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'wallpapers-build');
const ASSETS = path.join(ROOT, 'src', 'assets', 'backgrounds');
const PACK = path.join(ROOT, 'wallpaper-pack');
const FOLDERS = ['GIFs', 'JPGs'];
const TIERS = [1440, 2160];
const MAIN_EXT = /\.(webp|gif|mp4)$/i;
const exists = (p) => fs.access(p).then(() => true, () => false);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

// Every optimized wallpaper with its files (paths relative to wallpapers-build).
async function collect() {
  const items = [];
  for (const folder of FOLDERS) {
    const dir = path.join(BUILD, folder);
    if (!(await exists(dir))) continue;
    for (const name of (await fs.readdir(dir)).sort()) {
      if (!MAIN_EXT.test(name) || name.includes('.tmp.')) continue;
      const stem = name.replace(/\.[^.]+$/, '');
      const rel = (...p) => path.join(...p);
      const opt = async (r) => ((await exists(path.join(BUILD, r))) ? r : null);
      items.push({
        id: `${folder}/${stem}`,
        folder,
        stem,
        main: rel(folder, name),
        thumb: await opt(rel('_thumbs', folder, `${stem}.webp`)),
        preview: await opt(rel('_previews', folder, `${stem}.webp`)),
        tiers: Object.fromEntries((await Promise.all(TIERS.map(async (h) => [h, await opt(rel('_hd', String(h), folder, `${stem}.mp4`))]))).filter(([, r]) => r)),
      });
    }
  }
  return items;
}

// SHA-256 (hex) of a file, streamed. The app checks every downloaded pack file
// against it (Rust wallpaper_pack.rs) and discards anything that doesn't match.
const sha256 = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
});

// Copies a file unless the copy is already the same (size + not older).
async function sync(from, to) {
  const [a, b] = await Promise.all([fs.stat(from), fs.stat(to).catch(() => null)]);
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) return a.size;
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  return a.size;
}

// Deletes the files under `dir` (recursively) that aren't in `keep`.
async function prune(dir, keep) {
  if (!(await exists(dir))) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await prune(p, keep);
    else if (!keep.has(p) && !/\.txt$/i.test(entry.name)) {
      await fs.rm(p);
      console.log(`removed  ${path.relative(ROOT, p)}`);
    }
  }
}

async function main() {
  if (!(await exists(BUILD))) throw new Error('wallpapers-build/ not found: run scripts/optimize-wallpapers.mjs first');
  const items = await collect();
  const missing = BUNDLED.filter((id) => !items.some((i) => i.id === id));
  if (missing.length) console.warn(`BUNDLED wallpapers not found: ${missing.join(', ')}`);

  // 1) The app's own wallpapers.
  const keepApp = new Set();
  let appBytes = 0;
  for (const it of items.filter((i) => BUNDLED.includes(i.id))) {
    for (const r of [it.main, it.thumb, it.preview].filter(Boolean)) {
      const to = path.join(ASSETS, r);
      appBytes += await sync(path.join(BUILD, r), to);
      keepApp.add(to);
    }
  }
  await prune(ASSETS, keepApp);

  // 2) The pack.
  const keepPack = new Set();
  const files = {};
  const manifestItems = [];
  for (const it of items.filter((i) => !BUNDLED.includes(i.id))) {
    const base = `${it.folder}--${it.stem}`;
    const put = async (r, name) => {
      if (!r) return null;
      const to = path.join(PACK, name);
      const size = await sync(path.join(BUILD, r), to);
      files[name] = { size, sha256: await sha256(to) };
      keepPack.add(to);
      return name;
    };
    const entry = {
      id: it.id,
      folder: it.folder,
      video: /\.mp4$/i.test(it.main),
      file: await put(it.main, `${base}${path.extname(it.main)}`),
      thumb: await put(it.thumb, `${base}.thumb.webp`),
      preview: await put(it.preview, `${base}.preview.webp`),
      tiers: {},
    };
    for (const [h, r] of Object.entries(it.tiers)) entry.tiers[h] = await put(r, `${base}@${h}.mp4`);
    manifestItems.push(entry);
  }
  // format 2: files = { name: { size, sha256 } }
  // Bigger versions of the built-in videos: only their tier files.
  for (const it of items.filter((i) => BUNDLED.includes(i.id) && Object.keys(i.tiers).length)) {
    const base = `${it.folder}--${it.stem}`;
    const entry = { id: it.id, folder: it.folder, video: true, builtin: true, file: null, thumb: null, preview: null, tiers: {} };
    for (const [h, r] of Object.entries(it.tiers)) {
      const name = `${base}@${h}.mp4`;
      const to = path.join(PACK, name);
      const size = await sync(path.join(BUILD, r), to);
      files[name] = { size, sha256: await sha256(to) };
      keepPack.add(to);
      entry.tiers[h] = name;
    }
    manifestItems.push(entry);
  }
  const manifest = { format: 2, generated: new Date().toISOString(), items: manifestItems, files };
  const manifestPath = path.join(PACK, 'manifest.json');
  await fs.mkdir(PACK, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1));
  keepPack.add(manifestPath);
  await prune(PACK, keepPack);

  const packBytes = Object.values(files).reduce((a, f) => a + f.size, 0);
  console.log(`\nIn the app:  ${items.filter((i) => BUNDLED.includes(i.id)).length} wallpapers, ${mb(appBytes)}`);
  console.log(`In the pack: ${manifestItems.filter((i) => !i.builtin).length} wallpapers (+ HD versions of ${manifestItems.filter((i) => i.builtin).length} built-in ones), ${mb(packBytes)} (${Object.keys(files).length + 1} files)`);
  console.log('Upload it with:  gh release upload wallpapers wallpaper-pack/* --clobber');
}

main().catch((e) => { console.error(e); process.exit(1); });
