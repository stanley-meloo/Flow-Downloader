import { motion } from "framer-motion";

// "Flow Downloader" hero: written letter by letter on startup (each letter
// fades in from a soft blur), then the tagline appears below it.
// Timing is passed in by App (INTRO) so it fits the rest of the entrance.

const LETTER_STAGGER = 0.045; // s between letters
const LETTER_DURATION = 0.4;
const EASE = [0.22, 1, 0.36, 1];

const WORDS = [
  { text: "Flow", className: "font-light" },
  { text: "Downloader", className: "font-bold" },
];

// When the last letter has finished appearing (seconds after `delay`).
const HERO_WRITE_TIME =
  (WORDS.reduce((n, w) => n + w.text.length, 0) - 1) * LETTER_STAGGER + LETTER_DURATION;

export default function HeroTitle({ subtitle, delay = 0 }) {
  let index = 0;
  return (
    <div className="text-center mb-12 shrink-0">
      <h1 className="text-5xl tracking-tight mb-2 text-white" aria-label="Flow Downloader">
        {WORDS.map((word, w) => (
          <span key={word.text} className={`${word.className} inline-block whitespace-nowrap`} aria-hidden="true">
            {w > 0 && <span className="inline-block">&nbsp;</span>}
            {Array.from(word.text).map((ch) => {
              const i = index++;
              return (
                <motion.span
                  key={i}
                  className="inline-block"
                  initial={{ opacity: 0, y: 8, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: LETTER_DURATION, ease: EASE, delay: delay + i * LETTER_STAGGER }}
                >
                  {ch}
                </motion.span>
              );
            })}
          </span>
        ))}
      </h1>
      <motion.p
        initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.6, ease: EASE, delay: delay + HERO_WRITE_TIME + 0.1 }}
        className="text-zinc-500 text-sm tracking-widest uppercase"
      >
        {subtitle}
      </motion.p>
    </div>
  );
}
