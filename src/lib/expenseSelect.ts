import type { Prisma } from "@prisma/client";

/*
 * Scalar fields returned in expense LIST payloads (bootstrap + GET /api/expenses).
 *
 * It deliberately EXCLUDES the base64 `thumbnail` column: a single bill preview
 * is 50–100KB, so a space with a few dozen receipts would otherwise ship several
 * megabytes of JSON on every app open — the biggest server-side cause of slow
 * loads and high memory on phones (transfer + JSON.parse + retained strings).
 *
 * Thumbnails are re-attached client-side from the offline cache (same-device),
 * and fetched lazily one row at a time via GET /api/expenses/[id] only when a
 * bill is actually opened (cross-device). The list carries a cheap `hasThumbnail`
 * boolean so the UI knows a preview exists without downloading it.
 */
export const EXPENSE_LIST_SELECT = {
  id: true,
  title: true,
  category: true,
  amount: true,
  paidBy: true,
  date: true,
  notes: true,
  paymentMode: true,
  paymentDetail: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ExpenseSelect;
