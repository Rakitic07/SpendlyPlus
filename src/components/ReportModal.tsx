"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, FileText, FileSpreadsheet, Download, Check } from "lucide-react";
import type { Expense } from "@/lib/types";
import { cn, MONTH_LABELS } from "@/lib/utils";
import { availableYears } from "@/lib/analytics";
import { useCurrency } from "@/lib/currency";
import { generateReport } from "@/lib/report";
import type { ReportSectionKey, ReportView } from "@/lib/report";
import { filterByPeriod } from "@/lib/report/data";
import { useEscape } from "@/lib/useEscape";
import DatePicker from "./DatePicker";
import { ShimmerText } from "./Shimmer";

const SECTION_DEFS: { key: ReportSectionKey; label: string; note?: string }[] = [
  { key: "summary", label: "Summary & key stats" },
  { key: "charts", label: "Charts", note: "Bar charts in PDF · trend sheet in Excel" },
  { key: "categories", label: "Category breakdown" },
  { key: "payers", label: "Paid-by breakdown" },
  { key: "insights", label: "Insights (biggest, busiest day…)" },
  { key: "transactions", label: "Full transactions list" },
];

function toDayValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function ReportModal({
  open,
  onClose,
  expenses,
  spaceName,
  initialView = "month",
  initialYear,
  initialMonth,
  initialDay,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  expenses: Expense[];
  spaceName: string;
  initialView?: ReportView;
  initialYear?: number;
  initialMonth?: number;
  initialDay?: string;
  onDone?: (message: string) => void;
}) {
  const now = new Date();
  const { currency } = useCurrency();
  const years = useMemo(() => availableYears(expenses), [expenses]);

  const [format, setFormat] = useState<"pdf" | "excel">("pdf");
  const [view, setView] = useState<ReportView>(initialView);
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = useState(initialMonth ?? now.getMonth());
  const [day, setDay] = useState(initialDay ?? toDayValue(now));
  const [sections, setSections] = useState<Record<ReportSectionKey, boolean>>({
    summary: true,
    charts: true,
    categories: true,
    payers: true,
    insights: true,
    transactions: true,
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(
    () => ({ view, year, month, day }),
    [view, year, month, day]
  );
  const countInPeriod = useMemo(
    () => filterByPeriod(expenses, period).length,
    [expenses, period]
  );

  // Charts don't apply to a single day; hide that toggle in day view.
  const visibleSections = SECTION_DEFS.filter(
    (s) => !(s.key === "charts" && view === "day")
  );
  const anySection = visibleSections.some((s) => sections[s.key]);

  useEscape(open, () => {
    if (!generating) onClose();
  });

  function toggle(key: ReportSectionKey) {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function onGenerate() {
    if (!anySection || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await generateReport(expenses, {
        format,
        period,
        sections,
        spaceName,
        currencyCode: currency.code,
        currencyLocale: currency.locale,
        currencySymbol: currency.symbol,
      });
      onDone?.(
        res.empty
          ? "Report downloaded (no expenses in this period)"
          : `Report downloaded · ${res.filename}`
      );
      onClose();
    } catch {
      setError("Couldn't generate the report. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Download report"
            className="glass-strong relative z-10 max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-4xl p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:max-w-lg sm:rounded-4xl sm:pb-6"
          >
            {generating && (
              <div className="absolute inset-0 z-20 grid place-items-center gap-2 rounded-t-4xl bg-black/70 sm:rounded-4xl">
                <div className="flex flex-col items-center gap-2">
                  <ShimmerText className="text-base">
                    Generating your {format === "pdf" ? "PDF" : "Excel"} report…
                  </ShimmerText>
                  <p className="text-xs text-white/50">Crunching {countInPeriod} transactions</p>
                </div>
              </div>
            )}

            <div className="mb-5 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Download className="h-5 w-5 text-[#7c8cff]" />
                Download report
              </h3>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Format */}
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/45">
              Format
            </p>
            <div className="mb-5 grid grid-cols-2 gap-3">
              <FormatCard
                active={format === "pdf"}
                onClick={() => setFormat("pdf")}
                icon={<FileText className="h-5 w-5" />}
                title="PDF"
                sub="Charts + tables"
              />
              <FormatCard
                active={format === "excel"}
                onClick={() => setFormat("excel")}
                icon={<FileSpreadsheet className="h-5 w-5" />}
                title="Excel"
                sub="Multi-sheet data"
              />
            </div>

            {/* Period */}
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/45">
              Period
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
                {(["day", "month", "year", "all"] as ReportView[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      "rounded-xl px-3.5 py-1.5 text-sm font-medium capitalize transition",
                      view === v
                        ? "bg-white/20 text-white shadow-glass-sm"
                        : "text-white/55 hover:text-white"
                    )}
                  >
                    {v === "all" ? "All time" : v}
                  </button>
                ))}
              </div>
              {view === "day" && <DatePicker value={day} onChange={setDay} />}
              {(view === "month" || view === "year") && (
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none"
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
                  className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm outline-none"
                >
                  {MONTH_LABELS.map((m, i) => (
                    <option key={m} value={i} className="bg-[#0b1030]">
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="mb-5 text-xs text-white/45">
              {countInPeriod > 0
                ? `${countInPeriod} transaction${countInPeriod > 1 ? "s" : ""} in this period`
                : "No transactions in this period yet"}
            </p>

            {/* Sections */}
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-white/45">
              Include in report
            </p>
            <div className="mb-6 space-y-2">
              {visibleSections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => toggle(s.key)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-left transition hover:bg-white/10"
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition",
                      sections[s.key]
                        ? "border-transparent bg-gradient-to-br from-[#7c8cff] to-[#ff6bd0]"
                        : "border-white/25"
                    )}
                  >
                    {sections[s.key] && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.label}</span>
                    {s.note && (
                      <span className="block text-xs text-white/40">{s.note}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>

            {error && (
              <p className="mb-3 rounded-xl border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb3b3]">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={onGenerate}
              disabled={!anySection || generating}
              className="glass-btn-primary w-full py-3.5"
            >
              <Download className="h-4 w-4" />
              {generating
                ? "Generating…"
                : `Download ${format === "pdf" ? "PDF" : "Excel"}`}
            </button>
            {!anySection && (
              <p className="mt-2 text-center text-xs text-white/40">
                Pick at least one section to include.
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FormatCard({
  active,
  onClick,
  icon,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3.5 text-left transition",
        active
          ? "border-transparent bg-gradient-to-br from-[#7c8cff]/30 to-[#ff6bd0]/20 ring-1 ring-[#7c8cff]/60"
          : "border-white/10 bg-white/5 hover:bg-white/10"
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          active ? "bg-white/15 text-white" : "bg-white/10 text-white/70"
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-white/45">{sub}</span>
      </span>
    </button>
  );
}
