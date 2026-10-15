// Optimizes the built-in wallpapers.
//
//   assets-src/backgrounds/<folder>/*   original files (GIF/JPG/PNG/...), NOT bundled
//   src/assets/backgrounds/<folder>/*   optimized files that ship with the app
//   src/assets/backgrounds/_thumbs/...  small still previews for the Settings gallery
//
// Folders: "GIFs" (animated), "JPGs" (static), "by Nipp" (guest artist).
// - Stills  -> WebP, at most 2560x1440.
// - GIFs    -> animated WebP, at most 1280 px wide (kept as GIF if that is smaller).
// - Thumbs  -> first frame, 320x180 WebP.
//
// Usage: add/remove originals in assets-src/backgrounds/<folder>, then run
//   npm run optimize-wallpapers
// Only new or changed files are processed; outputs whose original was removed
// are deleted. On the first run, originals still sitting in src/assets are
// moved to assets-src automatically.

import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src', 'backgrounds');
const OUT = path.join(ROOT, 'src', 'assets', 'backgrounds');
const THUMBS = path.join(OUT, '_thumbs');
const FOLDERS = ['GIFs', 'JPGs', 'by Nipp'];
const INPUT_EXT = /\.(gif|jpe?g|png|webp|avif|tiff?)$/i;

const exists = (p) => fs.access(p).then(() => true, () => false);
const mtime = async (p) => (await fs.stat(p)).mtimeMs;
const kb = (n) => `${Math.round(n / 1024)} KB`;

// First run: move originals out of src/assets so they are no longer bundled.
async function migrateOriginals() {
  for (const folder of FOLDERS) {
    const dir = path.join(OUT, folder);
    if (!(await exists(dir))) continue;
    for (const name of await fs.readdir(dir)) {
      if (!INPUT_EXT.test(name)) continue;
      const optimizedOutput = /\.webp$/i.test(name) ||
        (/\.gif$/i.test(name) && await exists(path.join(SRC, folder, name)));
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

async function main() {
  await migrateOriginals();
  let before = 0;
  let after = 0;

  for (const folder of FOLDERS) {
    const srcDir = path.join(SRC, folder);
    const outDir = path.join(OUT, folder);
    const thumbDir = path.join(THUMBS, folder);
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });

    const originals = (await exists(srcDir)) ? (await fs.readdir(srcDir)).filter((n) => INPUT_EXT.test(n)) : [];
    const stems = new Set();

    for (const name of originals) {
      const input = path.join(srcDir, name);
      const stem = name.replace(/\.[^.]+$/, '');
      stems.add(stem);
      const animated = /\.gif$/i.test(name);
      const outBase = path.join(outDir, stem);
      const thumb = path.join(thumbDir, `${stem}.webp`);

      const existing = [`${outBase}.webp`, `${outBase}.gif`];
      const current = (await Promise.all(existing.map(exists))).findIndex(Boolean);
      const srcTime = await mtime(input);
      const upToDate = current >= 0 && (await mtime(existing[current])) >= srcTime &&
        (await exists(thumb)) && (await mtime(thumb)) >= srcTime;

      let written = current >= 0 ? existing[current] : null;
      if (!upToDate) {
        for (const p of existing) await fs.rm(p, { force: true });
        written = animated ? await optimizeAnimated(input, outBase) : (await optimizeStill(input, `${outBase}.webp`), `${outBase}.webp`);
        await makeThumb(input, thumb);
        console.log(`optimized       ${folder}/${name}  ${kb((await fs.stat(input)).size)} -> ${kb((await fs.stat(written)).size)}`);
      }
      before += (await fs.stat(input)).size;
      after += (await fs.stat(written)).size;
    }

    // Remove outputs whose original no longer exists.
    for (const dir of [outDir, thumbDir]) {
      for (const name of await fs.readdir(dir)) {
        if (!/\.(webp|gif)$/i.test(name)) continue;
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
