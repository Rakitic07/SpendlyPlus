"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, LogOut, Sparkles, Wallet, ShieldCheck, PartyPopper, Github, Shield, Download, LayoutGrid, PieChart, ReceiptText, Settings } from "lucide-react";
import { api } from "@/lib/api";
import type { Expense, ExpenseDraft } from "@/lib/types";
import { CurrencyProvider, formatFor } from "@/lib/currency";
import { SettingsProvider } from "@/lib/settings";
import { isNativeApp } from "@/lib/platform";
import { startPerfLogging } from "@/lib/perf";
import {
  readCache,
  writeCache,
  pendingCount,
  draftToExpense,
  enqueueCreate,
  enqueueUpdate,
  enqueueDelete,
  sync as syncStore,
  rememberSpace,
  getLastSpace,
  forgetSpace,
  mergeCachedThumbnails,
  readBudget,
  setBudgetLocal,
  adoptServerBudget,
  isBudgetDirty,
} from "@/lib/offline";
import Background from "./Background";
import AuthCard from "./AuthCard";
import Dashboard from "./Dashboard";
import ExpenseForm from "./ExpenseForm";
import CurrencySelect from "./CurrencySelect";
import SyncButton from "./SyncButton";
// The admin dashboard is heavy (its own tables/queries) and only ever opened
// from the landing-page footer, so it's code-split out of the initial bundle
// and only mounted after the first open — keeping first paint fast.
const AdminDashboard = dynamic(() => import("./AdminDashboard"), { ssr: false });
import UpdatePrompt from "./UpdatePrompt";
import UpdateDebugBadge from "./UpdateDebugBadge";
import CheckUpdatesButton from "./CheckUpdatesButton";
import DownloadLogsButton from "./DownloadLogsButton";
import SettingsSheet from "./SettingsSheet";
import { ShimmerText } from "./Shimmer";

type Status = "loading" | "guest" | "authed";

