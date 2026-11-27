import { useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { SparklesIcon as Sparkles } from "../ui/AnimatedIcons";
import { Swap, Collapse, TAP } from "../ui/Motion";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { DIALOG_GLASS } from "../ui/liquidGlass/presets";
import DownloadButton from "../ui/DownloadButton";
import appLogo from "../../assets/logo.png";

// New Flow Downloader version (useAppUpdater).
//
// AppUpdateCard — centered liquid-glass card, everything centered:
//   - aurora glow + dot texture at the top, the logo with light rings and
//     sparks, a "New version" badge, the headline with the app name in the
//     accent gradient;
//   - big headline "Flow Downloader has a new update available!";
//   - current version → newest version (chips);
//   - "What is new": up to 4 bullets from the release notes;
//   - the big accent "Update" button (same as the cards' download button),
//     with a progress bar above it while downloading / installing;
//   - "Ignore" under it: the ONLY way to close the card. It folds into
//     UpdatePill (no X, no Esc, no click outside).
//   24 px padding around 12 px-radius controls → 36 px corners.
//
// UpdatePill — small round liquid-glass button left of the Settings gear
// (same size and glass), with a soft accent pulse. Click → the card again.

const ROUND_GLASS = { blur: 0.65, darkTint: 0.3, edgeHighlight: 0.14, coreOpacity: 0.35 };

// "Ignore": the card shrinks into the pill (bottom-right, left of the gear:
// its center is 86 px from the right edge and 48 px from the bottom).
const toPill = () => ({
  opacity: 0, scale: 0.12, filter: "blur(6px)",
  x: window.innerWidth / 2 - 86, y: window.innerHeight / 2 - 48,
  transition: { type: "spring", stiffness: 260, damping: 30 },
});

// Up to 4 bullet points from the update notes (latest.json "notes", from
// UPDATE_NOTES.md): the "## <language>" section for the app's language, else
// "## en", else every bullet. Markdown marks and links are removed.
function noteItems(md, lang) {
  if (!md) return [];
  const sections = {};
  let current = "*";
  for (const line of md.split(/\r?\n/)) {
    const head = line.match(/^\s*##\s+([a-z]{2,3}(?:-[a-z]+)?)\s*$/i);
    if (head) { current = head[1].toLowerCase(); continue; }
    const item = line.match(/^\s*[-*•]\s+(.+)/)?.[1];
    if (item) (sections[current] ||= []).push(item);
  }
  const base = (lang || "en").toLowerCase().split("-")[0];
  const pick = sections[(lang || "").toLowerCase()] || sections[base] || sections.en || sections["*"] || [];
  return pick
    .map((l) => l.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

// "Flow Downloader" inside the headline drawn with the accent gradient.
function highlightName(text) {
  const name = "Flow Downloader";
  const i = text.indexOf(name);
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <span className="update-name">{name}</span>
      {text.slice(i + name.length)}
    </>
  );
}

export default function AppUpdateCard({ updater }) {
  const { t, i18n } = useTranslation();
  const { available, version, status, progress, install, minimize } = updater;
  const busy = status === "downloading" || status === "installing";
  const pct = status === "installing" ? 100 : progress;
  const notes = noteItems(available?.notes, i18n.language);

  // Own the keyboard while open (capture + stop): global shortcuts underneath
  // (Enter = search…) must not react. Tab / Enter / Space still work on the
  // card's own buttons.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Tab" || e.key === "Enter" || e.key === " ") return;
      e.stopImmediatePropagation();
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const label = status === "downloading"
    ? `${t("update.downloading", { defaultValue: "Downloading…" })} ${pct}%`
    : status === "installing"
      ? t("update.installing", { defaultValue: "Installing…" })
      : t("update.install", { defaultValue: "Update" });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 backdrop-blur-sm"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0, filter: "blur(0px)" }}
        // Exit depends on how it closed (AnimatePresence `custom` = folding
        // into the pill?): an unmounting component can't read new props.
        variants={{ exit: (toPillNow) => (toPillNow ? toPill() : { opacity: 0, scale: 0.96, y: 10 }) }}
        exit="exit"
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="relative isolate w-full max-w-[420px] rounded-[36px] shadow-2xl backdrop-blur-md overflow-hidden text-center" /* the glass draws bg + rim */
      >
        <LiquidGlass
          variant="dark"
          settings={DIALOG_GLASS}
          radius={36}
          className="absolute inset-0 -z-10 pointer-events-none rounded-[36px]"
          fallbackClassName="bg-zinc-950/80 backdrop-blur-2xl border border-white/10"
        />

        {/* Aurora: accent light pouring from the top of the card */}
        <div
          className="update-aurora absolute -top-24 left-1/2 w-[140%] h-72 -z-[5] pointer-events-none"
          style={{ background: "radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, var(--accent) 45%, transparent) 0%, color-mix(in srgb, var(--accent-strong) 18%, transparent) 45%, transparent 75%)" }}
          aria-hidden="true"
        />
        {/* Fine dot grid fading out downward (texture) */}
        <div className="update-grid absolute inset-x-0 top-0 h-56 -z-[4] pointer-events-none" aria-hidden="true" />

        <div className="px-8 pt-9 pb-6">
          {/* Logo: glow + two slow rotating light rings + floating sparks */}
          <div className="relative mx-auto mb-6 w-[72px] h-[72px]">
            <div className="absolute -inset-6 rounded-full blur-2xl opacity-70" style={{ background: "var(--accent)" }} aria-hidden="true" />
            <div className="update-ring absolute -inset-3 rounded-[26px]" aria-hidden="true" />
            <div className="update-ring update-ring--slow absolute -inset-[22px] rounded-[34px] opacity-50" aria-hidden="true" />
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`update-spark update-spark--${i}`} aria-hidden="true" />
            ))}
            <motion.img
              src={appLogo}
              alt=""
              draggable={false}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
              className="relative w-[72px] h-[72px] object-contain select-none drop-shadow-[0_10px_24px_rgba(0,0,0,0.5)]"
            />
          </div>

          {/* Eyebrow badge */}
          <div className="mb-3 flex justify-center">
            <span
              className="inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-full text-[10.5px] font-black uppercase tracking-[0.18em] text-white"
              style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent)" }}
            >
              <Sparkles size={12} />
              {t("update.badge", { defaultValue: "New version" })}
            </span>
          </div>

          <h2 id="app-update-title" className="text-white text-[26px] font-bold leading-[1.15] tracking-tight [text-wrap:balance]">
            {highlightName(t("update.title", { defaultValue: "Flow Downloader has a new update available!" }))}
          </h2>

          {/* current → newest */}
          {available?.version && (
            <div className="mt-5 flex items-center justify-center gap-2.5 text-[13px] font-bold tabular-nums">
              {version && (
                <>
                  <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-zinc-400">v{version}</span>
                  <motion.svg
                    width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                    className="text-zinc-300" aria-hidden="true"
                    animate={{ x: [0, 3, 0] }} transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
                  >
                    <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
                  </motion.svg>
                </>
              )}
              <span
                className="px-3 py-1 rounded-full text-white border"
                style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", borderColor: "color-mix(in srgb, var(--accent) 55%, transparent)", boxShadow: "0 0 18px -4px var(--accent)" }}
              >
                v{available.version}
              </span>
            </div>
          )}

          {/* What's new (bullets from the release notes, when there are any) */}
          {notes.length > 0 && (
            <div className="mt-6 text-left rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3.5">
              <p className="mb-2 text-[10.5px] font-black uppercase tracking-[0.18em] text-zinc-400">
                {t("update.whats_new", { defaultValue: "What's new" })}
              </p>
              <ul className="space-y-1.5">
                {notes.map((n, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.07, duration: 0.3, ease: "easeOut" }}
                    className="flex items-start gap-2.5 text-[13px] leading-5 text-zinc-200"
                  >
                    <span className="mt-[7px] w-1.5 h-1.5 shrink-0 rounded-full bg-(--accent)" style={{ boxShadow: "0 0 8px var(--accent)" }} />
                    <span className="min-w-0">{n}</span>
                  </motion.li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Download progress */}
        <Collapse show={busy}>
          <div className="mx-6 mb-4 h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-(--accent) transition-[width] duration-200 ease-out" style={{ width: `${pct}%`, boxShadow: "0 0 10px var(--accent)" }} />
          </div>
        </Collapse>

        <div className="px-6 pb-6 flex flex-col gap-2">
          <DownloadButton onClick={install} disabled={busy} className="w-full h-14">
            <Swap id={status}>{label}</Swap>
          </DownloadButton>
          <button
            onClick={minimize}
            disabled={busy}
            className="h-10 rounded-xl text-[14px] font-bold text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {t("update.ignore", { defaultValue: "Ignore" })}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function UpdatePill({ version, onOpen, tooltip, glassPaused }) {
  const { t } = useTranslation();
  const label = t("update.available", { version, defaultValue: "Flow Downloader {{version}} is available" });
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1, transition: { type: "spring", stiffness: 420, damping: 22, delay: 0.15 } }}
      exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.15 } }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95, transition: TAP }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.currentTarget.blur(); tooltip?.leave?.(); onOpen(); }}
      onMouseEnter={(e) => tooltip?.show?.(e.currentTarget, label, "top")}
      onMouseLeave={() => tooltip?.leave?.()}
      aria-label={label}
      className="fixed bottom-[30px] right-[68px] rounded-full z-20 shadow-xl cursor-pointer text-(--accent) hover:text-white transition-colors"
    >
      {/* Soft accent pulse: "something new here" */}
      <span className="update-pill-pulse absolute inset-0 rounded-full pointer-events-none" aria-hidden="true" />
      <LiquidGlass
        variant="dark"
        paused={glassPaused}
        settings={ROUND_GLASS}
        className="p-2 rounded-full backdrop-blur-md"
        fallbackClassName="bg-zinc-900/50 backdrop-blur-xl ring-1 ring-white/10"
      >
        <Sparkles size={20} />
      </LiquidGlass>
    </motion.button>
  );
}
