import type { Expense, ExpenseDraft } from "./types";
import { apiFetch, setToken } from "./http";
import { isNativeApp } from "./platform";

// Error that carries the HTTP status so callers (e.g. the offline queue) can
// tell a transient failure (offline / 5xx) from a permanent one (4xx bad
// payload) and decide whether retrying could ever succeed.
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? "Something went wrong",
      res.status
    );
  }
  return data as T;
}

// After a successful auth call the server includes the session JWT. Only the
// native app persists it (Bearer auth); the web app ignores it and keeps using
// the HttpOnly cookie.
function rememberToken(token?: string) {
  if (isNativeApp() && token) setToken(token);
}

export const api = {
  async me() {
    const res = await apiFetch("/api/auth/me", { cache: "no-store" });
    return handle<{ authenticated: boolean; name?: string }>(res);
  },

  // Auth state + budget + expenses in a single round trip (used on app startup).
  async bootstrap() {
    const res = await apiFetch("/api/bootstrap", { cache: "no-store" });
    return handle<{
      authenticated: boolean;
      name?: string;
      budget?: number | null;
      expenses?: Expense[];
    }>(res);
  },

  async getBudget() {
    const res = await apiFetch("/api/budget", { cache: "no-store" });
    return handle<{ budget: number | null }>(res);
  },

  async setBudget(budget: number | null) {
    const res = await apiFetch("/api/budget", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget }),
    });
    return handle<{ budget: number | null }>(res);
  },

  async getSettings() {
    const res = await apiFetch("/api/settings", { cache: "no-store" });
    return handle<{ settings: Record<string, unknown> }>(res);
  },

  async patchSettings(patch: Record<string, unknown>) {
    const res = await apiFetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return handle<{ settings: Record<string, unknown> }>(res);
  },

  async register(name: string, passphrase: string) {
    const res = await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, passphrase }),
    });
    const data = await handle<{
      name: string;
      recoveryCode: string;
      token?: string;
    }>(res);
    rememberToken(data.token);
    return data;
  },

  // Self-service reset using the recovery code shown at signup. Returns a fresh
  // recovery code (the old one is single-use).
  async recover(name: string, recoveryCode: string, passphrase: string) {
    const res = await apiFetch("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, recoveryCode, passphrase }),
    });
    return handle<{ name: string; recoveryCode: string }>(res);
  },

  // Ask an admin to approve a reset. Returns a ticket code to check status with.
  async requestReset(
    name: string,
    passphrase: string,
    questionnaire: Record<string, string>
  ) {
    const res = await apiFetch("/api/auth/reset-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, passphrase, questionnaire }),
    });
    return handle<{ ticket: string }>(res);
  },

  // "Find my space" helper: search by name prefix (>=4 chars) and/or passphrase.
  async findSpace(query: string, passphrase?: string) {
    const res = await apiFetch("/api/auth/find-space", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, passphrase }),
    });
    return handle<{ matches: string[] }>(res);
  },

  async resetStatus(name: string, ticket: string) {
    const res = await apiFetch("/api/auth/reset-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ticket }),
    });
    return handle<{ status: "pending" | "approved" | "rejected" | "notfound"; resolvedAt?: string | null }>(res);
  },

  async login(name: string, passphrase: string) {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, passphrase }),
    });
    const data = await handle<{ name: string; token?: string }>(res);
    rememberToken(data.token);
    return data;
  },

  async logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Native: drop the stored Bearer token so logout is deterministic (no
      // reliance on the WebView flushing a cleared cookie).
      setToken(null);
    }
  },

  async listExpenses() {
    const res = await apiFetch("/api/expenses", { cache: "no-store" });
    return handle<{ expenses: Expense[] }>(res);
  },

  async createExpense(draft: ExpenseDraft) {
    const res = await apiFetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    return handle<{ expense: Expense }>(res);
  },

  async updateExpense(id: string, draft: ExpenseDraft) {
    const res = await apiFetch(`/api/expenses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    return handle<{ expense: Expense }>(res);
  },

  async deleteExpense(id: string) {
    const res = await apiFetch(`/api/expenses/${id}`, { method: "DELETE" });
    return handle<{ ok: boolean }>(res);
  },
};
