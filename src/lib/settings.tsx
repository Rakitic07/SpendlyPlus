"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api";

// Per-space preferences. Persisted to localStorage under a single JSON blob so
// adding new options later never needs a migration. Everything has a sensible
// default, so an older/absent blob still yields a fully-formed settings object.

export type PeriodView = "day" | "month" | "year" | "all";

/** "glass" = the default liquid-glass look; "neo" = Soft Aurora (neumorphic). */
export type ThemeName = "glass" | "neo";

export type SpaceSettings = {
  /** Visual theme. Default stays the liquid-glass UI. */
  theme: ThemeName;
  /** Web/PWA: start the charts panel collapsed (native keeps a Charts tab). */
  chartsCollapsed: boolean;
  /** Which period the dashboard opens on. */
  defaultPeriod: PeriodView;
  /** Show tiny bill thumbnails on rows and in the edit form. */
  showThumbnails: boolean;
  /** Ask for confirmation before deleting an expense. */
  confirmDelete: boolean;
  /** Offer recent expense titles as quick-fill chips in the form. */
  recentSuggestions: boolean;
  /** Warn when spending approaches / exceeds the monthly budget. */
  budgetAlerts: boolean;
  /** Pre-fill the "Paid by" field for new expenses. */
  defaultPayer: string;
  /** Native only: haptic feedback on key actions. */
  haptics: boolean;
};

export const DEFAULT_SETTINGS: SpaceSettings = {
  theme: "glass",
  chartsCollapsed: true,
  defaultPeriod: "month",
  showThumbnails: true,
  confirmDelete: true,
  recentSuggestions: true,
  budgetAlerts: true,
  defaultPayer: "",
  haptics: true,
};

function keyFor(space: string): string {
  return `spendly.settings.${space}`;
}

// Coerce an unknown parsed value into a complete SpaceSettings, filling any
// missing / malformed fields from defaults.
function normalize(raw: unknown): SpaceSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<SpaceSettings>;
  const period: PeriodView[] = ["day", "month", "year", "all"];
  return {
    theme: r.theme === "neo" ? "neo" : "glass",
    chartsCollapsed:
      typeof r.chartsCollapsed === "boolean"
        ? r.chartsCollapsed
        : DEFAULT_SETTINGS.chartsCollapsed,
    defaultPeriod:
      r.defaultPeriod && period.includes(r.defaultPeriod)
        ? r.defaultPeriod
        : DEFAULT_SETTINGS.defaultPeriod,
    showThumbnails:
      typeof r.showThumbnails === "boolean"
        ? r.showThumbnails
        : DEFAULT_SETTINGS.showThumbnails,
    confirmDelete:
      typeof r.confirmDelete === "boolean"
        ? r.confirmDelete
        : DEFAULT_SETTINGS.confirmDelete,
    recentSuggestions:
      typeof r.recentSuggestions === "boolean"
        ? r.recentSuggestions
        : DEFAULT_SETTINGS.recentSuggestions,
    budgetAlerts:
      typeof r.budgetAlerts === "boolean"
        ? r.budgetAlerts
        : DEFAULT_SETTINGS.budgetAlerts,
    defaultPayer:
      typeof r.defaultPayer === "string"
        ? r.defaultPayer
        : DEFAULT_SETTINGS.defaultPayer,
    haptics:
      typeof r.haptics === "boolean" ? r.haptics : DEFAULT_SETTINGS.haptics,
  };
}

// Synchronous read — safe to call from React state initializers on the client.
export function readSettings(space: string): SpaceSettings {
  if (!space || typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(keyFor(space));
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(space: string, value: SpaceSettings): void {
  if (!space || typeof window === "undefined") return;
  try {
    localStorage.setItem(keyFor(space), JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

type Ctx = {
  settings: SpaceSettings;
  update: (patch: Partial<SpaceSettings>) => void;
  reset: () => void;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({
  space,
  seed,
  children,
}: {
  space: string;
  /**
   * Server settings already fetched by the app's startup /api/bootstrap call.
   * When provided (non-empty), we hydrate from it and skip the separate
   * /api/settings request — one fewer round trip + cold start on launch.
   */
  seed?: Record<string, unknown> | null;
  children: React.ReactNode;
}) {
  // Lazy init reads localStorage synchronously for an instant, flicker-free
  // paint. The Dashboard only mounts on the client (after the auth bootstrap),
  // so there's no SSR/hydration mismatch.
  const [settings, setSettings] = useState<SpaceSettings>(() =>
    readSettings(space)
  );

  // Serialize the seed so the effect only re-runs when its contents actually
  // change (the parent may hand us a fresh object reference each render).
  const seedKey = seed && Object.keys(seed).length > 0 ? JSON.stringify(seed) : "";

  // Hydrate from the server so preferences follow the space across every device.
  // Local values win for the first paint; the server copy overrides once it's
  // available. Prefer the bootstrap `seed` (already fetched) and only fall back
  // to a dedicated /api/settings request when no seed was supplied.
  useEffect(() => {
    if (!space) return;

    if (seedKey) {
      const remote = JSON.parse(seedKey) as Record<string, unknown>;
      const merged = normalize({ ...readSettings(space), ...remote });
      writeSettings(space, merged);
      setSettings(merged);
      return;
    }

    let alive = true;
    api
      .getSettings()
      .then(({ settings: remote }) => {
        if (!alive || !remote || Object.keys(remote).length === 0) return;
        const merged = normalize({ ...readSettings(space), ...remote });
        writeSettings(space, merged);
        setSettings(merged);
      })
      .catch(() => {
        /* offline / guest — keep the local copy */
      });
    return () => {
      alive = false;
    };
  }, [space, seedKey]);

  // Changed keys are batched and pushed once typing / toggling settles, so a
  // text field like "Default payer" doesn't fire one request per keystroke.
  const pendingPatch = useRef<Partial<SpaceSettings>>({});
  const flushTimer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (flushTimer.current) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    // The server merges just these keys into the shared blob.
    void api.patchSettings(patch as Record<string, unknown>).catch(() => {});
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const update = useCallback(
    (patch: Partial<SpaceSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        writeSettings(space, next);
        return next;
      });
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(flush, 600);
    },
    [space, flush]
  );

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS };
    writeSettings(space, next);
    setSettings(next);
    pendingPatch.current = { ...next };
    flush();
  }, [space, flush]);

  // The theme is a pure-CSS switch (see globals.css `html[data-theme="neo"]`).
  // Layout effect so the attribute lands before paint — no glass→neo flash. The
  // cleanup restores the default when the space is locked / switched.
  const theme = settings.theme;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme === "neo") root.dataset.theme = "neo";
    else delete root.dataset.theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  const value = useMemo<Ctx>(
    () => ({ settings, update, reset }),
    [settings, update, reset]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  // Fallback outside a provider: read-only defaults so callers never crash.
  return {
    settings: { ...DEFAULT_SETTINGS },
    update: () => {},
    reset: () => {},
  };
}
