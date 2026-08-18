import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveLedger } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-space UI preferences stored on the Ledger as a JSON blob so they sync
// across all of a user's devices (web, PWA, native). Every field is optional;
// clients fill any missing field from their own defaults, which keeps the two
// platforms (web has a few extra keys like `chartsCollapsed`) compatible.
//
// PATCH performs a server-side MERGE rather than a replace, so one platform
// updating its keys never wipes another platform's keys.
const settingsSchema = z
  .object({
    chartsCollapsed: z.boolean().optional(),
    defaultPeriod: z.enum(["day", "month", "year", "all"]).optional(),
    showThumbnails: z.boolean().optional(),
    confirmDelete: z.boolean().optional(),
    recentSuggestions: z.boolean().optional(),
    budgetAlerts: z.boolean().optional(),
    defaultPayer: z.string().max(60).optional(),
    haptics: z.boolean().optional(),
  })
  .strict();

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET() {
  const session = await getActiveLedger();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ledger = await prisma.ledger.findUnique({
    where: { id: session.ledgerId },
    select: { settings: true },
  });

  return NextResponse.json({ settings: asObject(ledger?.settings) });
}

export async function PATCH(req: Request) {
  const session = await getActiveLedger();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const ledger = await prisma.ledger.findUnique({
    where: { id: session.ledgerId },
    select: { settings: true },
  });

  const merged = { ...asObject(ledger?.settings), ...parsed.data };

  await prisma.ledger.update({
    where: { id: session.ledgerId },
    data: { settings: merged },
  });

  return NextResponse.json({ settings: merged });
}
