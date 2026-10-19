import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getCurrencyCode, setCurrencyCode } from './storage';

export type Currency = { code: string; symbol: string; label: string; locale: string };

export const CURRENCIES: Currency[] = [
  { code: 'INR', symbol: '₹', label: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', label: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', label: 'Euro', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', label: 'British Pound', locale: 'en-GB' },
  { code: 'JPY', symbol: '¥', label: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'AUD', symbol: 'A$', label: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham', locale: 'en-AE' },
  { code: 'CHF', symbol: 'CHF', label: 'Swiss Franc', locale: 'de-CH' },
  { code: 'CNY', symbol: '¥', label: 'Chinese Yuan', locale: 'zh-CN' },
];

const DEFAULT = CURRENCIES[0];

export function currencyMeta(code: string): Currency {
  return CURRENCIES.find(c => c.code === code) ?? DEFAULT;
}

// Constructing Intl.NumberFormat is slow on Hermes and `format` runs for every
// row on every render, so keep one formatter per currency + fraction mode.
const formatterCache = new Map<string, Intl.NumberFormat | null>();

function formatWith(cur: Currency, v: number): string {
  const frac = v % 1 === 0 ? 0 : 2;
  const key = `${cur.code}|${frac}`;
  let f = formatterCache.get(key);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat(cur.locale, {
        style: 'currency',
        currency: cur.code,
        maximumFractionDigits: frac,
      });
    } catch {
      f = null;
    }
    formatterCache.set(key, f);
  }
  return f ? f.format(v) : `${cur.symbol}${v.toFixed(2)}`;
}

const fallbackCtx: Ctx = {
  currency: DEFAULT,
  setCurrency: () => {},
  format: (v: number) => formatWith(DEFAULT, v),
};

type Ctx = {
  currency: Currency;
  setCurrency: (code: string) => void;
  format: (value: number) => string;
};

const CurrencyContext = createContext<Ctx | null>(null);

export function CurrencyProvider({
  space,
  children,
}: {
  space: string;
  children: React.ReactNode;
}) {
  const [code, setCode] = useState<string>(DEFAULT.code);

  useEffect(() => {
    let alive = true;
    if (!space) {
      setCode(DEFAULT.code);
      return;
    }
    getCurrencyCode(space).then(saved => {
      if (!alive) return;
      setCode(saved && currencyMeta(saved).code === saved ? saved : DEFAULT.code);
    });
    return () => {
      alive = false;
    };
  }, [space]);

  const setCurrency = useCallback(
    (next: string) => {
      setCode(next);
      if (space) void setCurrencyCode(space, next);
    },
    [space],
  );

  const value = useMemo<Ctx>(() => {
    const cur = currencyMeta(code);
    return { currency: cur, setCurrency, format: (v: number) => formatWith(cur, v) };
  }, [code, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): Ctx {
  const ctx = useContext(CurrencyContext);
  return ctx ?? fallbackCtx;
}
