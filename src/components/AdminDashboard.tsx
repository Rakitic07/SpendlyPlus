"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ShieldCheck,
  X,
  KeyRound,
  Database,
  ClipboardPaste,
  Loader2,
  Layers,
  Receipt,
  Coins,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Activity as ActivityIcon,
  Users,
  Tag,
  LifeBuoy,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  Paperclip,
  ScanLine,
  Cpu,
  MemoryStick,
  Server,
} from "lucide-react";
import { apiFetch } from "@/lib/http";
import { ShimmerText } from "./Shimmer";

/* ---------- types ---------- */

type Totals = {
  spaces: number;
  expenses: number;
  grandTotal: number;
  avgExpense: number;
  avgPerSpace: number;
};
type Storage = {
  dbBytes: number;
  expenseTableBytes: number;
  limitBytes: number | null;
  attachments: { count: number; totalBytes: number; avgBytes: number; maxBytes: number };
  tables: { name: string; bytes: number }[];
};
type Ocr = {
  configured: boolean;
  countTotal: number;
  countEngine1: number;
  countEngine2: number;
  countEngine3: number;
  monthlyLimit: number;
  engine3MonthlyLimit: number;
  dailyRateLimit: number;
};
type Meter = { usedBytes: number; totalBytes: number; usedPct: number };
type System = {
  cpu: { cores: number; load1: number; loadPct: number | null };
  memory: Meter & { basis: "process" | "host" };
  disk: Meter | null;
  uptimeSec: number;
  node: string;
  region: string | null;
};
type Space = {
  id: string;
  name: string;
  budget: number | null;
  createdAt: string;
  expenseCount: number;
  total: number;
  firstDate: string | null;
  lastDate: string | null;
  attachCount: number;
  attachMonths: number; // month span covered by the space's attachments
};
type Cat = { category: string; count: number; total: number };
type Payer = { payer: string; count: number; total: number };
type Paged<T> = { total: number; page: number; pageSize: number; items: T[] };
type Bucket = "day" | "week" | "month" | "year";
type ActivityData = {
  bucket: Bucket;
  series: { period: string; count: number; total: number }[];
  performance: { curCount: number; curTotal: number; prevCount: number; prevTotal: number };
  activeSpaces: { name: string; inputs: number; total: number }[];
};
type ResetItem = {
  id: string;
  status: string;
  spaceName: string;
  spaceCreated: string;
  requestedAt: string;
  resolvedAt: string | null;
  hasRecovery: boolean;
  expenseCount: number;
  total: number;
  budget: number | null;
  questionnaire: string;
  recent: { title: string; amount: number; payer: string; date: string }[];
  payers: string[];
  titles: string[];
  amounts: number[];
};
type Tab = "spaces" | "categories" | "payers" | "activity" | "resets";
type Creds = { databaseUrl: string; authSecret: string };

/* ---------- helpers ---------- */

