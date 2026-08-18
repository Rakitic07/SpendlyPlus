import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from '../lib/api';
import type { Expense, ExpenseDraft } from '../lib/types';
import {
  getLastSpace,
  loadToken,
  readBudgetCache,
  readCache,
  setLastSpace,
  writeBudgetCache,
  writeCache,
} from '../lib/storage';
import { loadSettings } from '../lib/settings';

type Status = 'loading' | 'authed' | 'guest';

type PendingOp =
  | { kind: 'create'; tempId: string; draft: ExpenseDraft }
  | { kind: 'update'; id: string; draft: ExpenseDraft }
  | { kind: 'delete'; id: string };

type Store = {
  status: Status;
  name: string;
  expenses: Expense[];
  budget: number | null;
  online: boolean;
  syncing: boolean;
  pendingCount: number;

  login: (name: string, passphrase: string) => Promise<void>;
  register: (name: string, passphrase: string) => Promise<{ recoveryCode: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  addExpense: (draft: ExpenseDraft) => Promise<void>;
  editExpense: (id: string, draft: ExpenseDraft) => Promise<void>;
  removeExpense: (id: string) => Promise<void>;
  saveBudget: (budget: number | null) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

function uid(): string {
  return 'local-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function draftToExpense(draft: ExpenseDraft, id: string): Expense {
  const now = new Date().toISOString();
  return {
    id,
    title: draft.title,
    category: draft.category,
    amount: draft.amount,
    paidBy: draft.paidBy,
    date: new Date(draft.date).toISOString(),
    notes: draft.notes ? draft.notes : null,
    paymentMode: draft.paymentMode ? draft.paymentMode : null,
    paymentDetail: draft.paymentDetail ? draft.paymentDetail : null,
    thumbnail: draft.thumbnail ? draft.thumbnail : null,
    createdAt: now,
    updatedAt: now,
  };
}

function dayStart(iso: string): number {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Newest day first; within the same day the most recently added entry on top.
// Same-day rows carry an identical date-only value, so `createdAt` breaks the
// tie and keeps the latest entry at the top of the list.
function sortByDate(list: Expense[]): Expense[] {
  return [...list].sort((a, b) => {
    const dayDiff = dayStart(b.date) - dayStart(a.date);
    if (dayDiff !== 0) return dayDiff;
    return (+new Date(b.createdAt) || 0) - (+new Date(a.createdAt) || 0);
  });
}

// The backend may not echo `thumbnail` back yet (older deploy / column not
// migrated). Keep the locally-known thumbnail so the on-device preview never
// disappears after a save.
function keepThumb(server: Expense, fallback?: string | null): Expense {
  return server.thumbnail ? server : { ...server, thumbnail: fallback ?? null };
}

// Re-attach thumbnails to a freshly pulled server list from what we already
// have cached (matched by id), for the same reason.
function backfillThumbs(server: Expense[], prev: Expense[]): Expense[] {
  const byId = new Map<string, string>();
  for (const e of prev) if (e.thumbnail) byId.set(e.id, e.thumbnail);
  return server.map(e => {
    if (e.thumbnail) return e;
    const t = byId.get(e.id);
    return t ? { ...e, thumbnail: t } : e;
  });
}

const QUEUE_KEY = 'spendly.queue';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [name, setName] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budget, setBudget] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState<PendingOp[]>([]);

  const spaceRef = useRef('');

  const persistQueue = useCallback(async (q: PendingOp[]) => {
    setPending(q);
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    } catch {
      /* ignore */
    }
  }, []);

  // Flush queued mutations against the backend, remapping temp ids to real ones.
  const flushQueue = useCallback(
    async (queue: PendingOp[]): Promise<boolean> => {
      if (queue.length === 0) return true;
      let ok = true;
      const remaining: PendingOp[] = [];
      // Temp ids whose create was permanently rejected — their optimistic row
      // and any later ops referencing them must be discarded too.
      const droppedTempIds = new Set<string>();
      for (const op of queue) {
        // A create that already failed for good: don't try its follow-up edits.
        if (
          (op.kind === 'update' || op.kind === 'delete') &&
          droppedTempIds.has(op.id)
        ) {
          continue;
        }
        try {
          if (op.kind === 'create') {
            const { expense } = await api.createExpense(op.draft);
            setExpenses(prev =>
              sortByDate(
                prev.map(e => (e.id === op.tempId ? keepThumb(expense, op.draft.thumbnail) : e)),
              ),
            );
          } else if (op.kind === 'update') {
            if (op.id.startsWith('local-')) {
              remaining.push(op);
              continue;
            }
            await api.updateExpense(op.id, op.draft);
          } else if (op.kind === 'delete') {
            if (op.id.startsWith('local-')) continue;
            await api.deleteExpense(op.id);
          }
        } catch (err) {
          // A permanent (4xx, non-auth) rejection can never succeed on retry and
          // would wedge the queue forever, keeping the app stuck "offline". Drop
          // it and remove its optimistic row instead of retrying endlessly.
          const s = err instanceof ApiError ? err.status : 0;
          const permanent = s >= 400 && s < 500 && s !== 401 && s !== 403 && s !== 408 && s !== 429;
          if (permanent) {
            const goneId = op.kind === 'create' ? op.tempId : op.id;
            if (op.kind === 'create') droppedTempIds.add(op.tempId);
            setExpenses(prev => prev.filter(e => e.id !== goneId));
            continue;
          }
          ok = false;
          remaining.push(op);
        }
      }
      await persistQueue(remaining.filter(o => !(o.kind !== 'create' && droppedTempIds.has(o.id))));
      return ok;
    },
    [persistQueue],
  );

  const refresh = useCallback(async () => {
    setSyncing(true);
    try {
      const flushed = await flushQueue(pending);
      const data = await api.bootstrap();
      setOnline(true);
      if (!data.authenticated) {
        setStatus('guest');
        return;
      }
      setStatus('authed');
      if (data.name) {
        setName(data.name);
        spaceRef.current = data.name;
        void setLastSpace(data.name);
      }
      if (flushed) {
        setExpenses(prev => {
          const merged = sortByDate(backfillThumbs(data.expenses ?? [], prev));
          if (spaceRef.current) void writeCache(spaceRef.current, merged);
          return merged;
        });
      }
      const b = data.budget ?? null;
      setBudget(b);
      if (spaceRef.current) void writeBudgetCache(spaceRef.current, b);
    } catch {
      setOnline(false);
    } finally {
      setSyncing(false);
    }
  }, [flushQueue, pending]);

  // Bootstrap: load token + cache for instant paint, then refresh from network.
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await loadToken();
      try {
        const raw = await AsyncStorage.getItem(QUEUE_KEY);
        if (raw && alive) setPending(JSON.parse(raw));
      } catch {
        /* ignore */
      }
      const last = await getLastSpace();
      if (last && token) {
        spaceRef.current = last;
        await loadSettings(last); // warm the sync cache before providers mount
        const [cached, cachedBudget] = await Promise.all([
          readCache(last),
          readBudgetCache(last),
        ]);
        if (alive && cached.length) {
          setName(last);
          setExpenses(sortByDate(cached));
          setBudget(cachedBudget);
          setStatus('authed'); // optimistic; refresh() confirms
        }
      }
      if (!token) {
        if (alive) setStatus('guest');
        return;
      }
      await refresh();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (n: string, passphrase: string) => {
      const data = await api.login(n, passphrase);
      setName(data.name);
      spaceRef.current = data.name;
      await setLastSpace(data.name);
      await loadSettings(data.name);
      setStatus('authed');
      await refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (n: string, passphrase: string) => {
      const data = await api.register(n, passphrase);
      setName(data.name);
      spaceRef.current = data.name;
      await setLastSpace(data.name);
      await loadSettings(data.name);
      setStatus('authed');
      await refresh();
      return { recoveryCode: data.recoveryCode };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.logout();
    await setLastSpace(null);
    await persistQueue([]);
    setStatus('guest');
    setName('');
    setExpenses([]);
    setBudget(null);
    spaceRef.current = '';
  }, [persistQueue]);

  const addExpense = useCallback(
    async (draft: ExpenseDraft) => {
      const tempId = uid();
      const optimistic = draftToExpense(draft, tempId);
      const next = sortByDate([optimistic, ...expenses]);
      setExpenses(next);
      if (spaceRef.current) void writeCache(spaceRef.current, next);
      try {
        const { expense } = await api.createExpense(draft);
        setExpenses(prev => {
          const merged = sortByDate(
            prev.map(e => (e.id === tempId ? keepThumb(expense, optimistic.thumbnail) : e)),
          );
          if (spaceRef.current) void writeCache(spaceRef.current, merged);
          return merged;
        });
        setOnline(true);
      } catch {
        setOnline(false);
        await persistQueue([...pending, { kind: 'create', tempId, draft }]);
      }
    },
    [expenses, pending, persistQueue],
  );

  const editExpense = useCallback(
    async (id: string, draft: ExpenseDraft) => {
      const next = sortByDate(
        expenses.map(e => (e.id === id ? { ...draftToExpense(draft, id), createdAt: e.createdAt } : e)),
      );
      setExpenses(next);
      if (spaceRef.current) void writeCache(spaceRef.current, next);
      if (id.startsWith('local-')) {
        // still-unsynced create: rewrite its queued draft
        await persistQueue(
          pending.map(op =>
            op.kind === 'create' && op.tempId === id ? { ...op, draft } : op,
          ),
        );
        return;
      }
      try {
        const { expense } = await api.updateExpense(id, draft);
        setExpenses(prev => {
          const merged = sortByDate(
            prev.map(e => (e.id === id ? keepThumb(expense, draft.thumbnail ?? null) : e)),
          );
          if (spaceRef.current) void writeCache(spaceRef.current, merged);
          return merged;
        });
        setOnline(true);
      } catch {
        setOnline(false);
        await persistQueue([...pending, { kind: 'update', id, draft }]);
      }
    },
    [expenses, pending, persistQueue],
  );

  const removeExpense = useCallback(
    async (id: string) => {
      const next = expenses.filter(e => e.id !== id);
      setExpenses(next);
      if (spaceRef.current) void writeCache(spaceRef.current, next);
      if (id.startsWith('local-')) {
        await persistQueue(pending.filter(op => !('tempId' in op && op.tempId === id)));
        return;
      }
      try {
        await api.deleteExpense(id);
        setOnline(true);
      } catch {
        setOnline(false);
        await persistQueue([...pending, { kind: 'delete', id }]);
      }
    },
    [expenses, pending, persistQueue],
  );

  const saveBudget = useCallback(async (b: number | null) => {
    setBudget(b);
    if (spaceRef.current) void writeBudgetCache(spaceRef.current, b);
    try {
      await api.setBudget(b);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  const value = useMemo<Store>(
    () => ({
      status,
      name,
      expenses,
      budget,
      online,
      syncing,
      pendingCount: pending.length,
      login,
      register,
      logout,
      refresh,
      addExpense,
      editExpense,
      removeExpense,
      saveBudget,
    }),
    [
      status, name, expenses, budget, online, syncing, pending.length,
      login, register, logout, refresh, addExpense, editExpense, removeExpense, saveBudget,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
