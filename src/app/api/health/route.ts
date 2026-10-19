import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness check. By default it does NOT touch the database: an external
// uptime pinger hitting a DB-querying endpoint every few minutes keeps the
// Neon compute awake 24/7 and exhausts the free plan's monthly compute hours.
// Add `?db=1` for a one-off database check (returns 503 if unreachable).
export async function GET(req: Request) {
  const checkDb = new URL(req.url).searchParams.get("db") === "1";
  const time = new Date().toISOString();

  if (!checkDb) {
    return NextResponse.json({ ok: true, service: "spendly-plus", time });
  }

  const t0 = Date.now();
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return NextResponse.json(
    { ok: db, service: "spendly-plus", db, dbMs: Date.now() - t0, time },
    { status: db ? 200 : 503 }
  );
}
