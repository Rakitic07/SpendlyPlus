import { API_BASE } from '../config';
import type { Expense, ExpenseDraft } from './types';
import { getTokenSync, setToken } from './storage';

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = /^https?:\/\//.test(path) ? path : API_BASE + path;
  const headers = new Headers(init.headers);
  const token = getTokenSync();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers, credentials: 'omit' });
}

// Carries the HTTP status so the offline queue can tell a transient failure
// (offline / 5xx) from a permanent one (4xx bad payload) that will never
// succeed on retry.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? 'Something went wrong',
      res.status,
    );
  }
  return data as T;
}

export const api = {
  async bootstrap() {
    const res = await apiFetch('/api/bootstrap');
    return handle<{
      authenticated: boolean;
      name?: string;
      budget?: number | null;
      expenses?: Expense[];
    }>(res);
  },

  async me() {
    const res = await apiFetch('/api/auth/me');
    return handle<{ authenticated: boolean; name?: string }>(res);
  },

  async getBudget() {
    const res = await apiFetch('/api/budget');
    return handle<{ budget: number | null }>(res);
  },

  async setBudget(budget: number | null) {
    const res = await apiFetch('/api/budget', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget }),
    });
    return handle<{ budget: number | null }>(res);
  },

  async getSettings() {
    const res = await apiFetch('/api/settings');
    return handle<{ settings: Record<string, unknown> }>(res);
  },

  async patchSettings(patch: Record<string, unknown>) {
    const res = await apiFetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return handle<{ settings: Record<string, unknown> }>(res);
  },

  async register(name: string, passphrase: string) {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, passphrase }),
    });
    const data = await handle<{ name: string; recoveryCode: string; token?: string }>(res);
    if (data.token) await setToken(data.token);
    return data;
  },

  async recover(name: string, recoveryCode: string, passphrase: string) {
    const res = await apiFetch('/api/auth/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, recoveryCode, passphrase }),
    });
    return handle<{ name: string; recoveryCode: string }>(res);
  },

  async findSpace(query: string, passphrase?: string) {
    const res = await apiFetch('/api/auth/find-space', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, passphrase }),
    });
    return handle<{ matches: string[] }>(res);
  },

  // Ask an admin to approve a reset. Returns a ticket code to check status with.
  async requestReset(
    name: string,
    passphrase: string,
    questionnaire: Record<string, string>,
  ) {
    const res = await apiFetch('/api/auth/reset-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, passphrase, questionnaire }),
    });
    return handle<{ ticket: string }>(res);
  },

  async resetStatus(name: string, ticket: string) {
    const res = await apiFetch('/api/auth/reset-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ticket }),
    });
    return handle<{
      status: 'pending' | 'approved' | 'rejected' | 'notfound';
      resolvedAt?: string | null;
    }>(res);
  },

  async login(name: string, passphrase: string) {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, passphrase }),
    });
    const data = await handle<{ name: string; token?: string }>(res);
    if (data.token) await setToken(data.token);
    return data;
  },

  async logout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      await setToken(null);
    }
  },

  async listExpenses() {
    const res = await apiFetch('/api/expenses');
    return handle<{ expenses: Expense[] }>(res);
  },

  async createExpense(draft: ExpenseDraft) {
    const res = await apiFetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    return handle<{ expense: Expense }>(res);
  },

  async updateExpense(id: string, draft: ExpenseDraft) {
    const res = await apiFetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    return handle<{ expense: Expense }>(res);
  },

  async deleteExpense(id: string) {
    const res = await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    return handle<{ ok: boolean }>(res);
  },

  // Lazily fetch one bill's thumbnail. The list payload omits thumbnails to stay
  // small; this pulls a single preview on demand (e.g. a receipt scanned on
  // another device that this phone hasn't cached).
  async getThumbnail(id: string) {
    const res = await apiFetch(`/api/expenses/${id}`);
    return handle<{ thumbnail: string | null }>(res);
  },

  // ── Admin (owner-only) ────────────────────────────────────────────────
  // The admin endpoints authenticate with DATABASE_URL + AUTH_SECRET posted in
  // the body (NOT the bearer token), and are read-only aside from reset actions.
  // Creds are held only in memory for the session and never persisted.
  async adminSection<T>(
    creds: { databaseUrl: string; authSecret: string },
    section: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await apiFetch('/api/admin/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...creds, section, ...extra }),
    });
    return handle<T>(res);
  },

  async adminReset(
    creds: { databaseUrl: string; authSecret: string },
    requestId: string,
    action: 'approve' | 'reject',
  ) {
    const res = await apiFetch('/api/admin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...creds, requestId, action }),
    });
    return handle<{ ok: boolean }>(res);
  },
};
