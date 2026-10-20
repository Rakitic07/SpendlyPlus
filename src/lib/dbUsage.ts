import type { PrismaClient } from "@prisma/client";
import { waitUntil } from "@vercel/functions";

// Counts Prisma queries per UTC hour into the DbUsage table. Counts are kept in
// memory and written in one upsert per hour bucket, at most once a minute.
// Every flush runs right after a real query, while the database is already
// awake, so counting never wakes Neon or adds compute time on its own.

const FLUSH_EVERY_MS = 60_000;

const pending = new Map<number, number>();
let lastFlushAt = 0;
let flushing = false;
let disabledUntil = 0;

function hourStart(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

async function flush(client: PrismaClient): Promise<void> {
  if (flushing || !pending.size) return;
  flushing = true;
  lastFlushAt = Date.now();
  const batch = [...pending.entries()];
  pending.clear();
  try {
    for (const [hour, n] of batch) {
      const at = new Date(hour);
      await client.dbUsage.upsert({
        where: { hour: at },
        create: { hour: at, queries: n },
        update: { queries: { increment: n } },
      });
    }
  } catch (e) {
    for (const [hour, n] of batch) pending.set(hour, (pending.get(hour) ?? 0) + n);
    // Table missing (schema not pushed yet) or DB unreachable: back off.
    disabledUntil = Date.now() + 10 * 60_000;
    if ((e as { code?: string }).code !== "P2021") console.error("[dbUsage] flush failed", e);
  } finally {
    flushing = false;
  }
}

export function trackDbUsage(client: PrismaClient): void {
  client.$use(async (params, next) => {
    const result = await next(params);
    if (params.model === "DbUsage") return result;
    const hour = hourStart(Date.now());
    pending.set(hour, (pending.get(hour) ?? 0) + 1);
    const now = Date.now();
    if (!flushing && now >= disabledUntil && now - lastFlushAt >= FLUSH_EVERY_MS) {
      waitUntil(flush(client));
    }
    return result;
  });
}
