"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Check, Trash2, ChevronDown, ChevronUp, Camera, Image as ImageIcon } from "lucide-react";
import { CATEGORIES, CATEGORY_NAMES } from "@/lib/categories";
import { api } from "@/lib/api";
import { scanBillFromFile } from "@/lib/scanBill";
import { isMobileDevice } from "@/lib/platform";
import { useSettings } from "@/lib/settings";

// On phones we show only the first TOP_COUNT categories + "Other" by default;
// the rest live behind a "More categories" toggle. The web app shows them all.
const TOP_COUNT = 10;

// True for categories hidden on phones until expanded (everything after the top
// slice, except the always-visible "Other").
function isExtraCategory(name: string): boolean {
  const idx = CATEGORIES.findIndex((c) => c.name === name);
  return idx >= TOP_COUNT && name !== "Other";
}
import type { Expense, ExpenseDraft } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { PAYMENT_MODES, OTHER_PROVIDER, paymentProviders } from "@/lib/payments";
import DatePicker from "./DatePicker";
import { ShimmerText } from "./Shimmer";

// Distinct accent per quick-suggestion chip so a picked one lights up in colour.
const SUGGESTION_COLORS = ["#7c8cff", "#ff6bd0", "#38d9a9", "#ffd43b"];

// Accent colour per payment mode so the selected one lights up (like categories).
const PAYMENT_MODE_COLORS: Record<string, string> = {
  Cash: "#38d9a9",
  UPI: "#7c8cff",
  Card: "#ff6bd0",
};

function toDateInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function ExpenseForm({
  open,
  editing,
  onClose,
  onSave,
  onDelete,
  recentTitles = [],
}: {
  open: boolean;
  editing: Expense | null;
  onClose: () => void;
  onSave: (draft: ExpenseDraft, id?: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  recentTitles?: string[];
}) {
  const { currency } = useCurrency();
  const { settings } = useSettings();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].name);
  // Free-text label shown only when the "Other" category is picked.
  const [customCategory, setCustomCategory] = useState("");
  // Phones: whether the extra categories are revealed.
  const [catsExpanded, setCatsExpanded] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [date, setDate] = useState(toDateInput());
  // Payment: the mode (Cash/UPI/Card), the chosen provider from the dropdown
  // (or the "Other" sentinel), and the free-text value when "Other" is picked.
  const [paymentMode, setPaymentMode] = useState("");
  const [providerChoice, setProviderChoice] = useState("");
  const [customProvider, setCustomProvider] = useState("");
  // Lets the user dismiss the recent-title suggestion chips for this entry.
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bill scanning (camera → OCR → prefill). Thumbnail is a tiny (~10KB) JPEG.
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  // The server keeps the stored bill unless we send an explicit value, so a
  // quick save before a lazy-loaded thumbnail arrives can't wipe it. This flag
  // records a deliberate "remove bill" so we send "" (clear) rather than omit.
  const [thumbCleared, setThumbCleared] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // Full-size lightbox for the (tiny) bill thumbnail — scans and edits alike.
  const [viewer, setViewer] = useState(false);
  // The camera-capture button makes sense on any phone/tablet (PWA, native, or
  // mobile browser) with a rear camera. Desktop browsers just get "Choose from
  // Gallery" — a capture button there would only open a file dialog anyway.
  const [showCamera, setShowCamera] = useState(false);
  useEffect(() => {
    setShowCamera(isMobileDevice());
  }, []);
  // Fields the scan auto-filled, highlighted so the user knows what to verify.
  const [hi, setHi] = useState<Record<string, boolean>>({});
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const clearHi = (k: string) =>
    setHi((h) => (h[k] ? { ...h, [k]: false } : h));

  // Provider options depend on the payment mode AND the space's currency, so an
  // INR user sees Google Pay/PhonePe while a USD user sees Apple Pay/Venmo, etc.
  const providerOptions = useMemo(
    () => paymentProviders(paymentMode, currency.code),
    [paymentMode, currency.code]
  );

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      // A saved category that isn't in our list was entered via "Other" —
      // reselect "Other" and restore its custom label.
      const known = CATEGORY_NAMES.includes(editing.category);
      const cat = known ? editing.category : "Other";
      setCategory(cat);
      setCustomCategory(known ? "" : editing.category);
      // Reveal the extras if the editing category lives among them.
      setCatsExpanded(isExtraCategory(cat));
      setAmount(String(editing.amount));
      setPaidBy(editing.paidBy);
      setDate(toDateInput(editing.date));
      // Restore payment: if the saved provider isn't in the current list (e.g. a
      // custom value, or the currency changed), treat it as an "Other" entry.
      const mode = editing.paymentMode ?? "";
      const detail = editing.paymentDetail ?? "";
      setPaymentMode(mode);
      const knownProviders = paymentProviders(mode, currency.code);
      if (detail && knownProviders.includes(detail)) {
        setProviderChoice(detail);
        setCustomProvider("");
      } else if (detail) {
        setProviderChoice(OTHER_PROVIDER);
        setCustomProvider(detail);
      } else {
        setProviderChoice("");
        setCustomProvider("");
      }
      setThumbnail(editing.thumbnail ?? null);
    } else {
      setTitle("");
      setCategory(CATEGORIES[0].name);
      setCustomCategory("");
      setCatsExpanded(false);
      setAmount("");
      setPaidBy(settings.defaultPayer);
      setDate(toDateInput());
      setPaymentMode("");
      setProviderChoice("");
      setCustomProvider("");
      setThumbnail(null);
    }
    setSuggestionsHidden(false);
    setScanNote(null);
    setHi({});
    setError(null);
    setThumbCleared(false);
  }, [open, editing, currency.code, settings.defaultPayer]);

  // The list/bootstrap payloads omit thumbnails to stay light. If we're editing a
  // row the server says has a bill but this device hasn't cached the image (e.g.
  // it was scanned on another device), pull just that one thumbnail on demand.
  useEffect(() => {
    if (!open || !editing) return;
    if (editing.thumbnail || !editing.hasThumbnail) return;
    let cancelled = false;
    (async () => {
      try {
        const { thumbnail: t } = await api.getThumbnail(editing.id);
        if (!cancelled && t) {
          setThumbnail(t);
          setThumbCleared(false);
        }
      } catch {
        /* offline / not found — keep showing the category icon */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editing]);

  // Apply a scanned bill: prefill whatever we could read. The form is the
  // editable preview, so the user completes anything missing before saving.
  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-triggers change.
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setScanNote(null);
    setError(null);
    try {
      const { parsed, thumbnail: thumb } = await scanBillFromFile(file);
      setThumbnail(thumb);
      const marks: Record<string, boolean> = {};
      // Browser OCR (tesseract) is best-effort. Only trust the read when a
      // meaningful field — amount or date — came through; otherwise a lone
      // "title" is almost always OCR noise (e.g. "REE"), so we skip prefilling
      // it and tell the user to enter details manually.
      const strong = parsed.amount != null || !!parsed.date;
      if (strong && parsed.title) {
        setTitle(parsed.title);
        marks.title = true;
      }
      if (parsed.amount != null) {
        setAmount(String(parsed.amount));
        marks.amount = true;
      }
      if (parsed.date) {
        setDate(parsed.date);
        marks.date = true;
      }
      if (strong && parsed.category && CATEGORY_NAMES.includes(parsed.category)) {
        setCategory(parsed.category);
        setCustomCategory("");
        setCatsExpanded(isExtraCategory(parsed.category));
        marks.category = true;
      }
      if (strong && parsed.paymentMode) {
        setPaymentMode(parsed.paymentMode);
        marks.payment = true;
        const list = paymentProviders(parsed.paymentMode, currency.code);
        const match = parsed.paymentDetail
          ? list.find((x) => x.toLowerCase() === parsed.paymentDetail!.toLowerCase())
          : undefined;
        if (match) {
          setProviderChoice(match);
          setCustomProvider("");
        } else if (parsed.paymentDetail) {
          setProviderChoice(OTHER_PROVIDER);
          setCustomProvider(parsed.paymentDetail);
        } else {
          setProviderChoice("");
          setCustomProvider("");
        }
      }
      setHi(marks);
      setScanNote(
        strong
          ? "Bill fetched — auto-detected details can sometimes be wrong (especially the amount, which may pick a line item). Please review carefully, fix the highlighted fields, then add."
          : "Bill attached, but browser scanning couldn’t read the details reliably — please enter them manually. (The mobile app reads bills far more accurately.)"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan the bill.");
    } finally {
      setScanning(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a valid amount greater than 0.");
      return;
    }
    if (!category) {
      setError("Please pick a category.");
      return;
    }
    // "Paid by" is a person's name — allow digits within it (e.g. "Raj 2") but
    // reject values that are only numbers/symbols with no letters at all.
    if (!/[a-zA-Z]/.test(paidBy)) {
      setError("“Paid by” should be a name — please include letters, not just numbers.");
      return;
    }
    // When "Other" is chosen, use the typed label (if any) as the real category.
    const finalCategory =
      category === "Other" && customCategory.trim() ? customCategory.trim() : category;
    // Resolve the payment detail: none for Cash/unset, the typed value for
    // "Other", otherwise the picked provider.
    const finalDetail =
      !paymentMode || paymentMode === "Cash"
        ? undefined
        : providerChoice === OTHER_PROVIDER
          ? customProvider.trim() || undefined
          : providerChoice || undefined;
    setBusy(true);
    try {
      await onSave(
        {
          title: title.trim(),
          category: finalCategory,
          amount: amountNum,
          paidBy: paidBy.trim(),
          date,
          paymentMode: paymentMode || undefined,
          paymentDetail: finalDetail,
          // Omit when unknown (leave the stored bill untouched); "" only when the
          // user explicitly removed it; the string when we have an image.
          thumbnail: thumbnail ? thumbnail : thumbCleared ? "" : undefined,
        },
        editing?.id
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          {/* Solid overlay (no backdrop-blur): blurring the whole screen while
              fading in is very expensive on phones and made the popup crawl. */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />
          {/* Plain (non-animated) panel: the surface is frosted glass, and
              animating a blurred element re-rasterizes it every frame, which was
              the real cause of the slow, laggy open. A single quick fade on the
              wrapper above is all the motion we need. */}
          <div className="glass-strong relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-4xl p-6 sm:max-w-lg sm:rounded-4xl">
            {scanning && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-t-4xl bg-black/70 sm:rounded-4xl">
                <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <ShimmerText className="text-sm">Reading bill…</ShimmerText>
                <p className="text-xs text-white/60">
                  Extracting details from your receipt
                </p>
              </div>
            )}
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {editing ? "Edit expense" : "Add expense"}
              </h3>
              <button
                onClick={onClose}
                className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {/* Scan a bill: capture (camera, PWA only) or pick from gallery.
                  OCR runs fully in the browser and prefills the fields below. */}
              {showCamera && (
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onFileSelected}
                />
              )}
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileSelected}
              />
              <div className={cn("grid gap-2", showCamera ? "grid-cols-2" : "grid-cols-1")}>
                {showCamera && (
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={scanning}
                    className="glass-btn justify-center border-white/15 disabled:opacity-60"
                  >
                    <Camera className="h-4 w-4" />
                    Scan a bill
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={scanning}
                  className="glass-btn justify-center border-white/15 disabled:opacity-60"
                >
                  <ImageIcon className="h-4 w-4" />
                  Choose from Gallery
                </button>
              </div>

              {((thumbnail && settings.showThumbnails) || scanNote) && (
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2.5">
                  {thumbnail && settings.showThumbnails && (
                    <div className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbnail}
                        alt="Scanned bill preview"
                        onClick={() => setViewer(true)}
                        className="h-16 w-12 cursor-zoom-in rounded-lg border border-white/10 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setThumbnail(null);
                          setThumbCleared(true);
                        }}
                        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-white"
                        aria-label="Remove bill preview"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <p className="text-xs leading-relaxed text-white/60">
                    {scanNote || "Bill preview — click the image to view it larger."}
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60">
                  What did you spend on?
                </label>
                <input
                  className={cn("glass-input", hi.title && "ring-2 ring-[#7c8cff] bg-[#7c8cff]/10")}
                  placeholder="e.g. Paid for groceries, Online shopping at Amazon"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    clearHi("title");
                  }}
                  required
                />
                {settings.recentSuggestions && !editing && !suggestionsHidden && recentTitles.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {recentTitles.slice(0, 4).map((t, i) => {
                      const color = SUGGESTION_COLORS[i % SUGGESTION_COLORS.length];
                      const active = title.trim() === t;
                      return (
                        <button
                          type="button"
                          key={t}
                          onClick={() => setTitle(t)}
                          className={cn(
                            "pill select-none transition",
                            active ? "text-white" : "text-white/70 hover:text-white"
                          )}
                          // Picked suggestion lights up in its own colour.
                          style={
                            active
                              ? {
                                  background: color + "40",
                                  borderColor: color,
                                  boxShadow: `0 0 0 2px ${color}`,
                                }
                              : undefined
                          }
                        >
                          {t}
                        </button>
                      );
                    })}
                    {/* Dismiss the suggestion chips for this entry. */}
                    <button
                      type="button"
                      onClick={() => setSuggestionsHidden(true)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white/45 transition hover:text-white/80"
                      aria-label="Clear suggestions"
                    >
                      <X className="h-3 w-3" /> Clear
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60">
                  Category
                </label>
                <div
                  className={cn(
                    "flex flex-wrap gap-2",
                    !catsExpanded && "cats-collapsed",
                    hi.category && "rounded-2xl p-2 ring-2 ring-[#7c8cff] bg-[#7c8cff]/10"
                  )}
                >
                  {CATEGORIES.map((c, i) => (
                    <button
                      type="button"
                      key={c.name}
                      // Tap toggles: tapping the selected category again clears it.
                      // (Works on touch devices, unlike double-click.)
                      onClick={() => {
                        setCategory((prev) => (prev === c.name ? "" : c.name));
                        clearHi("category");
                      }}
                      title="Tap again to clear"
                      className={cn(
                        "pill select-none transition",
                        // Hidden on phones (until expanded) for everything past
                        // the top slice, except "Other".
                        i >= TOP_COUNT && c.name !== "Other" && "cat-extra",
                        category === c.name
                          ? "ring-2 ring-white/60"
                          : "opacity-70 hover:opacity-100"
                      )}
                      style={
                        category === c.name
                          ? { background: c.color + "40", borderColor: c.color }
                          : undefined
                      }
                    >
                      <span>{c.emoji}</span>
                      {c.name}
                    </button>
                  ))}
                </div>

                {/* Expand/collapse the extra categories — phones only. */}
                <button
                  type="button"
                  onClick={() => setCatsExpanded((v) => !v)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-white/60 transition hover:text-white sm:hidden"
                >
                  {catsExpanded ? (
                    <>
                      Show fewer categories <ChevronUp className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      More categories <ChevronDown className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>

                {/* Extra field appears only for "Other"; it disappears the moment
                    any other category is selected. */}
                {category === "Other" && (
                  <input
                    className="glass-input mt-2"
                    placeholder="Specify category (e.g. Parking, Repairs)"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    autoFocus
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/60">
                    Amount ({currency.symbol})
                  </label>
                  <input
                    className={cn("glass-input", hi.amount && "ring-2 ring-[#7c8cff] bg-[#7c8cff]/10")}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      clearHi("amount");
                    }}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/60">
                    Date
                  </label>
                  <div className={cn(hi.date && "rounded-2xl p-1 ring-2 ring-[#7c8cff] bg-[#7c8cff]/10")}>
                    <DatePicker
                      value={date}
                      onChange={(d) => {
                        setDate(d);
                        clearHi("date");
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60">
                  Paid by
                </label>
                <input
                  className="glass-input"
                  placeholder="e.g. Raktim"
                  value={paidBy}
                  onChange={(e) => setPaidBy(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60">
                  Payment mode (optional)
                </label>
                <div
                  className={cn(
                    "flex flex-wrap gap-2",
                    hi.payment && "rounded-2xl p-2 ring-2 ring-[#7c8cff] bg-[#7c8cff]/10"
                  )}
                >
                  {PAYMENT_MODES.map((m) => (
                    <button
                      type="button"
                      key={m}
                      // Tap toggles: tapping the selected mode again clears it.
                      onClick={() => {
                        setPaymentMode((prev) => (prev === m ? "" : m));
                        // Switching mode invalidates any picked provider.
                        setProviderChoice("");
                        setCustomProvider("");
                        clearHi("payment");
                      }}
                      title="Tap again to clear"
                      className={cn(
                        "pill select-none transition",
                        paymentMode === m
                          ? "font-semibold text-white ring-2 ring-white/60"
                          : "opacity-70 hover:opacity-100"
                      )}
                      style={
                        paymentMode === m
                          ? {
                              background: PAYMENT_MODE_COLORS[m] + "40",
                              borderColor: PAYMENT_MODE_COLORS[m],
                            }
                          : undefined
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {/* Provider dropdown — only for UPI/Card (Cash needs no detail).
                    Options adapt to the space's currency. */}
                {paymentMode && paymentMode !== "Cash" && (
                  <div className="mt-2 space-y-2">
                    <select
                      className="glass-input"
                      value={providerChoice}
                      onChange={(e) => setProviderChoice(e.target.value)}
                    >
                      <option value="">
                        {paymentMode === "UPI" ? "Select app…" : "Select bank…"}
                      </option>
                      {providerOptions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      <option value={OTHER_PROVIDER}>Other…</option>
                    </select>

                    {providerChoice === OTHER_PROVIDER && (
                      <input
                        className="glass-input"
                        placeholder={
                          paymentMode === "UPI"
                            ? "Enter app name"
                            : "Enter bank / card name"
                        }
                        value={customProvider}
                        onChange={(e) => setCustomProvider(e.target.value)}
                        maxLength={40}
                        autoFocus
                      />
                    )}
                  </div>
                )}
              </div>

              {error && (
                <p className="rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-2.5 text-sm text-red-100">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-3 pt-1">
                {editing && onDelete && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!editing) return;
                      if (
                        settings.confirmDelete &&
                        !window.confirm(`Delete “${editing.title}”? This can't be undone.`)
                      ) {
                        return;
                      }
                      setBusy(true);
                      try {
                        await onDelete(editing.id);
                        onClose();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="glass-btn border-red-400/30 bg-red-500/15 text-red-100 hover:bg-red-500/25"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="glass-btn-primary flex-1"
                >
                  <Check className="h-4 w-4" />
                  {busy ? "Saving…" : editing ? "Save changes" : "Add expense"}
                </button>
              </div>
            </form>
          </div>

          {/* Click-to-enlarge lightbox. The thumbnail is a tiny ~10KB JPEG so it
              looks soft when zoomed — expected, since the full photo is never
              stored. */}
          {viewer && thumbnail && settings.showThumbnails && (
            <div
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 p-6"
              onClick={() => setViewer(false)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnail}
                alt="Bill preview"
                className="max-h-[75vh] max-w-full rounded-xl object-contain"
              />
              <p className="text-xs text-white/60">Click anywhere to close</p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
