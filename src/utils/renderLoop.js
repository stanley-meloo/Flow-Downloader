// Render loop for the animated WebGL backgrounds that only works when it shows:
// - stops completely while the window is hidden/minimized or `isPaused()` is
//   true (e.g. a download dialog covers the screen), and resumes on wake();
// - drops to ~30 fps while the window is not focused;
// - keeps its own animation clock that only advances while running, so the
//   animation continues where it stopped instead of jumping ahead.
//
// render(time, dt) receives the animation time and the time since the last
// drawn frame, both in seconds.

const UNFOCUSED_FRAME_MS = 1000 / 30;
const MAX_STEP = 0.1; // seconds; avoids a jump after a long frame

export function createRenderLoop(render, { isPaused = () => false } = {}) {
  let raf = 0;
  let disposed = false;
  let last = 0;
  let lastDraw = 0;
  let time = 0;
  let pendingDt = 0;

  const shouldStop = () => disposed || document.hidden || isPaused();

  const tick = (now) => {
    raf = 0;
    if (shouldStop()) return; // stays stopped until wake()
    const dt = Math.min((now - last) / 1000, MAX_STEP);
    last = now;
    time += dt;
    pendingDt += dt;
    const minGap = document.hasFocus() ? 0 : UNFOCUSED_FRAME_MS;
    if (now - lastDraw >= minGap - 2) {
      lastDraw = now;
      render(time, pendingDt);
      pendingDt = 0;
    }
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (raf || shouldStop()) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);

  // Always draw one frame right away, so a loop created while paused still
  // shows a picture (and settings changes are visible).
  render(time, 0);
  wake();

  return {
    wake,
    // Draws the current frame once while stopped (e.g. after a uniform change).
    redraw() {
      if (!raf && !disposed) render(time, 0);
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    },
  };
}
