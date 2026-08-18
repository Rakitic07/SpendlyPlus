import os from "os";
import { NextResponse } from "next/server";
import { z } from "zod";
import { adminGate, makeAdminPool } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The admin dashboard is gated by two shared secrets that only the app owner
// knows: the AUTH_SECRET (verified against the server's env) and the
// DATABASE_URL (used to connect). Details are fetched section-by-section, on
// demand, so the initial unlock stays fast and heavy aggregates only run when
// the owner actually opens that tab.

const PAGE_SIZE = 5;

const bodySchema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),
  authSecret: z.string().min(1, "AUTH_SECRET is required"),
  section: z.enum([
    "overview",
    "storage",
    "ocr",
    "system",
    "spaces",
    "categories",
    "payers",
    "activity",
    "resets",
  ]),
  page: z.number().int().min(0).max(100_000).optional(),
  bucket: z.enum(["day", "week", "month", "year"]).optional(),
  // When true, "overview" returns only the cheap totals and skips the heavy
  // storage/OCR/system probes. The web panel uses this so the initial unlock is
  // light and each detail panel fetches its own section lazily on expand.
  light: z.boolean().optional(),
});

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// Fixed, allow-listed bucket config — these strings are inlined into SQL, so
// they must never come from free-form user input (they don't: zod enum above).
const BUCKET = {
  day: { unit: "day", windows: 14, fmt: "DD Mon" },
  week: { unit: "week", windows: 12, fmt: "DD Mon" },
  month: { unit: "month", windows: 12, fmt: "Mon YY" },
  year: { unit: "year", windows: 5, fmt: "YYYY" },
} as const;

type StorageStats = {
  dbBytes: number;
  expenseTableBytes: number;
  limitBytes: number | null;
  attachments: { count: number; totalBytes: number; avgBytes: number; maxBytes: number };
  // Per-table breakdown (public schema, incl. indexes/TOAST) so we can show
  // where the DB size actually goes. Anything not covered by these tables is
  // Postgres system catalogs / WAL and shown as the remainder client-side.
  tables: { name: string; bytes: number }[];
};

