import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check that ALSO issues a trivial DB query. Point an external uptime
// pinger (e.g. cron-job.org / UptimeRobot) at this every ~3-4 min so the
// serverless function AND the Neon compute stay warm — this is what kills the
// multi-second "scale-to-zero" cold start users feel on the first load after
// the database has been idle.
export async function GET() {
  const t0 = Date.now();
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return NextResponse.json({
    ok: true,
    service: "spendly-plus",
    db,
    dbMs: Date.now() - t0,
    time: new Date().toISOString(),
  });
}
