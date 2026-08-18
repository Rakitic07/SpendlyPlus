import type { Expense, ExpenseDraft } from "./types";
import { api, ApiError } from "./api";

/*
 * Offline-first store (cache + queued writes).
 *
 * The database stays the source of truth, but the app keeps a per-space copy of
 * expenses in localStorage so it can:
 *   - open instantly with the last-known data (no waiting on the network), and
 *   - accept add/edit/delete while offline, queuing them and flushing to the DB
 *     automatically once a connection is available.
 *
 * Note: this stores ordinary expense data only — never session tokens or other
 * secrets (those stay in the HttpOnly cookie).
 */

type CreateOp = { kind: "create"; tempId: string; draft: ExpenseDraft; ts: number };
type UpdateOp = { kind: "update"; id: string; draft: ExpenseDraft; ts: number };
type DeleteOp = { kind: "delete"; id: string; ts: number };
export type QueueOp = CreateOp | UpdateOp | DeleteOp;

const cacheKey = (space: string) => `spendly.cache.${space}`;
const queueKey = (space: string) => `spendly.queue.${space}`;
const syncedKey = (space: string) => `spendly.lastSync.${space}`;
const budgetKey = (space: string) => `spendly.budget.${space}`;
const budgetDirtyKey = (space: string) => `spendly.budgetDirty.${space}`;
const lastSpaceKey = "spendly.lastSpace";

// Remember the last-opened space (its name is not a secret) so a cold OFFLINE
// open can still restore that space's cached data — the space name otherwise
// lives only in the HttpOnly cookie, which JS can't read.
export function rememberSpace(space: string): void {
  if (space) write(lastSpaceKey, space);
}

export function getLastSpace(): string {
  return read<string>(lastSpaceKey, "");
}

export function forgetSpace(): void {
  try {
    localStorage.removeItem(lastSpaceKey);
  } catch {
    /* ignore */
  }
}

export function isTempId(id: string): boolean {
  return id.startsWith("local-");
}

