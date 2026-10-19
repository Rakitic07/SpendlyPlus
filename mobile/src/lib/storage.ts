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

// Thumbnail rows already on disk (row key -> stored data URL). Lets writeCache
// skip re-writing hundreds of KB of unchanged base64 on every save.
const writtenThumbs = new Map<string, string>();
// Spaces whose leftover thumbnail rows were swept once this session.
const sweptSpaces = new Set<string>();
// Serialize cache writes so overlapping saves can't interleave.
let writeChain: Promise<void> = Promise.resolve();

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
        if (e.thumbnail === THUMB_REF) {
          const t = byId.get(e.id) ?? null;
          e.thumbnail = t;
          if (t) writtenThumbs.set(thumbKey(space, e.id), t);
        }
      }
    }
    return list;
  } catch {
    return [];
  }
}

export function writeCache(space: string, expenses: Expense[]): Promise<void> {
  writeChain = writeChain.then(() => doWriteCache(space, expenses));
  return writeChain;
}

async function doWriteCache(space: string, expenses: Expense[]): Promise<void> {
  try {
    const wanted = new Set<string>();
    const changed: [string, string][] = [];
    const light = expenses.map(e => {
      if (e.thumbnail) {
        const k = thumbKey(space, e.id);
        wanted.add(k);
        if (writtenThumbs.get(k) !== e.thumbnail) changed.push([k, e.thumbnail]);
        return { ...e, thumbnail: THUMB_REF };
      }
      return e;
    });

    await AsyncStorage.setItem(cacheKey(space), JSON.stringify(light));
    for (const [k, v] of changed) {
      await AsyncStorage.setItem(k, v);
      writtenThumbs.set(k, v);
    }

    // Drop thumbnail rows for expenses that were deleted or had their image
    // cleared, so they don't leak storage over time. A full key scan runs once
    // per space per session; after that the in-memory map is enough.
    const prefix = thumbPrefix(space);
    let orphans: string[];
    if (!sweptSpaces.has(space)) {
      sweptSpaces.add(space);
      const allKeys = await AsyncStorage.getAllKeys();
      orphans = allKeys.filter(k => k.startsWith(prefix) && !wanted.has(k));
    } else {
      orphans = [...writtenThumbs.keys()].filter(k => k.startsWith(prefix) && !wanted.has(k));
    }
    for (const k of orphans) writtenThumbs.delete(k);
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
