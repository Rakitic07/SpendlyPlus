"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "./api";

// Per-space preferences. Persisted to localStorage under a single JSON blob so
// adding new options later never needs a migration. Everything has a sensible
// default, so an older/absent blob still yields a fully-formed settings object.

export type PeriodView = "day" | "month" | "year" | "all";

export type SpaceSettings = {
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
  children,
}: {
  space: string;
  children: React.ReactNode;
}) {
  // Lazy init reads localStorage synchronously for an instant, flicker-free
  // paint. The Dashboard only mounts on the client (after the auth bootstrap),
  // so there's no SSR/hydration mismatch.
  const [settings, setSettings] = useState<SpaceSettings>(() =>
    readSettings(space)
  );

  // Then hydrate from the server so preferences follow the space across every
  // device. Local values win for the first paint; the server copy overrides
  // once it arrives (and is written back to the local cache).
  useEffect(() => {
    if (!space) return;
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
  }, [space]);

  const update = useCallback(
    (patch: Partial<SpaceSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        writeSettings(space, next);
        return next;
      });
      // Push just the changed keys; the server merges them into the shared blob.
      void api.patchSettings(patch as Record<string, unknown>).catch(() => {});
    },
    [space]
  );

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS };
    writeSettings(space, next);
    setSettings(next);
    void api
      .patchSettings(next as unknown as Record<string, unknown>)
      .catch(() => {});
  }, [space]);

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
