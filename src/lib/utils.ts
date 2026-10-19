import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `₹${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

// Short axis labels so big totals ("14,000") don't overflow a narrow chart
// gutter and get clipped to "4,000". 14000 → "14k", 10500 → "10.5k", 2.5M → "2.5M".
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const short = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1);
  };
  if (abs >= 1_000_000) return `${short(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${short(value / 1_000)}k`;
  return formatNumber(value);
}

/**
 * Parse an expense date. A bare `YYYY-MM-DD` is pinned to 12:00 UTC so it
 * lands on the same calendar day in every timezone (UTC midnight shows up as
 * the previous day west of Greenwich).
 */
export function parseExpenseDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : new Date(value);
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
