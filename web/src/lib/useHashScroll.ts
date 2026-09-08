import { useEffect } from "react";

/**
 * Land a deep link on the section it names, however the reader arrives.
 *
 * The application is a static multi-page build, so a link like
 * `/technical-documentation.html#objective` is a real navigation: the browser
 * resolves the fragment while the document is still the empty React root, and
 * on a cold load — the first visit, a slow connection, a throttled device —
 * that resolution happens before the section exists and is never retried.
 * The link then lands at the top of the page instead of the section, which is
 * exactly what one of the two staging audits observed and the other, on a warm
 * load, did not.
 *
 * The correction is aimed at the actual cause rather than at a guess about
 * timing: the target drifts because content ABOVE it keeps arriving —
 * asynchronously fetched figures, tables, webfont metrics — and each arrival
 * changes the document height. So the alignment is re-checked whenever that
 * height changes, inside a short budget, and abandoned the moment the reader
 * scrolls. It does nothing when there is no fragment, when the fragment names
 * nothing, or when the browser already got it right.
 *
 * It arms on mount and again on every `hashchange`, so a fragment reached
 * within the document behaves identically to one reached by loading the page
 * at that fragment. Nothing here changes history, the URL, or the fragment.
 */

/** How long the page is allowed to keep settling after each arming, in ms. */
const SETTLE_BUDGET_MS = 4000;

/** Alignment slack, in px. Below this the browser already got it right. */
const ALIGNED_PX = 2;

/** Fallback re-check schedule where ResizeObserver is unavailable, in ms. */
const FALLBACK_RETRY_MS = [120, 320, 700, 1400, 2400, 3400] as const;

export function useHashScroll(): void {
  useEffect(() => {
    /** Teardown for the currently armed attempt, if any. */
    let disarm: (() => void) | null = null;

    const arm = () => {
      disarm?.();
      disarm = null;

      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;

      let stopped = false;
      let frame = 0;
      const timers: number[] = [];
      let observer: ResizeObserver | null = null;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (frame) window.cancelAnimationFrame(frame);
        for (const t of timers) window.clearTimeout(t);
        observer?.disconnect();
        window.removeEventListener("wheel", stop);
        window.removeEventListener("touchstart", stop);
        window.removeEventListener("keydown", stop);
      };

      // Any deliberate reader movement ends the attempt, so this can never
      // fight someone who has already started reading.
      window.addEventListener("wheel", stop, { passive: true });
      window.addEventListener("touchstart", stop, { passive: true });
      window.addEventListener("keydown", stop);

      const align = () => {
        if (stopped) return;
        const el = document.getElementById(id);
        if (!el) return;
        if (Math.abs(el.getBoundingClientRect().top) <= ALIGNED_PX) return;
        el.scrollIntoView({ block: "start" });
      };

      frame = window.requestAnimationFrame(align);
      if (typeof ResizeObserver === "function") {
        observer = new ResizeObserver(() => {
          if (stopped) return;
          // Re-check on the frame after the size change, so the new layout is
          // the one being measured.
          window.requestAnimationFrame(align);
        });
        observer.observe(document.documentElement);
      } else {
        for (const delay of FALLBACK_RETRY_MS) {
          timers.push(window.setTimeout(align, delay));
        }
      }
      timers.push(window.setTimeout(stop, SETTLE_BUDGET_MS));
      disarm = stop;
    };

    arm();
    window.addEventListener("hashchange", arm);
    return () => {
      window.removeEventListener("hashchange", arm);
      disarm?.();
    };
  }, []);
}