export default function Spendly() {
  const [status, setStatus] = useState<Status>("loading");
  const [name, setName] = useState<string>("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budget, setBudget] = useState<number | null>(null);
  // Per-space UI settings the startup /api/bootstrap call already fetched, handed
  // to SettingsProvider so it can skip a separate /api/settings round trip. Tied
  // to the space name so a different space never gets seeded with stale settings.
  const [bootSettings, setBootSettings] = useState<{
    space: string;
    settings: Record<string, unknown>;
  } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  // Latch: once the admin panel is opened we keep it mounted so its open/close
  // animation stays smooth, but its chunk never loads unless it's actually used.
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which dashboard section the mobile bottom-nav is showing (desktop ignores it).
  const [mobileTab, setMobileTab] = useState<"overview" | "charts" | "activity">("overview");

  // Push queued writes to the DB, then pull the canonical list (when the queue
  // is fully drained). Takes the space explicitly so it can run before the
  // `name` state has settled (e.g. right after auth).
  const runSync = useCallback(async (space: string) => {
    if (!space) return;
    setSyncing(true);
    let ok = true;
    try {
      const { expenses: fresh, budget: freshBudget, mapped, ok: drained, dropped } =
        await syncStore(space);
      ok = drained;
      if (Object.keys(mapped).length) {
        setExpenses((prev) =>
          prev.map((e) => (mapped[e.id] ? { ...e, id: mapped[e.id] } : e))
        );
      }
      if (fresh) setExpenses(fresh);
      // Some queued changes were permanently rejected by the server (e.g. they
      // failed validation). They've been discarded so the queue can drain —
      // tell the user instead of silently jamming sync forever.
      if (dropped.length) {
        // Drop the doomed optimistic rows from the on-screen list too.
        const goneIds = new Set(
          dropped
            .map((d) => (d.op.kind === "create" ? d.op.tempId : d.op.kind === "update" ? d.op.id : d.op.id))
        );
        setExpenses((prev) => prev.filter((e) => !goneIds.has(e.id)));
        const first = dropped[0];
        const msg =
          dropped.length > 1
            ? `${dropped.length} changes couldn't be saved and were discarded`
            : `A change couldn't be saved: ${first.reason}`;
        setToast(msg);
        window.setTimeout(() => setToast(null), 3200);
      }
      // `undefined` means the server value wasn't touched this run — leave state.
      if (freshBudget !== undefined) setBudget(freshBudget);
      // The server responded, so we're definitely online. This self-heals a
      // stuck "Offline" badge left over from a transient startup failure (the
      // browser's `online` event won't fire if navigator never actually dropped).
      setOnline(true);
    } catch {
      /* offline or server error — keep the local cache and queued writes */
      ok = false;
      // Only show the Offline banner for a genuine network drop. A reachable-but-
      // erroring server is surfaced by the red sync state instead.
      if (typeof navigator !== "undefined" && !navigator.onLine) setOnline(false);
    } finally {
      setSyncing(false);
      setSyncError(!ok); // green on success, red on failure
      setPending(pendingCount(space));
    }
  }, []);

  // Unique, most-recent expense titles for quick re-entry in the form.
  const recentTitles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of expenses) {
      const t = e.title.trim();
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.push(t);
      }
      if (out.length >= 8) break;
    }
    return out;
  }, [expenses]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  // Show cached data instantly, then reconcile with the server in the
  // background — this is the "opens fast even on a slow/absent network" path.
  const enterSpace = useCallback(
    (space: string) => {
      setName(space);
      setStatus("authed");
      rememberSpace(space);
      const cached = readCache(space);
      if (cached.length) setExpenses(cached);
      setBudget(readBudget(space)); // instant; runSync then pulls/pushes the DB value
      setPending(pendingCount(space));
      void runSync(space);
    },
    [runSync]
  );

  useEffect(() => {
    // 1) INSTANT PAINT from the local cache. We never block the first frame on
    //    the network: if the last space has cached data, render it immediately
    //    so the app opens like a flash. The background reconcile below then
    //    quietly corrects anything that changed on the server.
    const last = getLastSpace();
    const hasLocal =
      !!last &&
      (readCache(last).length > 0 || pendingCount(last) > 0 || isBudgetDirty(last));
    if (last && hasLocal) {
      setName(last);
      setStatus("authed");
      setExpenses(readCache(last));
      setBudget(readBudget(last));
      setPending(pendingCount(last));
    }

    // 2) RECONCILE with the server in the background (auth check + fresh data).
    (async () => {
      try {
        // Single startup call: auth state + expenses in one round trip.
        const boot = await api.bootstrap();
        if (boot.authenticated && boot.name) {
          const space = boot.name;
          setName(space);
          setStatus("authed");
          rememberSpace(space);
          // Seed settings from the same startup payload (skips /api/settings).
          if (boot.settings) setBootSettings({ space, settings: boot.settings });
          if (!hasLocal) {
            const cached = readCache(space);
            if (cached.length) setExpenses(cached);
          }
          const pend = pendingCount(space);
          setPending(pend);

          // Reconcile the budget. A local edit not yet pushed wins (and gets
          // flushed below); otherwise the server value is authoritative. If the
          // server has no budget but this device has an old local-only one,
          // migrate it up so it starts syncing.
          let mustSyncBudget = false;
          if (isBudgetDirty(space)) {
            setBudget(readBudget(space));
            mustSyncBudget = true;
          } else {
            const serverBudget = boot.budget ?? null;
            const local = readBudget(space);
            if (serverBudget == null && local != null) {
              setBudget(local);
              setBudgetLocal(space, local); // marks dirty → pushed by runSync
              mustSyncBudget = true;
            } else {
              adoptServerBudget(space, serverBudget);
              setBudget(serverBudget);
            }
          }

          if (pend > 0 || mustSyncBudget) {
            // Unsynced local writes exist — flush them, then refresh.
            void runSync(space);
          } else if (boot.expenses) {
            // The bootstrap payload omits the heavy base64 thumbnails; re-attach
            // any this device already cached so previews don't flicker away.
            const merged = mergeCachedThumbnails(space, boot.expenses);
            setExpenses(merged);
            writeCache(space, merged);
          }
        } else if (!hasLocal) {
          // Genuinely logged out with nothing cached → show the landing screen.
          setStatus("guest");
        } else {
          // We optimistically showed a cached space, but the server says the
          // session has ended. Drop to the auth screen.
          forgetSpace();
          setExpenses([]);
          setBudget(null);
          setName("");
          setPending(0);
          setStatus("guest");
        }
      } catch {
        // Offline / server unreachable. Keep the optimistic cache if we already
        // painted one; otherwise try the last space's cache before giving up.
        // Only flag "Offline" for a real network drop; a transient/cold server
        // shouldn't leave a permanently stuck banner while the device is online.
        const netDown = typeof navigator !== "undefined" && !navigator.onLine;
        if (hasLocal) {
          if (netDown) setOnline(false);
        } else {
          const l = getLastSpace();
          if (l && readCache(l).length) {
            if (netDown) setOnline(false);
            setName(l);
            setStatus("authed");
            setExpenses(readCache(l));
            setBudget(readBudget(l));
            setPending(pendingCount(l));
          } else {
            setStatus("guest");
          }
        }
      }
    })();
  }, [runSync]);

  // Mirror the working set into the cache so a reload/offline open is instant.
  useEffect(() => {
    if (status === "authed" && name) writeCache(name, expenses);
  }, [expenses, status, name]);

  // Detect iOS once so we can slightly shrink the header controls there (they
  // otherwise crowd out the space name on a narrow iPhone). iPadOS 13+ reports
  // as "MacIntel" with touch points, so include that case.
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const iOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(iOS);
    setIsNative(isNativeApp());
    // Diagnostic performance probe → Android logcat ([PERF] tag). Native app
    // only (or web with ?perf=1). See src/lib/perf.ts for how to capture.
    startPerfLogging();
  }, []);

  // Auto-sync when connectivity returns; track online/offline for the badge.
  useEffect(() => {
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    function onOnline() {
      setOnline(true);
      if (name) void runSync(name);
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [name, runSync]);

  function handleAuthed(n: string) {
    enterSpace(n);
  }

  async function handleLogout() {
    // Best-effort flush so unsynced changes aren't stranded (only if online).
    if (name && typeof navigator !== "undefined" && navigator.onLine && pendingCount(name) > 0) {
      try {
        await runSync(name);
      } catch {
        /* ignore — queued writes stay for next unlock */
      }
    }
    await api.logout();
    // Android's WebView can resurrect a "cleared" session cookie on the next
    // launch (it doesn't always flush the removal to disk). Force-clear the
    // WebView cookie store so logout actually sticks across app restarts.
    try {
      const cap = (window as unknown as {
        Capacitor?: { Plugins?: { AppUpdater?: { clearCookies?: () => Promise<void> } } };
      }).Capacitor;
      await cap?.Plugins?.AppUpdater?.clearCookies?.();
    } catch {
      /* web / plugin missing — the cookie clear from /api/auth/logout is enough */
    }
    forgetSpace();
    setExpenses([]);
    setBudget(null);
    setName("");
    setStatus("guest");
    setPending(0);
  }

  // The monthly budget is a per-space DB setting: update locally for an instant
  // response, then push to the server so every device sees the same goal.
  const handleSetBudget = useCallback(
    (value: number | null) => {
      setBudget(value);
      setBudgetLocal(name, value);
      void runSync(name);
    },
    [name, runSync]
  );

  // Writes are applied locally first (instant + offline-friendly) and queued;
  // runSync then flushes to the DB — a no-op that stays queued if offline.
  function handleSave(draft: ExpenseDraft, id?: string) {
    if (id) {
      setExpenses((prev) => prev.map((e) => (e.id === id ? draftToExpense(draft, e) : e)));
      enqueueUpdate(name, id, draft);
      showToast("Expense updated");
    } else {
      const optimistic = draftToExpense(draft);
      setExpenses((prev) => [optimistic, ...prev]);
      enqueueCreate(name, optimistic.id, draft);
      showToast(`Added ${draft.title} · ${formatFor(name, draft.amount)}`);
    }
    setPending(pendingCount(name));
    void runSync(name);
    return Promise.resolve();
  }

  function handleDelete(id: string) {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    enqueueDelete(name, id);
    setPending(pendingCount(name));
    void runSync(name);
    return Promise.resolve();
  }

  return (
    <CurrencyProvider space={name}>
    <SettingsProvider
      key={name || "guest"}
      space={name}
      seed={bootSettings && bootSettings.space === name ? bootSettings.settings : null}
    >
    <main className="relative min-h-screen">
      <Background />

      {/*
       * Top padding respects the iOS safe-area inset so the header isn't hidden
       * under the notch / translucent status bar when installed as a PWA. On
       * Android and desktop env(safe-area-inset-top) is 0, so nothing changes.
       */}
      <div
        className="mx-auto w-full max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6 sm:pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:pt-[calc(env(safe-area-inset-top)+2.5rem)]"
      >
        {/* Header — stacks on phones so the brand + space name get the full
            width (never squeezed to "…" by the controls), and collapses back to
            a single row from `sm` up. This keeps the space name readable on any
            screen size, including narrow iPhones in installed-PWA mode. */}
        <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <div className="flex min-w-0 items-center gap-2.5 sm:flex-1 sm:gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#7c8cff] to-[#ff6bd0] shadow-glow sm:h-11 sm:w-11">
              <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              {/* `truncate` keeps the name on one line — otherwise "Spendly-Plus"
                  breaks at the hyphen on narrow iPhones and squeezes the space
                  name into an ellipsis. */}
              <h1 className="shimmer-hover truncate text-base font-semibold leading-tight sm:text-lg">
                Spendly-Plus
              </h1>
              <p className="truncate text-xs text-white/50">
                {status === "authed" ? `Space · ${name}` : "Liquid-glass expense tracker"}
              </p>
            </div>
          </div>

          {status === "authed" && (
            <div
              className={`flex shrink-0 flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2 ${
                isIOS ? "ios-compact" : ""
              }`}
            >
              <SyncButton
                online={online}
                syncing={syncing}
                pending={pending}
                error={syncError}
                onSync={() => void runSync(name)}
              />
              <CurrencySelect />
              <button
                onClick={() => setSettingsOpen(true)}
                className="glass-btn px-3 py-2.5"
                aria-label="Space settings"
                title="Space settings"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className={`glass-btn-primary px-4 py-2.5 ${
                  isNative ? "hidden sm:flex" : "flex"
                }`}
              >
                <Plus className="h-4 w-4" />
                <span>Add expense</span>
              </button>
              <button onClick={handleLogout} className="glass-btn px-3 py-2.5" aria-label="Lock space">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </header>

        {status === "loading" && (
          <div className="grid min-h-[50vh] place-items-center">
            <ShimmerText className="text-base">Loading your space…</ShimmerText>
          </div>
        )}

        {status === "authed" && (
          <Dashboard
            expenses={expenses}
            budget={budget}
            onSetBudget={handleSetBudget}
            mobileTab={mobileTab}
            tabbed={isNative}
            spaceName={name}
            onToast={showToast}
            onEdit={(e) => {
              setEditing(e);
              setFormOpen(true);
            }}
          />
        )}

        {status === "guest" && (
          <div className="grid min-h-[62vh] items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6 text-center lg:text-left"
            >
              <span className="pill mx-auto lg:mx-0">
                <Sparkles className="h-3.5 w-3.5" /> iOS-style liquid glass
              </span>
              <h2 className="text-5xl font-bold leading-[1.05] sm:text-6xl">
                Track every expense,
                <br />
                <span className="bg-gradient-to-r from-[#a5b4ff] via-[#e2b0ff] to-[#ff9ed8] bg-clip-text text-transparent">
                  beautifully.
                </span>
              </h2>
              <p className="mx-auto max-w-md text-lg text-white/60 lg:mx-0">
                A calm, glassy home for your daily, monthly and yearly spending.
                Set a passphrase to keep your space private and see your live
                statistics the moment you unlock it.
              </p>
              <ul className="mx-auto flex max-w-md flex-col gap-2.5 text-sm text-white/70 sm:flex-row sm:flex-wrap sm:justify-center lg:mx-0 lg:justify-start">
                <li className="pill">
                  <ShieldCheck className="h-4 w-4 text-[#38d9a9]" /> Private &amp; passphrase-protected
                </li>
                <li className="pill">
                  <Sparkles className="h-4 w-4 text-[#ff6bd0]" /> Live donuts, trends &amp; charts
                </li>
              </ul>
            </motion.div>

            <div className="flex justify-center">
              <AuthCard onAuthed={handleAuthed} />
            </div>
          </div>
        )}
      </div>

      <ExpenseForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
        recentTitles={recentTitles}
      />

      {/* Success toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className={`glass-strong fixed inset-x-0 z-[60] mx-auto flex w-fit items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-medium sm:bottom-6 ${
              isNative ? "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]" : "bottom-6"
            }`}
          >
            <PartyPopper className="h-4 w-4 text-[#ffd43b]" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The fixed bottom nav (mobile, authed) would otherwise sit on top of the
          footer, so give the footer extra bottom room to clear it. On desktop /
          guest (no nav) it's just the normal pb-8. */}
      <footer
        className={`flex flex-col items-center gap-2 pt-4 text-center text-xs text-white/35 sm:pb-8 ${
          status === "authed" && isNative
            ? "pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
            : "pb-8"
        }`}
      >
        <span>Spendly-Plus · built with Next.js · deploy-ready for Vercel</span>
        <div className="flex items-center gap-1">
          {status === "authed" ? (
            /* Inside a space: keep ONLY the update check + log export (native
               app only). The GitHub / Admin links belong to the landing page. */
            isNative && (
              <>
                <CheckUpdatesButton />
                <DownloadLogsButton />
              </>
            )
          ) : (
            /* Landing / home (no space open): the usual full footer. */
            <>
              <a
                href="https://github.com/Rakitic07/ExpenseApp"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View source & creator on GitHub"
                title="Made by Rakitic07 · View on GitHub"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white/80"
              >
                <Github className="h-4 w-4" />
                <span>Rakitic07</span>
              </a>
              {!isNative && (
                <a
                  href="https://github.com/Rakitic07/ExpenseApp/releases/latest/download/spendly-plus.apk"
                  aria-label="Download the Android app (APK)"
                  title="Download the Android app (.apk)"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white/80"
                >
                  <Download className="h-4 w-4" />
                  <span>Android app</span>
                </a>
              )}
              {/* Native app only: manual SHA-based update check (download+install). */}
              {isNative && <CheckUpdatesButton />}
              {isNative && <DownloadLogsButton />}
              <button
                type="button"
                onClick={() => {
                  setAdminLoaded(true);
                  setAdminOpen(true);
                }}
                aria-label="Open admin dashboard"
                title="Admin dashboard (owner only)"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-white/50 transition hover:bg-white/10 hover:text-white/80"
              >
                <Shield className="h-4 w-4" />
                <span>Admin</span>
              </button>
            </>
          )}
        </div>
      </footer>

      {/* Native-app-only mobile chrome: bottom tab navigation + floating Add
          button. This app-like layout is reserved for the installed APK/IPA; a
          phone browser or PWA gets the regular stacked website layout instead.
          Hidden on sm+ where the full desktop layout shows. */}
      {status === "authed" && isNative && (
        <>
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            aria-label="Add expense"
            className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#7c8cff] to-[#ff6bd0] text-white shadow-glow active:scale-95 sm:hidden"
          >
            <Plus className="h-6 w-6" />
          </button>

          <nav className="glass-strong fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-white/10 px-2 pb-[calc(env(safe-area-inset-bottom)+0.3rem)] pt-1.5 sm:hidden">
            {(
              [
                { id: "overview", label: "Overview", icon: LayoutGrid },
                { id: "charts", label: "Charts", icon: PieChart },
                { id: "activity", label: "Activity", icon: ReceiptText },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const active = mobileTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setMobileTab(id)}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[11px] font-medium transition ${
                    active ? "text-white" : "text-white/45 hover:text-white/70"
                  }`}
                >
                  <span
                    className={`grid h-8 w-16 place-items-center rounded-xl transition ${
                      active ? "bg-white/15" : ""
                    }`}
                  >
                    <Icon className="h-[22px] w-[22px]" />
                  </span>
                  {label}
                </button>
              );
            })}
          </nav>
        </>
      )}

      {/* In-app updater (native app only): refresh web / install new APK. */}
      <UpdatePrompt />
      {/* Native-only: brief "installed vs latest APK sha" badge on launch. */}
      <UpdateDebugBadge />

      {adminLoaded && (
        <AdminDashboard open={adminOpen} onClose={() => setAdminOpen(false)} />
      )}
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
    </SettingsProvider>
    </CurrencyProvider>
  );
}