const nf = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toLocaleString("en-IN", { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function pct(cur: number, prev: number): string {
  if (prev === 0) return cur > 0 ? "+100%" : "0%";
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
}

function parseEnvValue(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+?)\\s*$`, "im");
  const m = text.match(re);
  if (!m) return null;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v || null;
}

const PERIOD_LABEL: Record<Bucket, { cur: string; prev: string }> = {
  day: { cur: "Today", prev: "Yesterday" },
  week: { cur: "This week", prev: "Last week" },
  month: { cur: "This month", prev: "Last month" },
  year: { cur: "This year", prev: "Last year" },
};

/* ---------- component ---------- */

export default function AdminDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  // gate inputs
  const [mode, setMode] = useState<"fields" | "paste">("fields");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [authSecret, setAuthSecret] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // unlocked state — creds kept only in memory for this session (never on disk)
  const [creds, setCreds] = useState<Creds | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [ocr, setOcr] = useState<Ocr | null>(null);
  const [system, setSystem] = useState<System | null>(null);

  // Collapsible detail panels — all closed by default. Data is fetched on
  // expand and cleared on collapse so nothing heavy lingers in memory.
  type PanelKind = "storage" | "ocr" | "system";
  const [openPanel, setOpenPanel] = useState<Record<PanelKind, boolean>>({
    storage: false,
    ocr: false,
    system: false,
  });
  const [panelLoading, setPanelLoading] = useState<Record<PanelKind, boolean>>({
    storage: false,
    ocr: false,
    system: false,
  });

  // per-tab lazy data
  const [tab, setTab] = useState<Tab>("spaces");
  const [spaces, setSpaces] = useState<Paged<Space> | null>(null);
  const [categories, setCategories] = useState<Paged<Cat> | null>(null);
  const [payers, setPayers] = useState<Paged<Payer> | null>(null);
  const [bucket, setBucket] = useState<Bucket>("week");
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [resets, setResets] = useState<Paged<ResetItem> | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  // Wipe everything the moment the panel closes — nothing lingers.
  useEffect(() => {
    if (!open) {
      setMode("fields");
      setDatabaseUrl("");
      setAuthSecret("");
      setPasteText("");
      setShowSecrets(false);
      setError(null);
      setLoading(false);
      setCreds(null);
      setTotals(null);
      setStorage(null);
      setOcr(null);
      setSystem(null);
      setOpenPanel({ storage: false, ocr: false, system: false });
      setPanelLoading({ storage: false, ocr: false, system: false });
      setTab("spaces");
      setSpaces(null);
      setCategories(null);
      setPayers(null);
      setBucket("week");
      setActivity(null);
      setResets(null);
      setTabLoading(false);
      setTabError(null);
    }
  }, [open]);

  async function runSection(
    c: Creds,
    section: string,
    extra: Record<string, unknown> = {}
  ) {
    const res = await apiFetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ ...c, section, ...extra }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Request failed.");
    return data;
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault();

    let dbUrl = databaseUrl;
    let secret = authSecret;
    if (mode === "paste") {
      const pd = parseEnvValue(pasteText, "DATABASE_URL");
      const ps = parseEnvValue(pasteText, "AUTH_SECRET");
      if (!pd || !ps) {
        setError(
          `Couldn't find ${!pd ? "DATABASE_URL" : ""}${!pd && !ps ? " and " : ""}${
            !ps ? "AUTH_SECRET" : ""
          } in the pasted text.`
        );
        return;
      }
      dbUrl = pd;
      secret = ps;
    }

    setLoading(true);
    setError(null);
    try {
      const c: Creds = { databaseUrl: dbUrl, authSecret: secret };
      // Light unlock: fetch only the cheap totals. The storage / OCR / host
      // panels stay collapsed and each loads its own data when expanded, so the
      // page isn't heavy on first paint.
      const ov = await runSection(c, "overview", { light: true });
      setTotals(ov.totals as Totals);
      setCreds(c);
      setTab("spaces");
      // Load the first tab immediately; other tabs load on demand.
      const sp = await runSection(c, "spaces", { page: 0 });
      setSpaces(sp as Paged<Space>);
      // Clear the raw gate inputs — the working copy lives in `creds`.
      setDatabaseUrl("");
      setAuthSecret("");
      setPasteText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function load(c: Creds, t: Tab, opts: { page?: number; bucket?: Bucket } = {}) {
    setTabLoading(true);
    setTabError(null);
    try {
      if (t === "spaces") setSpaces((await runSection(c, "spaces", { page: opts.page ?? 0 })) as Paged<Space>);
      else if (t === "categories") setCategories((await runSection(c, "categories", { page: opts.page ?? 0 })) as Paged<Cat>);
      else if (t === "payers") setPayers((await runSection(c, "payers", { page: opts.page ?? 0 })) as Paged<Payer>);
      else if (t === "activity") setActivity((await runSection(c, "activity", { bucket: opts.bucket ?? bucket })) as ActivityData);
      else if (t === "resets") setResets((await runSection(c, "resets", { page: opts.page ?? 0 })) as Paged<ResetItem>);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setTabLoading(false);
    }
  }

  // Expand/collapse a detail panel. Expanding fetches just that panel's slice;
  // collapsing clears the data so it doesn't sit in memory (re-expanding
  // refetches). Keeps the page light on browsers and phones.
  async function togglePanel(kind: PanelKind) {
    if (openPanel[kind]) {
      setOpenPanel((p) => ({ ...p, [kind]: false }));
      if (kind === "storage") setStorage(null);
      else if (kind === "ocr") setOcr(null);
      else setSystem(null);
      return;
    }

    setOpenPanel((p) => ({ ...p, [kind]: true }));
    if (!creds) return;
    setPanelLoading((p) => ({ ...p, [kind]: true }));
    try {
      const data = await runSection(creds, kind);
      if (kind === "storage") setStorage((data.storage ?? null) as Storage | null);
      else if (kind === "ocr") setOcr((data.ocr ?? null) as Ocr | null);
      else setSystem((data.system ?? null) as System | null);
    } catch {
      // Leave the panel open but empty; a re-toggle retries.
    } finally {
      setPanelLoading((p) => ({ ...p, [kind]: false }));
    }
  }

  // Approve/reject a reset request, then refresh the current resets page.
  async function resetAction(id: string, action: "approve" | "reject") {
    if (!creds) return;
    setTabLoading(true);
    setTabError(null);
    try {
      const res = await apiFetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ ...creds, requestId: id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Action failed.");
      await load(creds, "resets", { page: resets?.page ?? 0 });
    } catch (err) {
      setTabError(err instanceof Error ? err.message : "Action failed.");
      setTabLoading(false);
    }
  }

  function openTab(t: Tab) {
    setTab(t);
    setTabError(null);
    if (!creds) return;
    // Fetch only the first time a tab is opened (keeps things fast).
    if (t === "spaces" && !spaces) void load(creds, "spaces", { page: 0 });
    else if (t === "categories" && !categories) void load(creds, "categories", { page: 0 });
    else if (t === "payers" && !payers) void load(creds, "payers", { page: 0 });
    else if (t === "activity" && !activity) void load(creds, "activity", { bucket });
    else if (t === "resets" && !resets) void load(creds, "resets", { page: 0 });
  }

  function changeBucket(b: Bucket) {
    setBucket(b);
    if (creds) void load(creds, "activity", { bucket: b });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-[max(env(safe-area-inset-top),1rem)]"
          onClick={onClose}
        >
          <div
            className="glass-strong my-auto w-full max-w-4xl rounded-3xl p-5 sm:p-7"
            onClick={(ev) => ev.stopPropagation()}
          >
            {/* header */}
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-[#7c8cff] to-[#ff6bd0]">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold leading-tight">Admin dashboard</h2>
                  <p className="text-xs text-white/50">{creds ? "Database overview" : "Owner access only"}</p>
                </div>
              </div>
              <button onClick={onClose} className="glass-btn px-2.5 py-2.5" aria-label="Close admin dashboard">
                <X className="h-4 w-4" />
              </button>
            </div>

            {!creds ? (
              /* ---------- credential gate ---------- */
              <form onSubmit={unlock} className="space-y-4">
                <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
                  Provide your <span className="text-white/80">DATABASE_URL</span> and{" "}
                  <span className="text-white/80">AUTH_SECRET</span> to unlock a read-only overview.
                  They&apos;re verified over HTTPS and kept only in memory for this session to load
                  details on demand — <span className="text-white/80">never saved to disk</span>.
                </p>

                <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("fields");
                      setError(null);
                    }}
                    className={`flex-1 rounded-xl px-3 py-1.5 transition ${
                      mode === "fields" ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    Enter fields
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("paste");
                      setError(null);
                    }}
                    className={`flex-1 rounded-xl px-3 py-1.5 transition ${
                      mode === "paste" ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    Paste .env
                  </button>
                </div>

                {mode === "fields" ? (
                  <>
                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60">
                        <Database className="h-3.5 w-3.5" /> DATABASE_URL
                      </span>
                      <input
                        type={showSecrets ? "text" : "password"}
                        value={databaseUrl}
                        onChange={(e) => setDatabaseUrl(e.target.value)}
                        placeholder="postgresql://…"
                        autoComplete="off"
                        spellCheck={false}
                        className="glass-input font-mono text-sm"
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60">
                        <KeyRound className="h-3.5 w-3.5" /> AUTH_SECRET
                      </span>
                      <input
                        type={showSecrets ? "text" : "password"}
                        value={authSecret}
                        onChange={(e) => setAuthSecret(e.target.value)}
                        placeholder="••••••••••••••••"
                        autoComplete="off"
                        spellCheck={false}
                        className="glass-input font-mono text-sm"
                        required
                      />
                    </label>
                  </>
                ) : (
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60">
                      <ClipboardPaste className="h-3.5 w-3.5" /> Paste your .env (both variables)
                    </span>
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={5}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={
                        'DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"\nAUTH_SECRET="your-long-random-secret"'
                      }
                      className="glass-input resize-y font-mono text-xs leading-relaxed"
                      style={{ WebkitTextSecurity: showSecrets ? "none" : "disc" } as React.CSSProperties}
                      required
                    />
                    <span className="mt-1 block text-[11px] text-white/40">
                      Extra lines are ignored — only DATABASE_URL and AUTH_SECRET are read.
                    </span>
                  </label>
                )}

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowSecrets((s) => !s)}
                    className="inline-flex items-center gap-1.5 text-xs text-white/50 transition hover:text-white/80"
                  >
                    {showSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showSecrets ? "Hide" : "Show"} values
                  </button>
                </div>

                {error && (
                  <p className="rounded-xl border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb3b3]">
                    {error}
                  </p>
                )}

                <button type="submit" disabled={loading} className="glass-btn-primary w-full justify-center py-3 disabled:opacity-60">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" /> Unlock dashboard
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* ---------- dashboard ---------- */
              <div className="space-y-5">
                {/* summary cards (loaded on unlock) */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard icon={<Layers className="h-4 w-4" />} label="Spaces" value={totals ? String(totals.spaces) : "—"} />
                  <StatCard icon={<Receipt className="h-4 w-4" />} label="Expenses" value={totals ? String(totals.expenses) : "—"} />
                  <StatCard icon={<Coins className="h-4 w-4" />} label="Grand total" value={totals ? nf(totals.grandTotal) : "—"} />
                  <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Avg / expense" value={totals ? nf(totals.avgExpense) : "—"} />
                </div>

                <p className="text-[11px] text-white/40">
                  Amounts are currency-agnostic — currency is a per-device display setting and isn&apos;t stored.
                </p>

                {/* Detail panels — collapsed by default, each loads on expand
                    and clears on collapse to keep the page light. */}
                <div className="space-y-2">
                  <CollapseCard
                    icon={<HardDrive className="h-3.5 w-3.5" />}
                    title="Database storage"
                    open={openPanel.storage}
                    loading={panelLoading.storage}
                    onToggle={() => togglePanel("storage")}
                  >
                    {storage ? <StoragePanel s={storage} /> : null}
                  </CollapseCard>

                  <CollapseCard
                    icon={<ScanLine className="h-3.5 w-3.5" />}
                    title="Bill scanning (OCR.space)"
                    open={openPanel.ocr}
                    loading={panelLoading.ocr}
                    onToggle={() => togglePanel("ocr")}
                  >
                    {ocr ? <OcrPanel o={ocr} /> : null}
                  </CollapseCard>

                  <CollapseCard
                    icon={<Server className="h-3.5 w-3.5" />}
                    title="Host runtime (CPU / memory / disk)"
                    open={openPanel.system}
                    loading={panelLoading.system}
                    onToggle={() => togglePanel("system")}
                  >
                    {system ? <HostPanel s={system} /> : null}
                  </CollapseCard>
                </div>

                {/* tab bar */}
                <div className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 text-sm">
                  <TabBtn active={tab === "spaces"} onClick={() => openTab("spaces")} icon={<Layers className="h-3.5 w-3.5" />} label="Spaces" />
                  <TabBtn active={tab === "categories"} onClick={() => openTab("categories")} icon={<Tag className="h-3.5 w-3.5" />} label="Categories" />
                  <TabBtn active={tab === "payers"} onClick={() => openTab("payers")} icon={<Users className="h-3.5 w-3.5" />} label="Payers" />
                  <TabBtn active={tab === "activity"} onClick={() => openTab("activity")} icon={<ActivityIcon className="h-3.5 w-3.5" />} label="Activity" />
                  <TabBtn active={tab === "resets"} onClick={() => openTab("resets")} icon={<LifeBuoy className="h-3.5 w-3.5" />} label="Resets" />
                </div>

                {/* tab content */}
                <div className="min-h-[200px]">
                  {tabLoading ? (
                    <div className="grid h-48 place-items-center">
                      <ShimmerText>Loading…</ShimmerText>
                    </div>
                  ) : tabError ? (
                    <p className="rounded-xl border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 px-3 py-2 text-sm text-[#ffb3b3]">{tabError}</p>
                  ) : tab === "spaces" ? (
                    <SpacesTab data={spaces} onPage={(p) => creds && load(creds, "spaces", { page: p })} />
                  ) : tab === "categories" ? (
                    <CategoriesTab data={categories} onPage={(p) => creds && load(creds, "categories", { page: p })} />
                  ) : tab === "payers" ? (
                    <PayersTab data={payers} onPage={(p) => creds && load(creds, "payers", { page: p })} />
                  ) : tab === "activity" ? (
                    <ActivityTab data={activity} bucket={bucket} onBucket={changeBucket} />
                  ) : (
                    <ResetsTab data={resets} onPage={(p) => creds && load(creds, "resets", { page: p })} onAction={resetAction} />
                  )}
                </div>

                <button onClick={onClose} className="glass-btn w-full justify-center py-2.5">
                  Close
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- sub views ---------- */

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
        {icon}
        {label}
      </div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// Collapsible wrapper for the heavy detail panels. Header toggles open/closed;
// the body only mounts while open, and a spinner shows while its section loads.
function CollapseCard({
  icon,
  title,
  open,
  loading,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  open: boolean;
  loading: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-white/5"
      >
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/50">
          {icon}
          {title}
        </span>
        <span className="flex items-center gap-2">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/50" />}
          <ChevronDown
            className={`h-4 w-4 text-white/50 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 p-3">
          {children ? (
            children
          ) : (
            <div className="grid h-16 place-items-center">
              <ShimmerText>Loading…</ShimmerText>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A friendlier label for the app's Prisma tables in the breakdown.
const TABLE_LABEL: Record<string, string> = {
  Expense: "Expenses",
  Ledger: "Spaces (ledgers)",
  ResetRequest: "Reset requests",
  _prisma_migrations: "Prisma migrations",
};

function StorageBreakdown({ s }: { s: Storage }) {
  const rows = useMemo(() => {
    const appTotal = s.tables.reduce((a, t) => a + t.bytes, 0);
    const other = Math.max(0, s.dbBytes - appTotal);
    const list = s.tables
      .filter((t) => t.bytes > 0)
      .map((t) => ({ name: TABLE_LABEL[t.name] ?? t.name, bytes: t.bytes }));
    // Postgres system catalogs / WAL / free space not attributable to a table.
    if (other > 0) list.push({ name: "System & catalogs", bytes: other });
    list.sort((a, b) => b.bytes - a.bytes);
    return list;
  }, [s]);

  const max = Math.max(1, ...rows.map((r) => r.bytes));
  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="mb-3 text-[11px] uppercase tracking-wide text-white/45">
        Where the {fmtBytes(s.dbBytes)} goes
      </p>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const shareOfDb = s.dbBytes > 0 ? (r.bytes / s.dbBytes) * 100 : 0;
          const isOther = r.name === "System & catalogs";
          return (
            <div key={r.name}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-white/70">{r.name}</span>
                <span className="tabular-nums text-white/50">
                  {fmtBytes(r.bytes)} · {shareOfDb.toFixed(shareOfDb < 1 ? 1 : 0)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full ${
                    isOther
                      ? "bg-gradient-to-r from-white/25 to-white/40"
                      : "bg-gradient-to-r from-[#7c8cff] to-[#ff6bd0]"
                  }`}
                  style={{ width: `${(r.bytes / max) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-white/35">
        A fresh Postgres database uses several MB for system catalogs and write-ahead logs even with
        little data — so most of a small DB is baseline overhead, not your rows.
      </p>
    </div>
  );
}

/* ---------- host runtime (CPU / memory / disk) ---------- */

function meterFill(pct: number): string {
  if (pct >= 90) return "bg-gradient-to-r from-[#ff6b6b] to-[#ff8787]";
  if (pct >= 75) return "bg-gradient-to-r from-[#ffd43b] to-[#ffa94d]";
  return "bg-gradient-to-r from-[#7c8cff] to-[#ff6bd0]";
}

function meterText(pct: number): string {
  if (pct >= 90) return "text-[#ffb3b3]";
  if (pct >= 75) return "text-[#ffe08a]";
  return "text-white/45";
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function MeterBar({ pct }: { pct: number }) {
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
      <div
        className={`h-full rounded-full ${meterFill(pct)}`}
        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
      />
    </div>
  );
}

function MeterCard({
  icon,
  label,
  used,
  total,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  used: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
        {icon}
        {label}
      </div>
      <p className="text-xl font-semibold tabular-nums">
        {fmtBytes(used)}
        <span className="text-sm font-normal text-white/45"> / {fmtBytes(total)}</span>
      </p>
      <MeterBar pct={pct} />
      <p className={`mt-1.5 text-[11px] ${meterText(pct)}`}>
        {pct >= 90 ? "Almost full — " : pct >= 75 ? "Filling up — " : ""}
        {fmtBytes(Math.max(0, total - used))} free · {pct.toFixed(0)}% used
      </p>
    </div>
  );
}

function HostPanel({ s }: { s: System }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
        <Server className="h-3.5 w-3.5" />
        Host runtime{s.region ? ` · ${s.region}` : ""}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MeterCard
          icon={<MemoryStick className="h-3.5 w-3.5" />}
          label={s.memory.basis === "process" ? "Function memory" : "Host memory"}
          used={s.memory.usedBytes}
          total={s.memory.totalBytes}
          pct={s.memory.usedPct}
        />

        {s.disk ? (
          <MeterCard
            icon={<HardDrive className="h-3.5 w-3.5" />}
            label="Disk"
            used={s.disk.usedBytes}
            total={s.disk.totalBytes}
            pct={s.disk.usedPct}
          />
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
              <HardDrive className="h-3.5 w-3.5" />
              Disk
            </div>
            <p className="text-xl font-semibold tabular-nums text-white/60">n/a</p>
            <p className="mt-1.5 text-[11px] text-white/35">Not reported on this runtime.</p>
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
            <Cpu className="h-3.5 w-3.5" />
            CPU load
          </div>
          <p className="text-xl font-semibold tabular-nums">
            {s.cpu.loadPct !== null ? `${s.cpu.loadPct.toFixed(0)}%` : "n/a"}
            <span className="text-sm font-normal text-white/45">
              {" "}
              · {s.cpu.cores} {s.cpu.cores === 1 ? "core" : "cores"}
            </span>
          </p>
          {s.cpu.loadPct !== null ? (
            <>
              <MeterBar pct={s.cpu.loadPct} />
              <p className={`mt-1.5 text-[11px] ${meterText(s.cpu.loadPct)}`}>
                {s.cpu.loadPct >= 90 ? "Overloaded — " : s.cpu.loadPct >= 75 ? "Busy — " : ""}
                load {s.cpu.load1.toFixed(2)} across {s.cpu.cores}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-[11px] text-white/40">
              Load average isn&apos;t exposed on serverless runtimes.
            </p>
          )}
        </div>
      </div>
      <p className="text-[11px] text-white/35">
        Read live at request time · uptime {fmtUptime(s.uptimeSec)} · Node {s.node}
        {s.memory.basis === "process"
          ? " · serverless instance — values reset when it recycles"
          : ""}
      </p>
    </div>
  );
}

function StoragePanel({ s }: { s: Storage }) {
  const used = s.dbBytes;
  const limit = s.limitBytes;
  const usedPct = limit ? Math.min(100, (used / limit) * 100) : null;
  const attachPct = s.dbBytes > 0 ? Math.min(100, (s.attachments.totalBytes / s.dbBytes) * 100) : 0;

  return (
    <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      {/* database size */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
          <HardDrive className="h-3.5 w-3.5" />
          Database storage
        </div>
        <p className="text-xl font-semibold tabular-nums">
          {fmtBytes(used)}
          {limit && <span className="text-sm font-normal text-white/45"> / {fmtBytes(limit)}</span>}
        </p>
        {usedPct !== null ? (
          <>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full rounded-full ${
                  usedPct > 90
                    ? "bg-gradient-to-r from-[#ff6b6b] to-[#ff8787]"
                    : "bg-gradient-to-r from-[#7c8cff] to-[#ff6bd0]"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-white/45">
              {fmtBytes(Math.max(0, limit! - used))} left · {usedPct.toFixed(0)}% used
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[11px] text-white/40">
            No plan cap set — Postgres has no innate limit. Set{" "}
            <span className="text-white/60">ADMIN_STORAGE_LIMIT_MB</span> to track remaining space.
          </p>
        )}
        <p className="mt-1 text-[11px] text-white/35">
          Expense table: {fmtBytes(s.expenseTableBytes)}
        </p>
      </div>

      {/* attachments (bill thumbnails) */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
          <Paperclip className="h-3.5 w-3.5" />
          Bill attachments
        </div>
        <p className="text-xl font-semibold tabular-nums">
          {fmtBytes(s.attachments.totalBytes)}
          <span className="text-sm font-normal text-white/45"> · {s.attachments.count} thumbs</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5" title="Share of DB used by thumbnails">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#38d9a9] to-[#7c8cff]"
            style={{ width: `${attachPct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-white/45">
          {attachPct.toFixed(1)}% of the database
        </p>
        <p className="mt-1 text-[11px] text-white/35">
          Avg {fmtBytes(s.attachments.avgBytes)} · Largest {fmtBytes(s.attachments.maxBytes)}
        </p>
      </div>
    </div>

      {/* detailed breakdown of where the DB size sits */}
      <StorageBreakdown s={s} />
    </div>
  );
}

function OcrPanel({ o }: { o: Ocr }) {
  const nfmt = (n: number) => n.toLocaleString("en-IN");
  // Web scanning uses OCR Engine 2, so the monthly headroom that matters is the
  // shared Engine 1+2 pool (25k on the free plan).
  const usedMonthly = o.countEngine1 + o.countEngine2;
  const leftMonthly = Math.max(0, o.monthlyLimit - usedMonthly);
  const usedPct = o.monthlyLimit > 0 ? Math.min(100, (usedMonthly / o.monthlyLimit) * 100) : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
        <ScanLine className="h-3.5 w-3.5 text-[#7c8cff]" />
        Bill scanning (OCR.space)
      </div>

      {!o.configured ? (
        <p className="text-[13px] text-white/55">
          No <span className="text-white/70">OCRSPACE_API_KEY</span> set — web scanning falls back to
          slower on-device OCR. Add the key in your env to enable accurate scanning and quota tracking.
        </p>
      ) : (
        <>
          <p className="text-xl font-semibold tabular-nums">
            {nfmt(leftMonthly)}
            <span className="text-sm font-normal text-white/45"> scans left this month</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5" title="Monthly quota used">
            <div
              className={`h-full rounded-full ${
                usedPct > 90
                  ? "bg-gradient-to-r from-[#ff6b6b] to-[#ff8787]"
                  : "bg-gradient-to-r from-[#7c8cff] to-[#ff6bd0]"
              }`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-white/45">
            {nfmt(usedMonthly)} / {nfmt(o.monthlyLimit)} used · {usedPct.toFixed(1)}%
          </p>
          <p className="mt-2 text-[11px] text-white/35">
            Rate limit: {nfmt(o.dailyRateLimit)} scans/day per IP. There is no hourly cap.
            {o.countEngine3 > 0 && (
              <> · Engine 3: {nfmt(o.countEngine3)} / {nfmt(o.engine3MonthlyLimit)}</>
            )}
          </p>
          <p className="mt-1 text-[11px] text-white/30">
            Figures are the OCR.space key&apos;s own conversion counters (this billing period).
          </p>
        </>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 transition ${
        active ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page === 0} className="glass-btn px-3 py-2 disabled:opacity-40" aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[6rem] text-center text-sm text-white/60">
        Page {page + 1} of {totalPages}
      </span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages - 1} className="glass-btn px-3 py-2 disabled:opacity-40" aria-label="Next page">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// Average bill uploads per month for a space (0 when it has none).
function attachPerMonth(s: Space): number {
  if (!s.attachCount) return 0;
  const months = s.attachMonths > 0 ? s.attachMonths : 1;
  return s.attachCount / months;
}

function SpacesTab({ data, onPage }: { data: Paged<Space> | null; onPage: (p: number) => void }) {
  if (!data) return null;
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/45">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Expenses</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Bills</th>
              <th className="px-3 py-2 text-right">Bills/mo</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Activity</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => {
              const perMo = attachPerMonth(s);
              return (
                <tr key={s.id} className="border-t border-white/5">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.expenseCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{nf(s.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.attachCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-white/85">
                        <Paperclip className="h-3 w-3 text-[#7c8cff]" />
                        {s.attachCount}
                      </span>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-white/60">
                    {perMo > 0 ? perMo.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"}
                  </td>
                  <td className="px-3 py-2 text-white/60">{fmtDate(s.createdAt)}</td>
                  <td className="px-3 py-2 text-white/60">{s.firstDate ? `${fmtDate(s.firstDate)} → ${fmtDate(s.lastDate)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-white/40">
        Bills = expenses with a scanned thumbnail. Bills/mo is the average uploads per month across
        the months a space has attachments.
      </p>
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </div>
  );
}

function CategoriesTab({ data, onPage }: { data: Paged<Cat> | null; onPage: (p: number) => void }) {
  const max = useMemo(() => Math.max(1, ...(data?.items.map((c) => c.total) ?? [1])), [data]);
  if (!data) return null;
  return (
    <div>
      <div className="space-y-2.5">
        {data.items.map((c) => (
          <div key={c.category}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-white/70">{c.category}</span>
              <span className="tabular-nums text-white/50">
                {nf(c.total)} · {c.count}×
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-gradient-to-r from-[#7c8cff] to-[#ff6bd0]" style={{ width: `${(c.total / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </div>
  );
}

function PayersTab({ data, onPage }: { data: Paged<Payer> | null; onPage: (p: number) => void }) {
  if (!data) return null;
  return (
    <div>
      <div className="space-y-1.5">
        {data.items.map((p, i) => (
          <div key={p.payer + i} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <span className="truncate text-white/80">{p.payer}</span>
            <span className="ml-3 shrink-0 tabular-nums text-white/55">
              {nf(p.total)} · {p.count}×
            </span>
          </div>
        ))}
      </div>
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </div>
  );
}

function ActivityTab({
  data,
  bucket,
  onBucket,
}: {
  data: ActivityData | null;
  bucket: Bucket;
  onBucket: (b: Bucket) => void;
}) {
  const max = useMemo(() => Math.max(1, ...(data?.series.map((s) => s.count) ?? [1])), [data]);
  const activeMax = useMemo(() => Math.max(1, ...(data?.activeSpaces.map((s) => s.inputs) ?? [1])), [data]);

  const buckets: Bucket[] = ["day", "week", "month", "year"];

  return (
    <div className="space-y-5">
      {/* period selector — computing happens only when a period is picked */}
      <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1 text-sm">
        {buckets.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => onBucket(b)}
            className={`flex-1 rounded-xl px-3 py-1.5 capitalize transition ${
              bucket === b ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {b === "day" ? "Daily" : b === "week" ? "Weekly" : b === "month" ? "Monthly" : "Yearly"}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="py-8 text-center text-sm text-white/45">Pick a period above to compute usage.</p>
      ) : (
        <>
          {/* performance: this period vs last */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PerfCard label={PERIOD_LABEL[bucket].cur} count={data.performance.curCount} total={data.performance.curTotal} />
            <PerfCard label={PERIOD_LABEL[bucket].prev} count={data.performance.prevCount} total={data.performance.prevTotal} muted />
            <DeltaCard cur={data.performance.curCount} prev={data.performance.prevCount} />
          </div>

          {/* inputs over time */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-white/80">Inputs over time (how often it&apos;s used)</h3>
            {data.series.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center text-sm text-white/45">No activity in this window.</p>
            ) : (
              <div className="flex items-end gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/5 p-4">
                {data.series.map((s, i) => (
                  <div key={s.period + i} className="flex min-w-[40px] flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] tabular-nums text-white/60">{s.count}</span>
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-[#38d9a9] to-[#7c8cff]"
                      style={{ height: `${Math.max(6, (s.count / max) * 120)}px` }}
                      title={`${s.period}: ${s.count} input(s) · ${nf(s.total)}`}
                    />
                    <span className="whitespace-nowrap text-[10px] text-white/45">{s.period}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* most active spaces */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-white/80">Most active spaces</h3>
            {data.activeSpaces.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-4 text-center text-sm text-white/45">No activity in this window.</p>
            ) : (
              <div className="space-y-2">
                {data.activeSpaces.map((s) => (
                  <div key={s.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-white/70">{s.name}</span>
                      <span className="tabular-nums text-white/50">
                        {s.inputs} input{s.inputs === 1 ? "" : "s"} · {nf(s.total)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#ffd43b] to-[#ff6bd0]" style={{ width: `${(s.inputs / activeMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PerfCard({ label, count, total, muted }: { label: string; count: number; total: number; muted?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 p-3 ${muted ? "bg-white/[0.03]" : "bg-white/5"}`}>
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p className="text-xl font-semibold tabular-nums">
        {count} <span className="text-xs font-normal text-white/50">inputs</span>
      </p>
      <p className="text-xs tabular-nums text-white/50">{nf(total)}</p>
    </div>
  );
}

function DeltaCard({ cur, prev }: { cur: number; prev: number }) {
  const up = cur >= prev;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] uppercase tracking-wide text-white/45">Change</p>
      <p className={`flex items-center gap-1.5 text-xl font-semibold tabular-nums ${up ? "text-[#38d9a9]" : "text-[#ff8787]"}`}>
        {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        {pct(cur, prev)}
      </p>
      <p className="text-xs text-white/50">vs previous period</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    pending: { cls: "border-[#ffd43b]/30 bg-[#ffd43b]/10 text-[#ffe08a]", icon: <Clock className="h-3 w-3" />, label: "Pending" },
    approved: { cls: "border-[#38d9a9]/30 bg-[#38d9a9]/10 text-[#7be7c4]", icon: <CheckCircle2 className="h-3 w-3" />, label: "Approved" },
    rejected: { cls: "border-[#ff6b6b]/30 bg-[#ff6b6b]/10 text-[#ffb3b3]", icon: <XCircle className="h-3 w-3" />, label: "Rejected" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

const QLABELS: Record<string, string> = {
  approxCreated: "Created around",
  recentExpense: "A recent expense",
  recentAmount: "A recent amount",
  payerName: "A payer name",
  budget: "Monthly budget",
  note: "Extra note",
};

/** Extract the first number from a free-text answer, ignoring currency symbols/commas. */
function numFrom(s: string): number | null {
  const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

type MatchVerdict = "complete" | "probable" | "none" | "na";
type MatchResult = { matched: number; total: number; verdict: MatchVerdict; perField: Record<string, boolean> };

/**
 * Auto-scores the owner's questionnaire answers against the space's real data.
 * Only scorable, answered fields count toward the total. "note" is never scored.
 */
function scoreMatch(answers: Record<string, string>, r: ResetItem): MatchResult {
  const perField: Record<string, boolean> = {};
  const created = r.spaceCreated ? new Date(r.spaceCreated) : null;
  const createdTokens = created
    ? [
        String(created.getFullYear()),
        created.toLocaleDateString("en-US", { month: "long" }).toLowerCase(),
        created.toLocaleDateString("en-US", { month: "short" }).toLowerCase(),
      ]
    : [];

  const check = (key: string, ok: boolean) => {
    perField[key] = ok;
  };

  for (const [key, raw] of Object.entries(answers)) {
    const v = String(raw ?? "").trim().toLowerCase();
    if (!v || key === "note") continue;
    switch (key) {
      case "approxCreated":
        check(key, createdTokens.some((t) => t && v.includes(t)));
        break;
      case "recentExpense":
        check(key, r.titles.some((t) => t && (t.includes(v) || v.includes(t))));
        break;
      case "recentAmount": {
        const n = numFrom(v);
        check(key, n !== null && r.amounts.some((a) => Math.abs(a - n) < 0.01));
        break;
      }
      case "payerName":
        check(key, r.payers.some((p) => p && (p === v || p.includes(v) || v.includes(p))));
        break;
      case "budget": {
        const n = numFrom(v);
        check(key, n !== null && r.budget !== null && Math.abs(r.budget - n) < 0.5);
        break;
      }
      default:
        break;
    }
  }

  const total = Object.keys(perField).length;
  const matched = Object.values(perField).filter(Boolean).length;
  let verdict: MatchVerdict;
  if (total === 0) verdict = "na";
  else if (matched === total) verdict = "complete";
  else if (matched > 0) verdict = "probable";
  else verdict = "none";
  return { matched, total, verdict, perField };
}

function MatchBadge({ m }: { m: MatchResult }) {
  const map: Record<MatchVerdict, { cls: string; label: string }> = {
    complete: { cls: "border-[#38d9a9]/30 bg-[#38d9a9]/10 text-[#7be7c4]", label: "Complete match" },
    probable: { cls: "border-[#ffd43b]/30 bg-[#ffd43b]/10 text-[#ffe08a]", label: "Probable match" },
    none: { cls: "border-[#ff6b6b]/30 bg-[#ff6b6b]/10 text-[#ffb3b3]", label: "No match" },
    na: { cls: "border-white/15 bg-white/5 text-white/50", label: "Unverifiable" },
  };
  const s = map[m.verdict];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
      {m.total > 0 && <span className="opacity-70">· {m.matched}/{m.total}</span>}
    </span>
  );
}

function ResetsTab({
  data,
  onPage,
  onAction,
}: {
  data: Paged<ResetItem> | null;
  onPage: (p: number) => void;
  onAction: (id: string, action: "approve" | "reject") => void;
}) {
  if (!data) return null;
  if (data.items.length === 0) {
    return <p className="py-8 text-center text-sm text-white/45">No reset requests.</p>;
  }
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-white/40">
        Cross-check the owner&apos;s answers against the space&apos;s real data below before approving. Approving
        activates the new passphrase the owner already chose.
      </p>
      {data.items.map((r) => (
        <ResetCard key={r.id} r={r} onAction={onAction} />
      ))}
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </div>
  );
}

function ResetCard({
  r,
  onAction,
}: {
  r: ResetItem;
  onAction: (id: string, action: "approve" | "reject") => void;
}) {
  const isPending = r.status === "pending";
  // Pending requests need attention, so expand them; resolved ones stay collapsed.
  const [open, setOpen] = useState(isPending);

  let answers: Record<string, string> = {};
  try {
    answers = JSON.parse(r.questionnaire);
  } catch {
    /* ignore malformed */
  }
  const answered = Object.entries(answers).filter(([, v]) => v && String(v).trim());
  const match = scoreMatch(answers, r);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{r.spaceName}</span>
          <StatusBadge status={r.status} />
          <MatchBadge m={match} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/45">{fmtDate(r.requestedAt)}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-white/45 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {/* owner's claims */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-white/45">Owner&apos;s answers</p>
              {answered.length ? (
                <ul className="space-y-1 text-sm">
                  {answered.map(([k, v]) => {
                    const scored = k in match.perField;
                    const ok = match.perField[k];
                    return (
                      <li key={k} className="flex justify-between gap-3">
                        <span className="flex items-center gap-1 text-white/50">
                          {scored &&
                            (ok ? (
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-[#7be7c4]" />
                            ) : (
                              <XCircle className="h-3 w-3 shrink-0 text-[#ffb3b3]" />
                            ))}
                          {QLABELS[k] ?? k}
                        </span>
                        <span className="text-right text-white/85">{v}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-white/40">No answers provided.</p>
              )}
            </div>

            {/* real data */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-white/45">Real data (verify)</p>
              <ul className="space-y-1 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-white/50">Created</span>
                  <span className="text-white/85">{fmtDate(r.spaceCreated)}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-white/50">Expenses</span>
                  <span className="text-white/85">
                    {r.expenseCount} · {nf(r.total)}
                  </span>
                </li>
                {r.budget !== null && (
                  <li className="flex justify-between gap-3">
                    <span className="text-white/50">Monthly budget</span>
                    <span className="text-white/85">{nf(r.budget)}</span>
                  </li>
                )}
              </ul>
              {r.recent.length > 0 && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-white/40">Recent entries</p>
                  <ul className="space-y-0.5 text-xs text-white/70">
                    {r.recent.map((e, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">
                          {e.title} <span className="text-white/40">· {e.payer}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">{nf(e.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {r.hasRecovery && isPending && (
            <p className="mt-2 text-[11px] text-white/40">
              Note: this space has a recovery code set — the owner could reset it themselves with it.
            </p>
          )}

          {isPending ? (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => onAction(r.id, "approve")}
                className="glass-btn-primary flex-1 justify-center py-2"
              >
                <CheckCircle2 className="h-4 w-4" /> Approve
              </button>
              <button
                onClick={() => onAction(r.id, "reject")}
                className="glass-btn flex-1 justify-center py-2 text-[#ffb3b3]"
              >
                <XCircle className="h-4 w-4" /> Reject
              </button>
            </div>
          ) : (
            r.resolvedAt && <p className="mt-3 text-xs text-white/45">Resolved {fmtDate(r.resolvedAt)}</p>
          )}
        </>
      )}

      {!open && r.resolvedAt && (
        <p className="mt-2 text-xs text-white/45">Resolved {fmtDate(r.resolvedAt)}</p>
      )}
    </div>
  );
}
