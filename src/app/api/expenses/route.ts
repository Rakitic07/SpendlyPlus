import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveLedger } from "@/lib/auth";
import { expenseSchema } from "@/lib/validation";
import { EXPENSE_LIST_SELECT } from "@/lib/expenseSelect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getActiveLedger();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull the list WITHOUT the heavy base64 thumbnails, plus a tiny id-only query
  // for which rows have one, so the client can show a "has bill" hint and fetch
  // the actual image lazily. Keeps the list payload small (see EXPENSE_LIST_SELECT).
  const [rows, withThumbs] = await Promise.all([
    prisma.expense.findMany({
      where: { ledgerId: session.ledgerId },
      orderBy: { date: "desc" },
      select: EXPENSE_LIST_SELECT,
    }),
    prisma.expense.findMany({
      where: { ledgerId: session.ledgerId, thumbnail: { not: null } },
      select: { id: true },
    }),
  ]);
  const thumbIds = new Set(withThumbs.map((e) => e.id));
  const expenses = rows.map((e) => ({ ...e, hasThumbnail: thumbIds.has(e.id) }));

  return NextResponse.json({ expenses });
}

export async function POST(req: Request) {
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

  const parsed = expenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const {
    title,
    category,
    amount,
    paidBy,
    date,
    notes,
    paymentMode,
    paymentDetail,
    thumbnail,
  } = parsed.data;
  const expense = await prisma.expense.create({
    data: {
      ledgerId: session.ledgerId,
      title,
      category,
      amount,
      paidBy,
      date: new Date(date),
      notes: notes ? notes : null,
      paymentMode: paymentMode ? paymentMode : null,
      paymentDetail: paymentDetail ? paymentDetail : null,
      thumbnail: thumbnail ? thumbnail : null,
    },
  });

  return NextResponse.json({ expense }, { status: 201 });
}
