import { NextResponse } from "next/server";

// A short, NON-SENSITIVE hint about why a DB call failed, for the auth banners.
// Only ever returns a Prisma error code (Pxxxx), the error class name, or a
// hand-picked token — never the raw message, which can contain the connection
// URL / credentials.
export function dbErrorHint(err: unknown): string {
  const e = err as { code?: unknown; errorCode?: unknown; name?: unknown; message?: unknown };
  const code = typeof e?.code === "string" ? e.code : typeof e?.errorCode === "string" ? e.errorCode : "";
  const msg = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  if (msg.includes("quota")) return "quota";
  if (msg.includes("prepared statement")) return "prepared-stmt: set pgbouncer=true";
  if (msg.includes("must start with the protocol")) return "bad-url: remove quotes from DATABASE_URL";
  if (msg.includes("timed out") || msg.includes("timeout")) return code || "timeout";
  if (code) return code; // e.g. P1001 (unreachable), P1000 (auth failed), P2024 (pool timeout)
  if (typeof e?.name === "string" && e.name) return e.name; // e.g. PrismaClientInitializationError
  return "unknown";
}

/** 503 response for a failed DB call; a user-facing message instead of an opaque 500. */
export function dbUnavailable(scope: string, err: unknown): NextResponse {
  console.error(`${scope}: database error`, err);
  const hint = dbErrorHint(err);
  const error =
    hint === "quota"
      ? "The database has hit its plan quota, so it's paused. Please try again later."
      : `Couldn't reach the database (${hint}). Please try again in a moment.`;
  return NextResponse.json({ error }, { status: 503 });
}