export function newTempId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `local-${rand}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

/* ---------- cache ---------- */

export function readCache(space: string): Expense[] {
  if (!space) return [];
  return read<Expense[]>(cacheKey(space), []);
}

export function writeCache(space: string, expenses: Expense[]): void {
  if (!space) return;
  write(cacheKey(space), expenses);
}

export function getLastSync(space: string): number {
  if (!space) return 0;
  return read<number>(syncedKey(space), 0);
}

// Re-attach thumbnails to a freshly pulled server list from the local cache so
// the on-device preview survives even when the backend doesn't return the field
// yet. `mapped` (tempId→realId) carries a brand-new row's thumbnail across its
// id remap, since the cache still holds it under the temp id.
function backfillThumbnails(
  space: string,
  server: Expense[],
  mapped: Record<string, string> = {}
): Expense[] {
  const prev = readCache(space);
  const byId = new Map<string, string>();
  for (const e of prev) if (e.thumbnail) byId.set(e.id, e.thumbnail);
  for (const [temp, real] of Object.entries(mapped)) {
    const t = byId.get(temp);
    if (t) byId.set(real, t);
  }
  return server.map((e) => {
    if (e.thumbnail) return e;
    // The server explicitly reports no bill for this row (e.g. it was removed) —
    // don't resurrect a stale cached preview.
    if (e.hasThumbnail === false) return e;
    const t = byId.get(e.id);
    return t ? { ...e, thumbnail: t } : e;
  });
}

// Public wrapper: re-attach cached thumbnails to any freshly pulled server list
// (e.g. the startup bootstrap payload, which omits the heavy base64 to stay
// small). Same-device previews survive without a refetch; cross-device ones are
// fetched lazily when a bill is opened.
export function mergeCachedThumbnails(space: string, server: Expense[]): Expense[] {
  return backfillThumbnails(space, server);
}

function setLastSync(space: string, ts: number): void {
  write(syncedKey(space), ts);
}

/* ---------- budget (per-space setting, synced to the DB) ---------- */

export function readBudget(space: string): number | null {
  if (!space) return null;
  const v = read<number | null>(budgetKey(space), null);
  return typeof v === "number" && v > 0 ? v : null;
}

function writeBudgetLocal(space: string, value: number | null): void {
  if (!space) return;
  write(budgetKey(space), value && value > 0 ? value : null);
}

// A local edit: store it and mark it dirty so the next sync pushes it to the DB.
export function setBudgetLocal(space: string, value: number | null): void {
  writeBudgetLocal(space, value);
  write(budgetDirtyKey(space), Date.now());
}

// The server's value is authoritative: store it and clear any dirty flag.
export function adoptServerBudget(space: string, value: number | null): void {
  writeBudgetLocal(space, value);
  clearBudgetDirty(space);
}

export function isBudgetDirty(space: string): boolean {
  if (!space) return false;
  return read<number>(budgetDirtyKey(space), 0) > 0;
}

function clearBudgetDirty(space: string): void {
  try {
    localStorage.removeItem(budgetDirtyKey(space));
  } catch {
    /* ignore */
  }
}

/* ---------- queue ---------- */

export function readQueue(space: string): QueueOp[] {
  if (!space) return [];
  return read<QueueOp[]>(queueKey(space), []);
}

function writeQueue(space: string, ops: QueueOp[]): void {
  if (!space) return;
  write(queueKey(space), ops);
}

export function pendingCount(space: string): number {
  return readQueue(space).length;
}

/**
 * Build an optimistic Expense for immediate display from a draft.
 */
export function draftToExpense(draft: ExpenseDraft, base?: Expense): Expense {
  const now = new Date().toISOString();
  return {
    id: base?.id ?? newTempId(),
    title: draft.title,
    category: draft.category,
    amount: draft.amount,
    paidBy: draft.paidBy,
    date: new Date(draft.date).toISOString(),
    notes: draft.notes ? draft.notes : null,
    paymentMode: draft.paymentMode ? draft.paymentMode : null,
    paymentDetail: draft.paymentDetail ? draft.paymentDetail : null,
    // undefined = "leave as-is" (keep the base row's bill); "" = explicit remove;
    // a string = new/updated image. Mirrors the server's PATCH semantics so an
    // optimistic edit shows the same result the DB will settle on.
    thumbnail:
      draft.thumbnail !== undefined
        ? draft.thumbnail || null
        : (base?.thumbnail ?? null),
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
  };
}

export function enqueueCreate(space: string, tempId: string, draft: ExpenseDraft): void {
  const ops = readQueue(space);
  ops.push({ kind: "create", tempId, draft, ts: Date.now() });
  writeQueue(space, ops);
}

export function enqueueUpdate(space: string, id: string, draft: ExpenseDraft): void {
  let ops = readQueue(space);
  if (isTempId(id)) {
    // Not synced yet: fold the edit into the pending create so we only ever
    // send the latest version to the server.
    const create = ops.find((o) => o.kind === "create" && o.tempId === id) as
      | CreateOp
      | undefined;
    if (create) {
      create.draft = draft;
      writeQueue(space, ops);
      return;
    }
  }
  // Collapse consecutive updates for the same row (last write wins).
  ops = ops.filter((o) => !(o.kind === "update" && o.id === id));
  ops.push({ kind: "update", id, draft, ts: Date.now() });
  writeQueue(space, ops);
}

export function enqueueDelete(space: string, id: string): void {
  let ops = readQueue(space);
  if (isTempId(id)) {
    // Never reached the server — just drop any pending ops for it.
    ops = ops.filter(
      (o) =>
        !((o.kind === "create" && o.tempId === id) ||
          (o.kind === "update" && o.id === id))
    );
    writeQueue(space, ops);
    return;
  }
  // Drop pending updates for this row, then queue the delete.
  ops = ops.filter((o) => !(o.kind === "update" && o.id === id));
  ops.push({ kind: "delete", id, ts: Date.now() });
  writeQueue(space, ops);
}

function remap(op: QueueOp, from: string, to: string): QueueOp {
  if (op.kind === "update" && op.id === from) return { ...op, id: to };
  if (op.kind === "delete" && op.id === from) return { ...op, id: to };
  return op;
}

/** A queued op the server permanently rejected, kept so the UI can explain it. */
export type DroppedOp = { op: QueueOp; reason: string };

export type FlushResult = {
  /** tempId -> real server id, for optimistic rows that got created. */
  mapped: Record<string, string>;
  /** true if the whole queue drained (a permanent rejection still counts). */
  ok: boolean;
  /** Ops discarded because the server rejected them as invalid (non-retryable). */
  dropped: DroppedOp[];
};

// A failure is "permanent" when retrying it can never succeed: the payload is
// bad (400/413/422), the row is gone (404), or it conflicts (409). Those must
// be dropped or they wedge the whole queue and pin the sync badge red forever.
// Auth (401/403) and throttling/timeout (408/429) are transient, as is any
// network/parse error (not an ApiError) — those stay queued for a later retry.
function isPermanentFailure(err: unknown): boolean {
  if (err instanceof ApiError) {
    const s = err.status;
    return s >= 400 && s < 500 && s !== 401 && s !== 403 && s !== 408 && s !== 429;
  }
  return false;
}

/**
 * Push queued mutations to the server, in order. Stops (and keeps the rest
 * queued) on the first *transient* failure, e.g. when offline. A *permanent*
 * failure (bad payload) is discarded so the queue can keep draining instead of
 * jamming forever. Safe to call repeatedly.
 */
export async function flush(space: string): Promise<FlushResult> {
  const mapped: Record<string, string> = {};
  const dropped: DroppedOp[] = [];
  let ops = readQueue(space);

  while (ops.length > 0) {
    const op = ops[0];
    try {
      if (op.kind === "create") {
        const { expense } = await api.createExpense(op.draft);
        mapped[op.tempId] = expense.id;
        // Rewrite later ops that referenced the temp id, then drop this op.
        ops = ops.slice(1).map((o) => remap(o, op.tempId, expense.id));
      } else if (op.kind === "update") {
        if (isTempId(op.id)) break; // its create hasn't synced yet; try later
        await api.updateExpense(op.id, op.draft);
        ops = ops.slice(1);
      } else {
        // delete
        if (!isTempId(op.id)) await api.deleteExpense(op.id);
        ops = ops.slice(1);
      }
      writeQueue(space, ops); // persist progress after every op
    } catch (err) {
      if (isPermanentFailure(err)) {
        // The server will never accept this op (e.g. it failed validation).
        // Discard it so the rest of the queue can drain and the badge can go
        // green, but surface it so the UI can tell the user what was dropped.
        dropped.push({ op, reason: (err as ApiError).message });
        ops = ops.slice(1);
        writeQueue(space, ops);
        continue;
      }
      // Transient (offline / 5xx / auth): keep everything queued and retry later.
      writeQueue(space, ops);
      return { mapped, ok: false, dropped };
    }
  }

  writeQueue(space, ops);
  return { mapped, ok: true, dropped };
}

/**
 * Full sync: push a pending budget change, flush queued expense writes, and
 * (only when the queue is fully drained) pull the canonical list + budget from
 * the server into the cache.
 *
 * `budget` in the result is `undefined` when nothing was pulled/pushed (so the
 * caller leaves its state untouched), or `number | null` when the server value
 * is now known.
 */
export async function sync(space: string): Promise<{
  expenses: Expense[] | null;
  budget?: number | null;
  mapped: Record<string, string>;
  ok: boolean;
  dropped: DroppedOp[];
}> {
  // 1) Push a locally-edited budget first so it isn't clobbered by the pull.
  let budget: number | null | undefined;
  if (isBudgetDirty(space)) {
    try {
      const res = await api.setBudget(readBudget(space));
      adoptServerBudget(space, res.budget);
      budget = res.budget;
    } catch {
      /* still offline — keep it dirty for the next attempt */
    }
  }

  // 2) Flush queued expense mutations.
  const { mapped, ok, dropped } = await flush(space);

  if (ok && readQueue(space).length === 0) {
    const { expenses } = await api.listExpenses();
    // Preserve thumbnails locally even if the server didn't echo them back
    // (older deploy / column not yet migrated). Match by id, and also carry a
    // just-created row's thumbnail across its temp→real id remap.
    const merged = backfillThumbnails(space, expenses, mapped);
    writeCache(space, merged);
    setLastSync(space, Date.now());
    // 3) Pull the budget too (unless we just pushed it) so other devices' edits
    //    show up on a manual sync without a full reload.
    if (budget === undefined && !isBudgetDirty(space)) {
      try {
        const res = await api.getBudget();
        adoptServerBudget(space, res.budget);
        budget = res.budget;
      } catch {
        /* ignore — budget stays as cached */
      }
    }
    return { expenses: merged, budget, mapped, ok: true, dropped };
  }
  return { expenses: null, budget, mapped, ok, dropped };
}
