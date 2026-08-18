import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, clearSession } from "@/lib/auth";
import { EXPENSE_LIST_SELECT } from "@/lib/expenseSelect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-shot startup endpoint: returns auth state AND the expense list in a single
// request. This halves the app's initial latency versus calling /api/auth/me
// and /api/expenses separately (one round trip + one cold start instead of two),
// and it fetches the ledger and its expenses in a single database query.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  // Fetch the ledger + its expenses WITHOUT the heavy base64 thumbnails (see
  // EXPENSE_LIST_SELECT), alongside a tiny id-only query of which rows have a
  // bill image, so the startup payload stays small even for spaces with many
  // scanned receipts. The client re-attaches previews from its cache and lazily
  // fetches any it doesn't have.
  const [ledger, withThumbs] = await Promise.all([
    prisma.ledger.findUnique({
      where: { id: session.ledgerId },
      select: {
        id: true,
        name: true,
        monthlyBudget: true,
        expenses: { orderBy: { date: "desc" }, select: EXPENSE_LIST_SELECT },
      },
    }),
    prisma.expense.findMany({
      where: { ledgerId: session.ledgerId, thumbnail: { not: null } },
      select: { id: true },
    }),
  ]);

  // Stale cookie (e.g. ledger deleted): drop it and fall back to guest.
  if (!ledger) {
    await clearSession();
    return NextResponse.json({ authenticated: false });
  }

  const thumbIds = new Set(withThumbs.map((e) => e.id));
  const expenses = ledger.expenses.map((e) => ({
    ...e,
    hasThumbnail: thumbIds.has(e.id),
  }));

  return NextResponse.json({
    authenticated: true,
    name: ledger.name,
    budget: ledger.monthlyBudget ?? null,
    expenses,
  });
}