// Reports total DB size + the space taken by bill thumbnails. Optionally, set
// ADMIN_STORAGE_LIMIT_MB to your hosting plan's cap so "storage left" can be
// shown; otherwise the limit is reported as unknown (Postgres has no innate
// per-database cap). Returns null if the queries aren't permitted/available.
async function storageStats(
  pool: import("pg").Pool
): Promise<StorageStats | null> {
  try {
    const [db, att, tbl] = await Promise.all([
      pool.query(
        `SELECT pg_database_size(current_database())::float   AS db_bytes,
                pg_total_relation_size('"Expense"')::float     AS expense_bytes`
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE thumbnail IS NOT NULL)::int AS count,
                COALESCE(SUM(octet_length(thumbnail)), 0)::float   AS total,
                COALESCE(AVG(octet_length(thumbnail)), 0)::float   AS avg,
                COALESCE(MAX(octet_length(thumbnail)), 0)::float   AS max
           FROM "Expense"`
      ),
      // Size of every ordinary table in the public schema (table + indexes +
      // TOAST) — shows exactly where the used space sits.
      pool.query(
        `SELECT c.relname AS name,
                pg_total_relation_size(c.oid)::float AS bytes
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY bytes DESC`
      ),
    ]);
    const limitMb = Number(process.env.ADMIN_STORAGE_LIMIT_MB ?? "");
    return {
      dbBytes: Number(db.rows[0]?.db_bytes ?? 0),
      expenseTableBytes: Number(db.rows[0]?.expense_bytes ?? 0),
      limitBytes: Number.isFinite(limitMb) && limitMb > 0 ? limitMb * 1024 * 1024 : null,
      attachments: {
        count: Number(att.rows[0]?.count ?? 0),
        totalBytes: Number(att.rows[0]?.total ?? 0),
        avgBytes: Number(att.rows[0]?.avg ?? 0),
        maxBytes: Number(att.rows[0]?.max ?? 0),
      },
      tables: tbl.rows.map((r) => ({ name: String(r.name), bytes: Number(r.bytes ?? 0) })),
    };
  } catch {
    return null;
  }
}

// OCR.space free-plan caps (see https://ocr.space/ocrapi). There is no hourly
// limit — quotas are per-month (conversions) and a per-day/per-IP rate limit.
const OCR_MONTHLY_LIMIT = 25000; // Engine 1 + Engine 2 combined
const OCR_ENGINE3_MONTHLY_LIMIT = 2500;
const OCR_DAILY_RATE_LIMIT = 500; // requests/day per IP

type OcrUsage = {
  configured: boolean;
  countTotal: number;
  countEngine1: number;
  countEngine2: number;
  countEngine3: number;
  monthlyLimit: number;
  engine3MonthlyLimit: number;
  dailyRateLimit: number;
};

// Reads the OCR.space key's conversion usage from its myAPI endpoint so the
// owner can see how much of the monthly quota is left. The key never leaves the
// server. Returns configured:false when no key is set; counts null-safe on error.
async function ocrUsage(): Promise<OcrUsage> {
  const base: OcrUsage = {
    configured: false,
    countTotal: 0,
    countEngine1: 0,
    countEngine2: 0,
    countEngine3: 0,
    monthlyLimit: OCR_MONTHLY_LIMIT,
    engine3MonthlyLimit: OCR_ENGINE3_MONTHLY_LIMIT,
    dailyRateLimit: OCR_DAILY_RATE_LIMIT,
  };
  const key = process.env.OCRSPACE_API_KEY;
  if (!key) return base;
  base.configured = true;
  try {
    const res = await fetch("https://myapi.ocr.space/conversions", {
      method: "POST",
      headers: { apikey: key },
      body: "", // empty body → Content-Length: 0 (endpoint requires it)
    });
    if (!res.ok) return base;
    const d = (await res.json()) as {
      count_total?: number;
      count_engine1?: number;
      count_engine2?: number;
      count_engine3?: number;
    };
    base.countTotal = Number(d.count_total ?? 0);
    base.countEngine1 = Number(d.count_engine1 ?? 0);
    base.countEngine2 = Number(d.count_engine2 ?? 0);
    base.countEngine3 = Number(d.count_engine3 ?? 0);
    return base;
  } catch {
    return base;
  }
}

// -- Host runtime metrics ---------------------------------------------------

type Meter = { usedBytes: number; totalBytes: number; usedPct: number };
type SystemStats = {
  cpu: { cores: number; load1: number; loadPct: number | null };
  memory: Meter & { basis: "process" | "host" };
  disk: Meter | null;
  uptimeSec: number;
  node: string;
  region: string | null;
};

// Free space of the *writable* filesystem. We probe os.tmpdir() (the ephemeral
// scratch dir) rather than "/", because on serverless (Vercel/Lambda) the root
// image is a packed, read-only filesystem that always reports ~100% used —
// measuring it would be a meaningless "disk full" false alarm. The temp dir is
// the only place the app can write, so its headroom is what actually matters.
// `statfs` exists on Node 18.15+; return null (UI shows "n/a") on failure.
async function diskStats(): Promise<Meter | null> {
  try {
    const fs = (await import("node:fs/promises")) as unknown as {
      statfs?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
    };
    if (!fs.statfs) return null;
    const s = await fs.statfs(os.tmpdir());
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize; // available to unprivileged processes
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    if (!(totalBytes > 0)) return null;
    return { usedBytes, totalBytes, usedPct: Math.min(100, (usedBytes / totalBytes) * 100) };
  } catch {
    return null;
  }
}

// Live CPU / memory / disk of the deployment host, read fresh on each request.
// On Vercel (AWS Lambda) the meaningful memory ceiling is the function's
// configured size, so we measure process RSS against it; elsewhere we fall back
// to OS total/free. loadavg is 0 on serverless, reported as null → "n/a".
async function systemStats(): Promise<SystemStats> {
  const cpus = os.cpus() ?? [];
  const cores = cpus.length || 1;
  const loadArr = os.loadavg();
  const load1 = Array.isArray(loadArr) ? loadArr[0] : 0;
  const loadPct = load1 > 0 ? Math.min(100, (load1 / cores) * 100) : null;

  const rss = process.memoryUsage().rss;
  const lambdaMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? "");
  let memory: SystemStats["memory"];
  if (Number.isFinite(lambdaMb) && lambdaMb > 0) {
    const totalBytes = lambdaMb * 1024 * 1024;
    memory = {
      basis: "process",
      usedBytes: rss,
      totalBytes,
      usedPct: Math.min(100, (rss / totalBytes) * 100),
    };
  } else {
    const totalBytes = os.totalmem();
    const usedBytes = Math.max(0, totalBytes - os.freemem());
    memory = {
      basis: "host",
      usedBytes,
      totalBytes,
      usedPct: totalBytes > 0 ? Math.min(100, (usedBytes / totalBytes) * 100) : 0,
    };
  }

  return {
    cpu: { cores, load1, loadPct },
    memory,
    disk: await diskStats(),
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    region: process.env.VERCEL_REGION ?? process.env.AWS_REGION ?? null,
  };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, 400);
  }

  const { databaseUrl, authSecret, section } = parsed.data;
  const page = parsed.data.page ?? 0;
  const bucket = parsed.data.bucket ?? "week";
  const light = parsed.data.light ?? false;

  const gate = adminGate(databaseUrl, authSecret);
  if (!gate.ok) return json({ error: gate.error }, gate.status);

  const pool = makeAdminPool(gate.url);

  try {
    switch (section) {
      case "overview": {
        const [exp, led] = await Promise.all([
          pool.query(
            `SELECT COUNT(*)::int AS count,
                    COALESCE(SUM(amount), 0)::float AS total,
                    COALESCE(AVG(amount), 0)::float AS avg
               FROM "Expense"`
          ),
          pool.query(`SELECT COUNT(*)::int AS count FROM "Ledger"`),
        ]);
        const spaces = Number(led.rows[0]?.count ?? 0);
        const grandTotal = Number(exp.rows[0]?.total ?? 0);

        const totals = {
          spaces,
          expenses: Number(exp.rows[0]?.count ?? 0),
          grandTotal,
          avgExpense: Number(exp.rows[0]?.avg ?? 0),
          avgPerSpace: spaces ? grandTotal / spaces : 0,
        };

        // Light mode (web): only the cheap totals — the storage/OCR/system
        // panels are fetched lazily when the owner expands them. Full mode
        // (mobile, backward-compatible) still bundles everything in one call.
        if (light) return json({ totals });

        // Storage footprint — best-effort. pg_database_size needs connect
        // rights (fine for the app's own role) and octet_length(thumbnail)
        // needs the column to exist (older DBs won't have it yet). Either
        // failure just omits the panel rather than breaking the overview.
        const [storage, ocr, system] = await Promise.all([
          storageStats(pool),
          ocrUsage(),
          systemStats(),
        ]);

        return json({ totals, storage, ocr, system });
      }

      // Lazily-loaded detail panels for the web dashboard. Each returns only its
      // own slice so expanding a panel does the minimum work.
      case "storage":
        return json({ storage: await storageStats(pool) });

      case "ocr":
        return json({ ocr: await ocrUsage() });

      case "system":
        return json({ system: await systemStats() });

      case "spaces": {
        const [countRes, rowsRes] = await Promise.all([
          pool.query(`SELECT COUNT(*)::int AS total FROM "Ledger"`),
          pool.query(
            `SELECT l.id,
                    l.name,
                    l."monthlyBudget" AS budget,
                    l."createdAt"     AS created,
                    (SELECT COUNT(*) FROM "Expense" e WHERE e."ledgerId" = l.id)::int AS expense_count,
                    (SELECT COALESCE(SUM(amount), 0) FROM "Expense" e WHERE e."ledgerId" = l.id)::float AS total,
                    (SELECT MIN(date) FROM "Expense" e WHERE e."ledgerId" = l.id) AS first_date,
                    (SELECT MAX(date) FROM "Expense" e WHERE e."ledgerId" = l.id) AS last_date,
                    -- Bill attachments: how many, and the month span they cover
                    -- (used to derive an average per-month upload frequency).
                    (SELECT COUNT(*) FROM "Expense" e
                      WHERE e."ledgerId" = l.id AND e.thumbnail IS NOT NULL)::int AS attach_count,
                    (SELECT (date_part('year', age(MAX(e."createdAt"), MIN(e."createdAt"))) * 12
                             + date_part('month', age(MAX(e."createdAt"), MIN(e."createdAt"))) + 1)
                       FROM "Expense" e
                      WHERE e."ledgerId" = l.id AND e.thumbnail IS NOT NULL)::float AS attach_months
               FROM "Ledger" l
              ORDER BY l."createdAt" ASC
              LIMIT ${PAGE_SIZE} OFFSET $1`,
            [page * PAGE_SIZE]
          ),
        ]);
        return json({
          total: Number(countRes.rows[0]?.total ?? 0),
          page,
          pageSize: PAGE_SIZE,
          items: rowsRes.rows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            budget: r.budget === null ? null : Number(r.budget),
            createdAt: r.created,
            expenseCount: Number(r.expense_count),
            total: Number(r.total),
            firstDate: r.first_date,
            lastDate: r.last_date,
            attachCount: Number(r.attach_count ?? 0),
            attachMonths: Number(r.attach_months ?? 0),
          })),
        });
      }

      case "categories": {
        const [countRes, rowsRes] = await Promise.all([
          pool.query(`SELECT COUNT(DISTINCT category)::int AS total FROM "Expense"`),
          pool.query(
            `SELECT category,
                    COUNT(*)::int AS count,
                    COALESCE(SUM(amount), 0)::float AS total
               FROM "Expense"
              GROUP BY category
              ORDER BY total DESC
              LIMIT ${PAGE_SIZE} OFFSET $1`,
            [page * PAGE_SIZE]
          ),
        ]);
        return json({
          total: Number(countRes.rows[0]?.total ?? 0),
          page,
          pageSize: PAGE_SIZE,
          items: rowsRes.rows.map((r) => ({
            category: r.category as string,
            count: Number(r.count),
            total: Number(r.total),
          })),
        });
      }

      case "payers": {
        const [countRes, rowsRes] = await Promise.all([
          pool.query(`SELECT COUNT(DISTINCT "paidBy")::int AS total FROM "Expense"`),
          pool.query(
            `SELECT "paidBy" AS payer,
                    COUNT(*)::int AS count,
                    COALESCE(SUM(amount), 0)::float AS total
               FROM "Expense"
              GROUP BY "paidBy"
              ORDER BY total DESC
              LIMIT ${PAGE_SIZE} OFFSET $1`,
            [page * PAGE_SIZE]
          ),
        ]);
        return json({
          total: Number(countRes.rows[0]?.total ?? 0),
          page,
          pageSize: PAGE_SIZE,
          items: rowsRes.rows.map((r) => ({
            payer: (r.payer as string) || "—",
            count: Number(r.count),
            total: Number(r.total),
          })),
        });
      }

      case "activity": {
        const cfg = BUCKET[bucket];
        const [seriesRes, perfRes, activeRes] = await Promise.all([
          pool.query(
            `SELECT to_char(date_trunc('${cfg.unit}', "createdAt"), '${cfg.fmt}') AS period,
                    date_trunc('${cfg.unit}', "createdAt") AS bucket_start,
                    COUNT(*)::int AS count,
                    COALESCE(SUM(amount), 0)::float AS total
               FROM "Expense"
              WHERE "createdAt" >= date_trunc('${cfg.unit}', now()) - interval '${cfg.windows} ${cfg.unit}'
              GROUP BY 1, 2
              ORDER BY 2 ASC`
          ),
          pool.query(
            `SELECT
               COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('${cfg.unit}', now()))::int AS cur_count,
               COALESCE(SUM(amount) FILTER (WHERE "createdAt" >= date_trunc('${cfg.unit}', now())), 0)::float AS cur_total,
               COUNT(*) FILTER (
                 WHERE "createdAt" >= date_trunc('${cfg.unit}', now()) - interval '1 ${cfg.unit}'
                   AND "createdAt" <  date_trunc('${cfg.unit}', now())
               )::int AS prev_count,
               COALESCE(SUM(amount) FILTER (
                 WHERE "createdAt" >= date_trunc('${cfg.unit}', now()) - interval '1 ${cfg.unit}'
                   AND "createdAt" <  date_trunc('${cfg.unit}', now())
               ), 0)::float AS prev_total
             FROM "Expense"`
          ),
          pool.query(
            `SELECT l.name,
                    COUNT(e.id)::int AS inputs,
                    COALESCE(SUM(e.amount), 0)::float AS total
               FROM "Ledger" l
               JOIN "Expense" e ON e."ledgerId" = l.id
              WHERE e."createdAt" >= date_trunc('${cfg.unit}', now()) - interval '${cfg.windows} ${cfg.unit}'
              GROUP BY l.id, l.name
              ORDER BY inputs DESC
              LIMIT 5`
          ),
        ]);

        const p = perfRes.rows[0] ?? {};
        return json({
          bucket,
          series: seriesRes.rows.map((r) => ({
            period: r.period as string,
            count: Number(r.count),
            total: Number(r.total),
          })),
          performance: {
            curCount: Number(p.cur_count ?? 0),
            curTotal: Number(p.cur_total ?? 0),
            prevCount: Number(p.prev_count ?? 0),
            prevTotal: Number(p.prev_total ?? 0),
          },
          activeSpaces: activeRes.rows.map((r) => ({
            name: r.name as string,
            inputs: Number(r.inputs),
            total: Number(r.total),
          })),
        });
      }

      case "resets": {
        // Reset requests with the space's real data so the admin can verify the
        // owner's questionnaire before approving. Pending ones surface first.
        const [countRes, rowsRes] = await Promise.all([
          pool.query(`SELECT COUNT(*)::int AS total FROM "ResetRequest"`),
          pool.query(
            `SELECT r.id,
                    r.status,
                    r.questionnaire,
                    r."createdAt" AS requested_at,
                    r."resolvedAt" AS resolved_at,
                    l.name AS space_name,
                    l."createdAt" AS space_created,
                    l."monthlyBudget" AS budget,
                    (l."recoveryHash" IS NOT NULL) AS has_recovery,
                    (SELECT COUNT(*) FROM "Expense" e WHERE e."ledgerId" = l.id)::int AS expense_count,
                    (SELECT COALESCE(SUM(amount), 0) FROM "Expense" e WHERE e."ledgerId" = l.id)::float AS total,
                    (SELECT json_agg(x) FROM (
                       SELECT title, amount, "paidBy" AS payer, date
                         FROM "Expense" e WHERE e."ledgerId" = l.id
                        ORDER BY e."createdAt" DESC LIMIT 5
                     ) x) AS recent,
                    -- Distinct values used to auto-score the owner's answers.
                    (SELECT array_agg(p) FROM (SELECT DISTINCT lower("paidBy") p FROM "Expense" e WHERE e."ledgerId" = l.id LIMIT 200) s) AS payers,
                    (SELECT array_agg(t) FROM (SELECT DISTINCT lower(title) t FROM "Expense" e WHERE e."ledgerId" = l.id LIMIT 300) s) AS titles,
                    (SELECT array_agg(a) FROM (SELECT DISTINCT amount a FROM "Expense" e WHERE e."ledgerId" = l.id LIMIT 500) s) AS amounts
               FROM "ResetRequest" r
               JOIN "Ledger" l ON l.id = r."ledgerId"
              ORDER BY (r.status = 'pending') DESC, r."createdAt" DESC
              LIMIT ${PAGE_SIZE} OFFSET $1`,
            [page * PAGE_SIZE]
          ),
        ]);
        return json({
          total: Number(countRes.rows[0]?.total ?? 0),
          page,
          pageSize: PAGE_SIZE,
          items: rowsRes.rows.map((r) => ({
            id: r.id as string,
            status: r.status as string,
            spaceName: r.space_name as string,
            spaceCreated: r.space_created,
            requestedAt: r.requested_at,
            resolvedAt: r.resolved_at,
            hasRecovery: Boolean(r.has_recovery),
            expenseCount: Number(r.expense_count),
            total: Number(r.total),
            budget: r.budget === null ? null : Number(r.budget),
            questionnaire: r.questionnaire as string,
            recent: (r.recent ?? []) as { title: string; amount: number; payer: string; date: string }[],
            payers: (r.payers ?? []) as string[],
            titles: (r.titles ?? []) as string[],
            amounts: ((r.amounts ?? []) as (number | string)[]).map(Number),
          })),
        });
      }
    }
  } catch {
    return json({ error: "Could not query the database. Check the connection string." }, 502);
  } finally {
    await pool.end().catch(() => {});
  }
}
