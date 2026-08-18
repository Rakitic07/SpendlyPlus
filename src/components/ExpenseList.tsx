"use client";

import { Pencil } from "lucide-react";
import type { Expense } from "@/lib/types";
import { categoryMeta } from "@/lib/categories";
import { useCurrency } from "@/lib/currency";
import { useSettings } from "@/lib/settings";
import { paymentLabel } from "@/lib/payments";

function dayStart(iso: string): number {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Newest day first, and within a day the most recently added entry on top.
// Same-calendar-day rows share a date-only value, so `createdAt` is the
// tiebreaker that puts the latest entry first.
function orderForDisplay(expenses: Expense[]): Expense[] {
  return [...expenses].sort((a, b) => {
    const dayDiff = dayStart(b.date) - dayStart(a.date);
    if (dayDiff !== 0) return dayDiff;
    return (
      (new Date(b.createdAt).getTime() || 0) -
      (new Date(a.createdAt).getTime() || 0)
    );
  });
}

function groupByDay(expenses: Expense[]): [string, Expense[]][] {
  const map = new Map<string, Expense[]>();
  for (const e of expenses) {
    const d = new Date(e.date);
    const key = d.toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries());
}

function dayLabel(key: string): string {
  const d = new Date(key);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function ExpenseList({
  expenses,
  onEdit,
  readOnly,
}: {
  expenses: Expense[];
  onEdit?: (e: Expense) => void;
  readOnly?: boolean;
}) {
  const { format } = useCurrency();
  const { settings } = useSettings();

  if (expenses.length === 0) {
    return (
      <div className="glass rounded-3xl p-10 text-center text-white/50">
        No expenses in this period yet. Tap{" "}
        <span className="font-semibold text-white/80">Add</span> to log your first one.
      </div>
    );
  }

  const groups = groupByDay(orderForDisplay(expenses));

  return (
    <div className="space-y-6">
      {groups.map(([key, items]) => {
        const dayTotal = items.reduce((a, b) => a + b.amount, 0);
        return (
          <div key={key}>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-medium text-white/70">{dayLabel(key)}</span>
              <span className="text-sm font-semibold text-white/90">
                {format(dayTotal)}
              </span>
            </div>
            <div className="space-y-2">
              {items.map((e) => {
                const meta = categoryMeta(e.category);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => !readOnly && onEdit?.(e)}
                    className="glass group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-white/[0.16]"
                  >
                    {e.thumbnail && settings.showThumbnails ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.thumbnail}
                        alt="Bill"
                        className="h-11 w-11 shrink-0 rounded-xl border border-white/15 object-cover"
                      />
                    ) : (
                      <span
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg"
                        style={{ background: meta.color + "33", border: `1px solid ${meta.color}55` }}
                      >
                        {meta.emoji}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{e.title}</p>
                      <p className="truncate text-xs text-white/55">
                        {e.category} · {e.paidBy}
                        {paymentLabel(e.paymentMode, e.paymentDetail)
                          ? ` · ${paymentLabel(e.paymentMode, e.paymentDetail)}`
                          : ""}
                        {e.notes ? ` · ${e.notes}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold">{format(e.amount)}</span>
                    {!readOnly && (
                      <Pencil className="h-4 w-4 shrink-0 text-white/0 transition group-hover:text-white/50" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
