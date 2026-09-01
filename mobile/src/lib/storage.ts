import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Expense } from './types';

// -- Auth token -------------------------------------------------------------
// The native app authenticates with a Bearer token (signed JWT from the
// backend). We keep an in-memory copy so api.ts can attach it synchronously,
// and persist it to AsyncStorage so it survives restarts.

const TOKEN_KEY = 'spendly_token';
let tokenCache: string | null = null;

export async function loadToken(): Promise<string | null> {
  try {
    tokenCache = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    tokenCache = null;
  }
  return tokenCache;
}

export function getTokenSync(): string | null {
  return tokenCache;
}

export async function setToken(token: string | null): Promise<void> {
  tokenCache = token;
  try {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
}

// -- Last space + currency --------------------------------------------------

const LAST_SPACE_KEY = 'spendly_last_space';

export async function getLastSpace(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_SPACE_KEY);
  } catch {
    return null;
  }
}

export async function setLastSpace(space: string | null): Promise<void> {
  try {
    if (space) await AsyncStorage.setItem(LAST_SPACE_KEY, space);
    else await AsyncStorage.removeItem(LAST_SPACE_KEY);
  } catch {
    /* ignore */
  }
}

function currencyKey(space: string): string {
  return `spendly.currency.${space}`;
}

export async function getCurrencyCode(space: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(currencyKey(space));
  } catch {
    return null;
  }
}

export async function setCurrencyCode(space: string, code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(currencyKey(space), code);
  } catch {
    /* ignore */
  }
}

// -- Expense cache (offline-first) ------------------------------------------

function cacheKey(space: string): string {
  return `spendly.cache.${space}`;
}

function thumbPrefix(space: string): string {
  return `spendly.thumb.${space}.`;
}

function thumbKey(space: string, id: string): string {
  return `${thumbPrefix(space)}${id}`;
}

// Sentinel we store in the main cache blob in place of the actual base64
// thumbnail. The image itself lives in its own AsyncStorage row.
const THUMB_REF = '\u0000thumb';

// IMPORTANT: bill thumbnails can be 100-500KB of base64. Android's AsyncStorage
// is SQLite-backed and a single row must fit into a ~2MB CursorWindow — packing
// every thumbnail into the one cache blob quickly blows past that and crashes
// the app with "Row too big to fit into CursorWindow" on the next read. So we
// keep the main blob lightweight (thumbnails replaced by a sentinel) and store
// each image in its own small row, well under the limit.

export async function readCache(space: string): Promise<Expense[]> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(space));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list = parsed as Expense[];

    const refs = list.filter(e => e.thumbnail === THUMB_REF);
    if (refs.length) {
      const loaded = await Promise.all(
        refs.map(async e => [e.id, await AsyncStorage.getItem(thumbKey(space, e.id))] as const),
      );
      const byId = new Map(loaded);
      for (const e of list) {
        if (e.thumbnail === THUMB_REF) e.thumbnail = byId.get(e.id) ?? null;
      }
    }
    return list;
  } catch {
    return [];
  }
}

export async function writeCache(space: string, expenses: Expense[]): Promise<void> {
  try {
    const thumbSets: [string, string][] = [];
    const light = expenses.map(e => {
      if (e.thumbnail) {
        thumbSets.push([thumbKey(space, e.id), e.thumbnail]);
        return { ...e, thumbnail: THUMB_REF };
      }
      return e;
    });

    await AsyncStorage.setItem(cacheKey(space), JSON.stringify(light));
    await Promise.all(thumbSets.map(([k, v]) => AsyncStorage.setItem(k, v)));

    // Drop thumbnail rows for expenses that were deleted or had their image
    // cleared, so they don't leak storage over time.
    const prefix = thumbPrefix(space);
    const wanted = new Set(thumbSets.map(([k]) => k));
    const allKeys = await AsyncStorage.getAllKeys();
    const orphans = allKeys.filter(k => k.startsWith(prefix) && !wanted.has(k));
    await Promise.all(orphans.map(k => AsyncStorage.removeItem(k)));
  } catch {
    /* ignore */
  }
}

// -- Budget cache -----------------------------------------------------------

function budgetKey(space: string): string {
  return `spendly.budget.${space}`;
}

export async function readBudgetCache(space: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(budgetKey(space));
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function writeBudgetCache(space: string, budget: number | null): Promise<void> {
  try {
    if (budget == null) await AsyncStorage.removeItem(budgetKey(space));
    else await AsyncStorage.setItem(budgetKey(space), String(budget));
  } catch {
    /* ignore */
  }
}
