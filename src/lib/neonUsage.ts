// Neon compute usage for the current billing period, read from the Neon API.
// Calling the Neon API never wakes the database, so this is safe to poll even
// when the compute is suspended or the project is over its quota.

export type NeonUsage = {
  configured: boolean;
  error?: string;
  periodStart?: string;
  periodEnd?: string;
  cuHours?: number;
  activeHours?: number;
  limitCuHours: number;
  projectedCuHours?: number | null;
  compute?: {
    state: string;
    lastActive: string | null;
    minCu: number;
    maxCu: number;
  } | null;
};

const NEON_API = "https://console.neon.tech/api/v2";
let cache: { at: number; value: NeonUsage } | null = null;

async function neonGet<T>(path: string, key: string): Promise<T> {
  const r = await fetch(`${NEON_API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(r.status === 401 ? "Neon API key was rejected" : `Neon API returned ${r.status}`);
  return (await r.json()) as T;
}

export async function neonUsage(): Promise<NeonUsage> {
  const limit = Number(process.env.NEON_CU_HOURS_LIMIT);
  const limitCuHours = limit > 0 ? limit : 100;
  const key = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!key || !projectId) return { configured: false, limitCuHours };
  if (cache && Date.now() - cache.at < 60_000) return cache.value;

  const id = encodeURIComponent(projectId);
  try {
    const [{ project: p }, { endpoints }] = await Promise.all([
      neonGet<{
        project: {
          compute_time_seconds?: number;
          active_time_seconds?: number;
          consumption_period_start?: string;
          consumption_period_end?: string;
        };
      }>(`/projects/${id}`, key),
      neonGet<{
        endpoints: {
          type: string;
          current_state: string;
          last_active?: string;
          autoscaling_limit_min_cu: number;
          autoscaling_limit_max_cu: number;
        }[];
      }>(`/projects/${id}/endpoints`, key),
    ]);

    const cuHours = (p.compute_time_seconds ?? 0) / 3600;
    const start = p.consumption_period_start ? new Date(p.consumption_period_start) : null;
    let end = p.consumption_period_end ? new Date(p.consumption_period_end) : null;
    if (start && (!end || end.getTime() <= start.getTime() || end.getFullYear() < 2000)) {
      end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
    }
    let projectedCuHours: number | null = null;
    if (start && end) {
      const elapsed = (Date.now() - start.getTime()) / (end.getTime() - start.getTime());
      if (elapsed > 0.02) projectedCuHours = cuHours / Math.min(1, elapsed);
    }
    const rw = endpoints.find((e) => e.type === "read_write") ?? endpoints[0];

    const value: NeonUsage = {
      configured: true,
      periodStart: start?.toISOString(),
      periodEnd: end?.toISOString(),
      cuHours,
      activeHours: (p.active_time_seconds ?? 0) / 3600,
      limitCuHours,
      projectedCuHours,
      compute: rw
        ? {
            state: rw.current_state,
            lastActive: rw.last_active ?? null,
            minCu: rw.autoscaling_limit_min_cu,
            maxCu: rw.autoscaling_limit_max_cu,
          }
        : null,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    return { configured: true, limitCuHours, error: e instanceof Error ? e.message : "Neon API request failed" };
  }
}
