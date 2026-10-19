import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validation";
import { createSession } from "@/lib/auth";
import { generateRecoveryCode, normalizeCode } from "@/lib/recovery";
import { dbUnavailable } from "@/lib/dbError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { name, passphrase } = parsed.data;
  const nameKey = name.toLowerCase();

  let existing: Awaited<ReturnType<typeof prisma.ledger.findUnique>>;
  try {
    existing = await prisma.ledger.findUnique({ where: { nameKey } });
  } catch (err) {
    return dbUnavailable("register", err);
  }
  if (existing) {
    return NextResponse.json(
      {
        error:
          "That space name is already taken. Pick another name, or unlock it with its passphrase.",
      },
      { status: 409 }
    );
  }

  const passHash = await bcrypt.hash(passphrase, 12);

  // One-time recovery code — shown once now, stored only as a hash. Lets the
  // owner reset their own passphrase later without an admin.
  const recoveryCode = generateRecoveryCode();
  const recoveryHash = await bcrypt.hash(normalizeCode(recoveryCode), 12);

  let ledger: Awaited<ReturnType<typeof prisma.ledger.create>>;
  try {
    ledger = await prisma.ledger.create({
      data: { name, nameKey, passHash, recoveryHash },
    });
  } catch (err) {
    // Lost a race with another signup for the same name.
    if ((err as { code?: unknown })?.code === "P2002") {
      return NextResponse.json(
        { error: "That space name is already taken. Pick another name, or unlock it with its passphrase." },
        { status: 409 }
      );
    }
    return dbUnavailable("register", err);
  }

  // Token is returned for native clients (Bearer auth); the web app ignores it
  // and relies on the HttpOnly cookie set by createSession.
  let token: string;
  try {
    token = await createSession({ ledgerId: ledger.id, name: ledger.name });
  } catch (err) {
    return dbUnavailable("register", err);
  }
  return NextResponse.json(
    { name: ledger.name, recoveryCode, token },
    { status: 201 }
  );
}
