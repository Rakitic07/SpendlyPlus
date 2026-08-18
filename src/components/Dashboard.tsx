"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  TrendingUp,
  CalendarDays,
  Wallet,
  Layers,
  PieChart as PieIcon,
  BarChart3,
  Users,
  Search,
  Trophy,
  Flame,
  Repeat,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  AlertTriangle,
} from "lucide-react";
import type { Expense } from "@/lib/types";
import {
  byCategory,
  byPaidBy,
  dailyTotals,
  inMonth,
  inYear,
  monthlyTrend,
  sum,
  yearlyTotals,
  availableYears,
  insights as computeInsights,
  pctChange,
} from "@/lib/analytics";
import { MONTH_LABELS, cn } from "@/lib/utils";
import { categoryMeta, CATEGORY_NAMES } from "@/lib/categories";
import { useCurrency } from "@/lib/currency";
import { useSettings } from "@/lib/settings";
import dynamic from "next/dynamic";
import ExpenseList from "./ExpenseList";
import BudgetRing from "./BudgetRing";
import DatePicker from "./DatePicker";
// The report modal pulls in the PDF/Excel export libs, so it's split out of the
// initial bundle and only mounted after the user first opens it.
const ReportModal = dynamic(() => import("./ReportModal"), { ssr: false });

// Recharts is heavy, so the charts are code-split out of the initial bundle and
// loaded on demand. This keeps first load (especially on phones) fast; a light
// skeleton holds the layout while each chart's chunk streams in.
const ChartFallback = () => (
  <div className="skeleton h-[280px] w-full rounded-2xl" />
);
const CategoryDonut = dynamic(() => import("./charts/CategoryDonut"), {
  ssr: false,
  loading: ChartFallback,
});
const TrendArea = dynamic(() => import("./charts/TrendArea"), {
  ssr: false,
  loading: ChartFallback,
});
const Bars = dynamic(() => import("./charts/Bars"), {
  ssr: false,
  loading: ChartFallback,
});

type View = "day" | "month" | "year" | "all";

function toDayValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function sameCalendarDay(iso: string, dayStr: string): boolean {
  const d = new Date(iso);
  const [y, m, day] = dayStr.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day;
}

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-3xl p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white/70">
        {icon}
        <span className="shimmer-hover">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="glass rounded-3xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-white/55">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: accent + "33" }}>
          {icon}
        </span>
      </div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <div className="mt-0.5 text-xs text-white/50">{sub}</div>}
    </div>
  );
}

function InsightCard({
  icon,
  accent,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  accent: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl p-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: accent + "33" }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-white/45">{label}</p>
        <p className="truncate font-semibold">{value}</p>
        {sub && <p className="truncate text-xs text-white/50">{sub}</p>}
      </div>
    </div>
  );
}

type MobileTab = "overview" | "charts" | "activity";

