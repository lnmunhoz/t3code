import type { MusicBarsSettings } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useMediaQuery } from "../hooks/useMediaQuery";
import { useClientSettings } from "../hooks/useSettings";
import { rowLevel } from "./MusicBars.logic";

// The meter sends nothing while the music is paused, so a short silence hides the strip.
const QUIET_MS = 400;

/** Live music bars along a window edge, from the desktop app's audio meter. */
export function MusicBars() {
  const enabled = useClientSettings((settings) => settings.musicBarsEnabled);
  const look = useClientSettings((settings) => settings.musicBars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const subscribe = window.desktopBridge?.subscribeMusicLevels;
  if (!enabled || reducedMotion || !subscribe) return null;
  // A new bar count or edge rebuilds the strip, so the meter loop never sees stale rows.
  return (
    <MusicBarsStrip key={`${look.position}:${look.density}`} subscribe={subscribe} look={look} />
  );
}

type Subscribe = NonNullable<NonNullable<typeof window.desktopBridge>["subscribeMusicLevels"]>;

function MusicBarsStrip({ subscribe, look }: { subscribe: Subscribe; look: MusicBarsSettings }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Sliders change these every frame while dragged; the meter loop reads them without resubscribing.
  const tuning = useRef(look);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the latest sliders to the meter loop outside React
  useEffect(() => {
    tuning.current = look;
  }, [look]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the desktop audio meter
  useEffect(() => {
    const container = containerRef.current;
    return container ? followMeter(container, subscribe, tuning) : undefined;
  }, [subscribe]);
  const bottom = look.position === "bottom";
  return (
    <div
      ref={containerRef}
      aria-hidden
      data-active="false"
      className={
        bottom
          ? "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-row items-end overflow-hidden opacity-0 transition-opacity duration-300 data-[active=true]:opacity-(--music-bars-opacity)"
          : "pointer-events-none fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden opacity-0 transition-opacity duration-300 data-[active=true]:opacity-(--music-bars-opacity)"
      }
      style={
        {
          [bottom ? "height" : "width"]: look.reach,
          "--music-bars-opacity": look.visibility / 100,
        } as React.CSSProperties
      }
    >
      {Array.from({ length: look.density }, (_, row) => (
        <i
          key={row}
          className={
            bottom
              ? "block h-full min-w-0 flex-1 origin-bottom bg-linear-to-t from-foreground to-foreground/40 [transform:scaleY(var(--level,0))]"
              : "block min-h-0 w-full flex-1 origin-left bg-linear-to-r from-foreground to-foreground/40 [transform:scaleX(var(--level,0))]"
          }
        />
      ))}
    </div>
  );
}

/** Writes each reading straight into the bars' `--level`, so 50 a second never re-render React. */
function followMeter(
  container: HTMLElement,
  subscribe: Subscribe,
  tuning: { readonly current: MusicBarsSettings },
): () => void {
  const bars = Array.from(container.children) as HTMLElement[];
  const shown = new Float32Array(bars.length);
  let lastReadingAt = 0;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  const setActive = (active: boolean) => {
    container.dataset.active = String(active);
  };
  const show = (spectrum: ReadonlyArray<number> | null) => {
    clearTimeout(quietTimer);
    if (!spectrum) {
      shown.fill(0);
      setActive(false);
      return;
    }
    setActive(true);
    quietTimer = setTimeout(() => setActive(false), QUIET_MS);
    const { sensitivity, falloffMs } = tuning.current;
    const now = performance.now();
    // Peaks land at once; falloff only softens the way down, as in Focus Dot.
    const keep = falloffMs > 0 ? Math.exp(-Math.min(200, now - lastReadingAt) / falloffMs) : 0;
    lastReadingAt = now;
    for (let bar = 0; bar < bars.length; bar++) {
      // Square root lifts quiet passages, which otherwise barely move a thin strip.
      const target = Math.min(
        1,
        (Math.sqrt(rowLevel(spectrum, bar, bars.length)) * sensitivity) / 100,
      );
      const previous = shown[bar] ?? 0;
      const level = target >= previous ? target : previous * keep + target * (1 - keep);
      shown[bar] = level;
      bars[bar]!.style.setProperty("--level", level.toFixed(3));
    }
  };
  // The desktop app stops the meter while nobody listens, so a hidden window lets go of it.
  let unsubscribe: (() => void) | null = null;
  const sync = () => {
    if (document.visibilityState === "hidden") {
      unsubscribe?.();
      unsubscribe = null;
      show(null);
    } else if (!unsubscribe) {
      unsubscribe = subscribe(show);
    }
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    document.removeEventListener("visibilitychange", sync);
    clearTimeout(quietTimer);
    unsubscribe?.();
  };
}
