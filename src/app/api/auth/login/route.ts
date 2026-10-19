import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authSchema } from "@/lib/validation";
import { createSession } from "@/lib/auth";
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

  const parsed = authSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { name, passphrase } = parsed.data;
  const nameKey = name.toLowerCase();

  let ledger: Awaited<ReturnType<typeof prisma.ledger.findUnique>>;
  try {
    ledger = await prisma.ledger.findUnique({ where: { nameKey } });
  } catch (err) {
    // A DB/connection failure here (e.g. Neon pooler / PgBouncer hiccup) must not
    // surface as an opaque 500 that the UI renders as "Something went wrong" —
    // that looks like a wrong passphrase. Return a clear, retryable message that
    // also carries a compact, non-sensitive diagnostic (Prisma error code /
    // class) so a stuck connection can be told apart from a bad URL/credentials.
    return dbUnavailable("login", err);
  }

  // Constant-ish behaviour: always run a bcrypt compare to avoid leaking
  // whether the space exists via response timing, and return a generic error.
  const hash =
    ledger?.passHash ??
    "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7dQ6b3q6zJ8b3q6zJ8b3q6zJ8b3q6zC";
  const ok = await bcrypt.compare(passphrase, hash);

  if (!ledger || !ok) {
    return NextResponse.json(
      { error: "Incorrect space name or passphrase." },
      { status: 401 }
    );
  }

  // Token is returned for native clients (Bearer auth); the web app ignores it
  // and relies on the HttpOnly cookie set by createSession.
  try {
    const token = await createSession({ ledgerId: ledger.id, name: ledger.name });
    return NextResponse.json({ name: ledger.name, token });
  } catch (err) {
    console.error("login: session error", err);
    return NextResponse.json(
      { error: "Couldn't start your session. Please try again." },
      { status: 503 }
    );
  }
}
