import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveLedger } from "@/lib/auth";
import { expenseSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Lazily fetch a single bill's thumbnail. Kept out of the list/bootstrap payloads
// (those exclude the heavy base64 via EXPENSE_LIST_SELECT); the client calls this
// only when a bill is actually opened on a device that doesn't already have the
// preview cached — e.g. a receipt added on another device.
export async function GET(_req: Request, { params }: Params) {
  const session = await getActiveLedger();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const expense = await prisma.expense.findFirst({
    where: { id, ledgerId: session.ledgerId },
    select: { thumbnail: true },
  });
  if (!expense) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ thumbnail: expense.thumbnail ?? null });
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getActiveLedger();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

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

  // Scope the update to the current ledger to prevent editing others' rows.
  const existing = await prisma.expense.findFirst({
    where: { id, ledgerId: session.ledgerId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  const expense = await prisma.expense.update({
    where: { id: existing.id },
    data: {
      title,
      category,
      amount,
      paidBy,
      date: new Date(date),
      notes: notes ? notes : null,
      paymentMode: paymentMode ? paymentMode : null,
      paymentDetail: paymentDetail ? paymentDetail : null,
      // Thumbnails are omitted from the list payload, so an edit form may not
      // have the current image loaded (it's fetched lazily / from cache). Treat
      // an ABSENT thumbnail as "leave unchanged" so a quick save never wipes the
      // stored bill; a non-empty string replaces it, and an explicit "" clears it.
      ...(thumbnail === undefined ? {} : { thumbnail: thumbnail ? thumbnail : null }),
    },
  });

  return NextResponse.json({ expense });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getActiveLedger();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.expense.findFirst({
    where: { id, ledgerId: session.ledgerId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.expense.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
