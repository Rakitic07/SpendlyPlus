// Lightweight runtime performance probe.
//
// It writes everything to console.log with a "[PERF]" prefix. In the native
// Capacitor app those console lines are forwarded to Android logcat, so you can
// capture them from a cable-connected phone with:
//
//   adb logcat -v time | grep -i "\[PERF\]"
//
// (or dump to a file:  adb logcat -v time | grep -i "\[PERF\]" > perf.txt )
//
// Then paste the output back and we can see exactly what's slow: dropped frames
// while scrolling, long main-thread tasks, slow taps, memory pressure, etc.
//
// Off by default everywhere; open the app once with ?perf=1 to enable it.

type MemoryInfo = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

let started = false;

// In-app log buffer so the phone can capture its own diagnostics to a file the
// user downloads — no adb/cable needed. Persisted to localStorage so it also
// survives an app relaunch.
const LOG_MAX = 5000;
const LOG_KEY = "spendly_perf_log";
const PERF_FLAG = "spendly_perf_on";
const logBuffer: string[] = [];

function appendPerf(line: string): void {
  logBuffer.push(`${new Date().toISOString()} ${line}`);
  if (logBuffer.length > LOG_MAX) logBuffer.splice(0, logBuffer.length - LOG_MAX);
}

/** All buffered [PERF] + error lines as one text blob, ready to save/share. */
export function getPerfLog(): string {
  return logBuffer.join("\n");
}

/** Append an ad-hoc diagnostic line to the log (and console) from anywhere. */
export function recordDiag(label: string, data?: unknown): void {
  const line =
    data === undefined
      ? label
      : `${label} ${typeof data === "string" ? data : JSON.stringify(data)}`;
  appendPerf(line);
  if (typeof console !== "undefined") console.log("[PERF]", line);
}

/** Wipe the in-app performance log (memory + persisted copy). */
export function clearPerfLog(): void {
  logBuffer.length = 0;
  try {
    window.localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}

export function startPerfLogging(): void {
  if (started || typeof window === "undefined") return;

  // Opt-in only: the probe runs a permanent rAF loop and keeps a large log
  // buffer, which itself costs frames. `?perf=1` turns it on (remembered),
  // `?perf=0` turns it off.
  let enabled = false;
  try {
    const q = window.location.search;
    if (q.includes("perf=1")) window.localStorage.setItem(PERF_FLAG, "1");
    if (q.includes("perf=0")) window.localStorage.removeItem(PERF_FLAG);
    enabled = window.localStorage.getItem(PERF_FLAG) === "1";
    if (!enabled) window.localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
  if (!enabled) return;

  started = true;

  // Restore logs captured before a relaunch, then persist periodically and when
  // the app is backgrounded so nothing is lost between sessions.
  try {
    const prev = window.localStorage.getItem(LOG_KEY);
    if (prev) logBuffer.push(...prev.split("\n"));
  } catch {
    /* ignore */
  }
  const persist = () => {
    try {
      window.localStorage.setItem(LOG_KEY, logBuffer.join("\n"));
    } catch {
      /* ignore */
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persist();
  });

  const log = (label: string, data?: unknown) => {
    const line =
      data === undefined
        ? label
        : `${label} ${typeof data === "string" ? data : JSON.stringify(data)}`;
    appendPerf(line);
    console.log("[PERF]", line);
  };

  // Capture uncaught errors / promise rejections too — they often explain hangs.
  window.addEventListener("error", (e) =>
    log("js-error", `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`)
  );
  window.addEventListener("unhandledrejection", (e) =>
    log("promise-rejection", String((e as PromiseRejectionEvent).reason))
  );

  // ── 1) Device / environment snapshot ────────────────────────────────────
  try {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { downlink?: number; effectiveType?: string };
    };
    log("env", {
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      screen: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      deviceMemoryGB: nav.deviceMemory ?? "?",
      cores: nav.hardwareConcurrency ?? "?",
      net: nav.connection?.effectiveType ?? "?",
      downlinkMbps: nav.connection?.downlink ?? "?",
    });
  } catch {
    /* ignore */
  }

  // ── 2) Page load / paint timings ─────────────────────────────────────────
  const logLoad = () => {
    try {
      const navEntry = performance.getEntriesByType(
        "navigation"
      )[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance
        .getEntriesByType("paint")
        .find((p) => p.name === "first-contentful-paint");
      if (navEntry) {
        log("load", {
          ttfbMs: Math.round(navEntry.responseStart - navEntry.requestStart),
          domContentLoadedMs: Math.round(
            navEntry.domContentLoadedEventEnd - navEntry.startTime
          ),
          loadEventMs: Math.round(navEntry.loadEventEnd - navEntry.startTime),
          fcpMs: fcp ? Math.round(fcp.startTime) : "?",
          domNodes: document.getElementsByTagName("*").length,
        });
      }
    } catch {
      /* ignore */
    }
  };
  if (document.readyState === "complete") logLoad();
  else window.addEventListener("load", () => setTimeout(logLoad, 0), { once: true });

  // ── 3) Long tasks: main-thread blocks ≥ 50ms (the classic jank source) ───
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration >= 50) log("longtask", `${Math.round(e.duration)}ms`);
      }
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask not supported */
  }

  // ── 4) Interaction latency: taps/keys that took ≥ 80ms to handle ─────────
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration >= 80)
          log("slow-input", `${e.name} ${Math.round(e.duration)}ms`);
      }
    });
    po.observe({
      type: "event",
      durationThreshold: 80,
      buffered: true,
    } as PerformanceObserverInit);
  } catch {
    /* event timing not supported */
  }

  // ── 5) Frame rate & dropped frames (measured continuously) ───────────────
  // A frame budget of 60fps = 16.7ms. We flag any frame that took > 24ms as a
  // "long frame" (a visible stutter). Every 2s we log fps + how many frames
  // stuttered + the worst frame — but ONLY when there was jank, so a still
  // screen doesn't spam the log. Scroll/navigate while this runs to catch it.
  let last = performance.now();
  let frames = 0;
  let longFrames = 0;
  let worst = 0;
  let windowStart = last;
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    frames++;
    if (dt > 24) longFrames++;
    if (dt > worst) worst = dt;
    if (now - windowStart >= 2000) {
      const fps = Math.round(frames / ((now - windowStart) / 1000));
      if (longFrames > 0 || fps < 55) {
        log("frames", { fps, longFrames, worstMs: Math.round(worst) });
      }
      frames = 0;
      longFrames = 0;
      worst = 0;
      windowStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ── 6) JS heap memory (Chromium exposes performance.memory) ──────────────
  const mem = (performance as Performance & { memory?: MemoryInfo }).memory;
  if (mem) {
    setInterval(() => {
      log("mem", {
        usedMB: Math.round(mem.usedJSHeapSize / 1048576),
        totalMB: Math.round(mem.totalJSHeapSize / 1048576),
        limitMB: Math.round(mem.jsHeapSizeLimit / 1048576),
      });
    }, 5000);
  }

  log("probe started — scroll/navigate now to record frame stats");
}
