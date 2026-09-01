import { z } from "zod";

export const authSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(40, "Name is too long"),
  passphrase: z
    .string()
    .min(6, "Passphrase must be at least 6 characters")
    .max(128, "Passphrase is too long"),
});

export const expenseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80),
  category: z.string().trim().min(1, "Category is required").max(40),
  amount: z
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than 0")
    .max(100_000_000, "Amount is too large"),
  paidBy: z
    .string()
    .trim()
    .min(1, "Paid By is required")
    .max(40)
    // Must be a name: at least one letter (digits allowed, but not digits-only).
    .refine((v) => /[a-zA-Z]/.test(v), "Paid by should include a name, not just numbers"),
  // ISO date string (YYYY-MM-DD) or full ISO datetime.
  date: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date"),
  notes: z.string().trim().max(280).optional().or(z.literal("")),
  // Optional payment info. Mode is constrained to the three known modes; detail
  // is a free-ish provider/bank label (or a custom "Other" value).
  paymentMode: z.enum(["Cash", "UPI", "Card"]).optional().or(z.literal("")),
  paymentDetail: z.string().trim().max(40).optional().or(z.literal("")),
  // Base64 JPEG data URL of a scanned-bill thumbnail (preview only). Hard-capped
  // so a full-resolution photo can never be smuggled into the DB. base64 grows
  // ~4/3, so ~700k chars ≈ 500KB of image bytes — the max thumbnail size. This
  // must stay >= the clients' THUMB_MAX_CHARS (scanBill.ts / scan.ts) so a
  // legitimately-generated thumbnail is never rejected on save.
  thumbnail: z
    .string()
    .max(700000, "Thumbnail too large")
    .optional()
    .or(z.literal("")),
});

const nameField = z.string().trim().min(2, "Name must be at least 2 characters").max(40, "Name is too long");
const passField = z
  .string()
  .min(6, "Passphrase must be at least 6 characters")
  .max(128, "Passphrase is too long");

// New spaces must use a longer, less-guessable name.
export const registerSchema = z.object({
  name: z.string().trim().min(6, "Space name must be at least 6 characters").max(40, "Name is too long"),
  passphrase: passField,
});

// "Find my space" helper: search by a name prefix (>=4 chars) and/or verify by
// passphrase. At least one usable signal is required.
export const findSpaceSchema = z
  .object({
    query: z.string().trim().max(40).optional().or(z.literal("")),
    passphrase: z.string().max(128).optional().or(z.literal("")),
  })
  .refine(
    (d) => (!!d.query && d.query.trim().length >= 4) || (!!d.passphrase && d.passphrase.length >= 4),
    { message: "Type at least 4 characters of the space name, or your full passphrase." }
  );

// Self-service reset with the recovery code shown at signup.
export const recoverSchema = z.object({
  name: nameField,
  recoveryCode: z.string().trim().min(4, "Recovery code is required").max(64),
  passphrase: passField,
});

// Owner-initiated, admin-approved reset. The owner proposes a new passphrase
// and supplies identifying answers the admin can verify against the real data.
export const resetRequestSchema = z.object({
  name: nameField,
  passphrase: passField,
  questionnaire: z.object({
    approxCreated: z.string().trim().max(120).optional().or(z.literal("")),
    recentExpense: z.string().trim().max(200).optional().or(z.literal("")),
    recentAmount: z.string().trim().max(60).optional().or(z.literal("")),
    payerName: z.string().trim().max(80).optional().or(z.literal("")),
    budget: z.string().trim().max(60).optional().or(z.literal("")),
    note: z.string().trim().max(500).optional().or(z.literal("")),
  }),
});

export const resetStatusSchema = z.object({
  name: nameField,
  ticket: z.string().trim().min(4, "Ticket code is required").max(64),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
export type AuthInput = z.infer<typeof authSchema>;
