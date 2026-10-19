import { useSyncExternalStore } from 'react';

// Active visual theme, held outside React so components mounted above the
// SettingsProvider (the global Background) can follow it too. SettingsProvider
// is the only writer.

export type ThemeName = 'glass' | 'neo';

let current: ThemeName = 'glass';
const listeners = new Set<() => void>();

export function setThemeMode(next: ThemeName): void {
  if (next === current) return;
  current = next;
  listeners.forEach(l => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getThemeMode(): ThemeName {
  return current;
}

export function useNeo(): boolean {
  return useSyncExternalStore(subscribe, getThemeMode) === 'neo';
}