export default function Dashboard({
  expenses,
  readOnly,
  onEdit,
  budget = null,
  onSetBudget,
  mobileTab = "overview",
  tabbed = false,
  spaceName = "",
  onToast,
}: {
  expenses: Expense[];
  readOnly?: boolean;
  onEdit?: (e: Expense) => void;
  // Budget is a per-space setting synced to the DB and owned by the parent.
  budget?: number | null;
  onSetBudget?: (value: number | null) => void;
  // On phones the content is split into tabs driven by a bottom nav bar. On
  // desktop (sm+) every section is always shown, so this only affects mobile.
  mobileTab?: MobileTab;
  // Only the native app uses the tabbed phone layout. In a mobile browser / PWA
  // we show the regular stacked website layout (every section, always visible).
  tabbed?: boolean;
  // Current space name, used to title exported reports.
  spaceName?: string;
  // Toast callback (owned by the parent) for report-download confirmations.
  onToast?: (message: string) => void;
}) {
  // On phones (native tabbed layout) MOUNT only the active tab's section instead
  // of rendering all three and CSS-hiding the inactive ones. The charts section
  // mounts heavy Recharts SVGs; keeping them in the DOM even while hidden costs
  // memory and extra compositor layers that make scrolling the Overview/Activity
  // tabs janky. Mounting just the visible tab keeps the DOM small and scrolling
  // smooth. Non-tabbed (desktop + mobile browser/PWA) still shows every section.
  const show = (tab: MobileTab) => !tabbed || mobileTab === tab;
  const { settings } = useSettings();
  const now = new Date();
  const years = useMemo(() => availableYears(expenses), [expenses]);
  const [view, setView] = useState<View>(settings.defaultPeriod);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [day, setDay] = useState(toDayValue(now));
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("");
  // On web/PWA the charts sit at the bottom (after transactions) and stay
  // collapsed until the user opens them — this keeps first paint light and only
  // mounts the heavy Recharts SVGs on demand. The native app keeps charts as a
  // dedicated bottom-nav tab, so this toggle is ignored there.
  const [chartsOpen, setChartsOpen] = useState(!settings.chartsCollapsed);
  // Report export modal (web / PWA / desktop only — downloads are unreliable in
  // the packaged native WebView, so the button is hidden there).
  const [reportOpen, setReportOpen] = useState(false);
  // Load the (heavy) report modal only once it's been opened, then keep it
  // mounted so its close animation stays smooth.
  const [reportLoaded, setReportLoaded] = useState(false);

  const { format: formatCurrency } = useCurrency();

  const filtered = useMemo(() => {
    if (view === "all") return expenses;
    if (view === "year") return expenses.filter((e) => inYear(e, year));
    if (view === "day") return expenses.filter((e) => sameCalendarDay(e.date, day));
    return expenses.filter((e) => inMonth(e, year, month));
  }, [expenses, view, year, month, day]);

  const total = sum(filtered);
  const cats = useMemo(() => byCategory(filtered), [filtered]);
  const payers = useMemo(() => byPaidBy(filtered), [filtered]);
  const topCat = cats[0];
  const ins = useMemo(() => computeInsights(filtered), [filtered]);

  // vs previous period (only meaningful for month / year views)
  const prevTotal = useMemo(() => {
    if (view === "month") {
      const p = new Date(year, month - 1, 1);
      return sum(expenses.filter((e) => inMonth(e, p.getFullYear(), p.getMonth())));
    }
    if (view === "year") return sum(expenses.filter((e) => inYear(e, year - 1)));
    return 0;
  }, [expenses, view, year, month]);
  const delta = view === "all" || view === "day" ? null : pctChange(total, prevTotal);

  // Day context, shared by the budget-pacing card and the monthly average so
  // the two never disagree.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  // For an in-progress month, average over the days *so far* (not all 30/31)
  // so "avg / day" reflects the real pace instead of being diluted.
  const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth;
  const daysLeft = isCurrentMonth ? Math.max(0, daysInMonth - now.getDate()) : 0;

  const periodDivisor =
    view === "month"
      ? daysElapsed
      : view === "year"
        ? 12
        : view === "day"
          ? Math.max(1, filtered.length)
          : Math.max(1, yearlyTotals(expenses).length);
  const avgLabel =
    view === "month"
      ? "avg / day"
      : view === "year"
        ? "avg / month"
        : view === "day"
          ? "avg / txn"
          : "avg / year";

  // Charts are collapsed by default on web/PWA, so only build the (relatively
  // heavy) trend/bar series when the charts are actually on screen. This skips
  // the work entirely on every view/filter/page change while charts are hidden.
  const chartsVisible = show("charts") && (tabbed || chartsOpen);

  const trendData = useMemo<{ month: string; total: number }[]>(
    () =>
      !chartsVisible
        ? []
        : view === "month"
          ? dailyTotals(filtered, year, month).map((d) => ({ month: d.day, total: d.total }))
          : view === "year"
            ? monthlyTrend(filtered, year)
            : monthlyTrend(expenses.filter((e) => inYear(e, year)), year),
    [chartsVisible, view, filtered, year, month, expenses]
  );

  const barData = useMemo<{ label: string; total: number }[]>(
    () =>
      !chartsVisible
        ? []
        : view === "all"
          ? yearlyTotals(expenses).map((y) => ({ label: y.year, total: y.total }))
          : view === "year"
            ? monthlyTrend(filtered, year).map((m) => ({ label: m.month, total: m.total }))
            : dailyTotals(filtered, year, month).map((d) => ({ label: d.day, total: d.total })),
    [chartsVisible, view, expenses, filtered, year, month]
  );

  // Transactions list: apply search + category filter on top of the period.
  const listExpenses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filtered.filter((e) => {
      if (catFilter && e.category !== catFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        e.paidBy.toLowerCase().includes(q) ||
        (e.notes ?? "").toLowerCase().includes(q) ||
        (e.paymentMode ?? "").toLowerCase().includes(q) ||
        (e.paymentDetail ?? "").toLowerCase().includes(q)
      );
    });
  }, [filtered, query, catFilter]);

  // Paginate the transaction list: 5 per page with a sliding transition.
  const PAGE_SIZE = 5;
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(0); // slide direction: 1 = next, -1 = prev
  const totalPages = Math.max(1, Math.ceil(listExpenses.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = listExpenses.slice(
    clampedPage * PAGE_SIZE,
    clampedPage * PAGE_SIZE + PAGE_SIZE
  );

  // Jump back to page 1 whenever the underlying set (view/filters) changes.
  useEffect(() => {
    setPage(0);
    setDir(0);
  }, [view, year, month, day, query, catFilter]);

  function goToPage(delta: number) {
    setDir(delta);
    setPage((p) => Math.min(Math.max(0, p + delta), totalPages - 1));
  }

  const periodLabel =
    view === "month"
      ? `${MONTH_LABELS[month]} ${year}`
      : view === "year"
        ? String(year)
        : view === "day"
          ? new Date(day).toLocaleDateString("en-IN", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "All time";

  const chartsGrid = (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Spending by category" icon={<PieIcon className="h-4 w-4" />}>
        <CategoryDonut data={cats} />
      </ChartCard>

      {/* Trend / bar charts aren't meaningful for a single day. */}
      {view !== "day" && (
        <ChartCard
          title={
            view === "month"
              ? "Daily spending"
              : view === "year"
                ? "Monthly trend"
                : "Yearly totals"
          }
          icon={<BarChart3 className="h-4 w-4" />}
        >
          {view === "year" ? <TrendArea data={trendData} /> : <Bars data={barData} />}
        </ChartCard>
      )}

      {view !== "day" && (
        <ChartCard
          title={view === "month" ? "Trend across the month" : "Trend over time"}
          icon={<TrendingUp className="h-4 w-4" />}
        >
          <TrendArea data={trendData} />
        </ChartCard>
      )}

      <ChartCard title="Who paid" icon={<Users className="h-4 w-4" />}>
        <CategoryDonut data={payers} />
      </ChartCard>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
          {(["day", "month", "year", "all"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-xl px-4 py-1.5 text-sm font-medium capitalize transition",
                view === v ? "bg-white/20 text-white shadow-glass-sm" : "text-white/55 hover:text-white"
              )}
            >
              {v === "all" ? "All time" : v}
            </button>
          ))}
        </div>

        {/* Pick a specific day from the calendar. */}
        {view === "day" && <DatePicker value={day} onChange={setDay} />}

        {(view === "month" || view === "year") && (
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none backdrop-blur-xl"
          >
            {years.map((y) => (
              <option key={y} value={y} className="bg-[#0b1030]">
                {y}
              </option>
            ))}
          </select>
        )}

        {view === "month" && (
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none backdrop-blur-xl"
          >
            {MONTH_LABELS.map((m, i) => (
              <option key={m} value={i} className="bg-[#0b1030]">
                {m}
              </option>
            ))}
          </select>
        )}

        {/* Export a PDF / Excel report for any period (web · PWA · desktop). */}
        {!tabbed && (
          <button
            type="button"
            onClick={() => {
              setReportLoaded(true);
              setReportOpen(true);
            }}
            className="glass-btn ml-auto px-3 py-2 text-sm"
            aria-label="Download report"
            title="Download a PDF / Excel report"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Report</span>
          </button>
        )}
      </div>

      {!tabbed && reportLoaded && (
        <ReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          expenses={expenses}
          spaceName={spaceName}
          initialView={view}
          initialYear={year}
          initialMonth={month}
          initialDay={day}
          onDone={onToast}
        />
      )}

      {/* ── Overview tab (mobile) ───────────────────────────────────────── */}
      {show("overview") && (
      <div className="space-y-6">
      {/* Budget alert (opt-in). Fires as spending nears (≥90%) or passes the
          monthly budget — a clear, dismissible-by-setting nudge. */}
      {view === "month" &&
        settings.budgetAlerts &&
        budget != null &&
        budget > 0 &&
        total >= budget * 0.9 && (
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium",
              total > budget
                ? "border-red-400/30 bg-red-500/10 text-red-200"
                : "border-amber-400/30 bg-amber-500/10 text-amber-200"
            )}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {total > budget
                ? `You're ${formatCurrency(total - budget)} over your monthly budget.`
                : `You've used ${Math.round((total / budget) * 100)}% of your monthly budget.`}
            </span>
          </div>
        )}

      {/* Budget ring (month view) */}
      {view === "month" && !readOnly && onSetBudget && (
        <BudgetRing
          spent={total}
          budget={budget}
          periodLabel="Monthly"
          onSetBudget={onSetBudget}
          daysInMonth={daysInMonth}
          daysElapsed={daysElapsed}
          daysLeft={daysLeft}
        />
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Total spent"
          value={formatCurrency(total)}
          sub={
            delta == null ? (
              `${filtered.length} transactions`
            ) : (
              <span className={cn("inline-flex items-center gap-1", delta > 0 ? "text-red-300" : "text-emerald-300")}>
                {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(delta).toFixed(0)}% vs last {view}
              </span>
            )
          }
          icon={<Wallet className="h-4 w-4 text-[#7c8cff]" />}
          accent="#7c8cff"
        />
        <Stat
          label={avgLabel}
          value={formatCurrency(total / periodDivisor)}
          sub={`${filtered.length} transactions`}
          icon={<TrendingUp className="h-4 w-4 text-[#38d9a9]" />}
          accent="#38d9a9"
        />
        <Stat
          label="Top category"
          value={topCat ? topCat.name : "—"}
          sub={topCat ? formatCurrency(topCat.value) : undefined}
          icon={<Layers className="h-4 w-4 text-[#ff6bd0]" />}
          accent="#ff6bd0"
        />
        <Stat
          label="Categories used"
          value={String(cats.length)}
          sub={payers.length ? `${payers.length} payer(s)` : undefined}
          icon={<CalendarDays className="h-4 w-4 text-[#ffd43b]" />}
          accent="#ffd43b"
        />
      </div>

      {/* Insights */}
      {ins.count > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <InsightCard
            icon={<Trophy className="h-5 w-5 text-[#ffd43b]" />}
            accent="#ffd43b"
            label="Biggest expense"
            value={ins.biggest ? `${formatCurrency(ins.biggest.amount)}` : "—"}
            sub={ins.biggest ? `${ins.biggest.title} · ${ins.biggest.category}` : undefined}
          />
          <InsightCard
            icon={<Flame className="h-5 w-5 text-[#ff6b6b]" />}
            accent="#ff6b6b"
            label="Busiest day"
            value={
              ins.busiestDay
                ? new Date(ins.busiestDay.date).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                  })
                : "—"
            }
            sub={ins.busiestDay ? formatCurrency(ins.busiestDay.total) : undefined}
          />
          <InsightCard
            icon={<Repeat className="h-5 w-5 text-[#38d9a9]" />}
            accent="#38d9a9"
            label="Most frequent"
            value={ins.frequentCategory ? ins.frequentCategory.name : "—"}
            sub={ins.frequentCategory ? `${ins.frequentCategory.count} times` : undefined}
          />
        </div>
      )}
      </div>
      )}

      {/* ── Activity tab (mobile) ───────────────────────────────────────── */}
      {/* List */}
      {show("activity") && (
      <div>
        <div className="mb-3 flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-medium text-white/70">
            Transactions · {periodLabel}
          </h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="glass-input w-40 py-2 pl-9 text-sm sm:w-52"
              />
            </div>
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none backdrop-blur-xl"
            >
              <option value="" className="bg-[#0b1030]">
                All categories
              </option>
              {CATEGORY_NAMES.map((c) => (
                <option key={c} value={c} className="bg-[#0b1030]">
                  {categoryMeta(c).emoji} {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/* Paged list: the whole page slides out and the next one slides in.
            `popLayout` keeps the incoming page in normal flow (and pops the
            outgoing one to absolute) so the list height never collapses to zero
            mid-transition — that collapse was yanking the whole page up to the
            top and pushing the pager arrows out of view. */}
        <div className="relative overflow-hidden">
          <AnimatePresence mode="popLayout" custom={dir} initial={false}>
            <motion.div
              key={clampedPage}
              custom={dir}
              variants={{
                enter: (d: number) => ({ x: d >= 0 ? 48 : -48, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: d >= 0 ? -48 : 48, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <ExpenseList expenses={pageItems} onEdit={onEdit} readOnly={readOnly} />
            </motion.div>
          </AnimatePresence>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => goToPage(-1)}
              disabled={clampedPage === 0}
              className="glass-btn px-3 py-2 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[6rem] text-center text-sm text-white/60">
              Page {clampedPage + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(1)}
              disabled={clampedPage >= totalPages - 1}
              className="glass-btn px-3 py-2 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      )}

      {/* ── Charts ───────────────────────────────────────────────────────
          Web/PWA: charts live at the bottom (after transactions) inside a
          collapsible panel that starts closed — expand to mount them. Native:
          charts are their own bottom-nav tab, rendered in full. */}
      {show("charts") &&
        (tabbed ? (
          chartsGrid
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setChartsOpen((o) => !o)}
              aria-expanded={chartsOpen}
              className="glass flex w-full items-center justify-between rounded-3xl px-5 py-4 text-sm font-medium text-white/70 transition hover:text-white"
            >
              <span className="flex items-center gap-2">
                <PieIcon className="h-4 w-4" />
                Charts &amp; trends
              </span>
              <span className="flex items-center gap-1.5 text-xs text-white/45">
                {chartsOpen ? "Hide" : "Show"}
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", chartsOpen && "rotate-180")}
                />
              </span>
            </button>
            {chartsOpen && chartsGrid}
          </div>
        ))}
    </div>
  );
}
