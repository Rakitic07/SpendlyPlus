import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PeriodView } from './analytics';
import { api } from './api';

// Per-space preferences, persisted as a single JSON blob in AsyncStorage. Every
// field has a default, so a missing/old blob still yields a complete object.
// A tiny in-memory cache lets non-React code (and the PeriodProvider's initial
// state) read the current values synchronously after `loadSettings` has run.

export type SpaceSettings = {
  defaultPeriod: PeriodView;
  showThumbnails: boolean;
  confirmDelete: boolean;
  recentSuggestions: boolean;
  budgetAlerts: boolean;
  defaultPayer: string;
  haptics: boolean;
};

export const DEFAULT_SETTINGS: SpaceSettings = {
  defaultPeriod: 'month',
  showThumbnails: true,
  confirmDelete: true,
  recentSuggestions: true,
  budgetAlerts: true,
  defaultPayer: '',
  haptics: true,
};

function keyFor(space: string): string {
  return `spendly.settings.${space}`;
}

function normalize(raw: unknown): SpaceSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<SpaceSettings>;
  const periods: PeriodView[] = ['day', 'month', 'year', 'all'];
  return {
    defaultPeriod:
      r.defaultPeriod && periods.includes(r.defaultPeriod)
        ? r.defaultPeriod
        : DEFAULT_SETTINGS.defaultPeriod,
    showThumbnails:
      typeof r.showThumbnails === 'boolean' ? r.showThumbnails : DEFAULT_SETTINGS.showThumbnails,
    confirmDelete:
      typeof r.confirmDelete === 'boolean' ? r.confirmDelete : DEFAULT_SETTINGS.confirmDelete,
    recentSuggestions:
      typeof r.recentSuggestions === 'boolean'
        ? r.recentSuggestions
        : DEFAULT_SETTINGS.recentSuggestions,
    budgetAlerts:
      typeof r.budgetAlerts === 'boolean' ? r.budgetAlerts : DEFAULT_SETTINGS.budgetAlerts,
    defaultPayer:
      typeof r.defaultPayer === 'string' ? r.defaultPayer : DEFAULT_SETTINGS.defaultPayer,
    haptics: typeof r.haptics === 'boolean' ? r.haptics : DEFAULT_SETTINGS.haptics,
  };
}

// -- Synchronous cache ------------------------------------------------------

let cache: SpaceSettings = { ...DEFAULT_SETTINGS };
let cachedSpace = '';

export function getSettingsSync(): SpaceSettings {
  return cache;
}

export async function loadSettings(space: string): Promise<SpaceSettings> {
  if (!space) {
    cache = { ...DEFAULT_SETTINGS };
    cachedSpace = '';
    return cache;
  }
  try {
    const raw = await AsyncStorage.getItem(keyFor(space));
    cache = raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  cachedSpace = space;
  return cache;
}

async function persist(space: string, value: SpaceSettings): Promise<void> {
  cache = value;
  cachedSpace = space;
  try {
    if (space) await AsyncStorage.setItem(keyFor(space), JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// Pull the shared, cross-device settings from the server and merge them over
// the local copy. Returns null when unavailable (offline / not signed in) so
// callers keep the local values.
export async function syncSettingsFromServer(space: string): Promise<SpaceSettings | null> {
  if (!space) return null;
  try {
    const { settings } = await api.getSettings();
    if (!settings || Object.keys(settings).length === 0) return null;
    const merged = normalize({ ...cache, ...settings });
    await persist(space, merged);
    return merged;
  } catch {
    return null;
  }
}

// -- React context ----------------------------------------------------------

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
  const [settings, setSettings] = useState<SpaceSettings>(() =>
    cachedSpace === space ? cache : { ...DEFAULT_SETTINGS },
  );

  useEffect(() => {
    let alive = true;
    // Instant paint from the local cache, then hydrate from the server so
    // preferences follow the space across devices.
    loadSettings(space).then(s => {
      if (alive) setSettings(s);
      return syncSettingsFromServer(space);
    }).then(remote => {
      if (alive && remote) setSettings(remote);
    });
    return () => {
      alive = false;
    };
  }, [space]);

  const update = useCallback(
    (patch: Partial<SpaceSettings>) => {
      setSettings(prev => {
        const next = { ...prev, ...patch };
        void persist(space, next);
        return next;
      });
      // Push just the changed keys; the server merges them into the shared blob.
      void api.patchSettings(patch as Record<string, unknown>).catch(() => {});
    },
    [space],
  );

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS };
    void persist(space, next);
    setSettings(next);
    void api
      .patchSettings(next as unknown as Record<string, unknown>)
      .catch(() => {});
  }, [space]);

  const value = useMemo<Ctx>(() => ({ settings, update, reset }), [settings, update, reset]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (ctx) return ctx;
  return { settings: { ...DEFAULT_SETTINGS }, update: () => {}, reset: () => {} };
}
