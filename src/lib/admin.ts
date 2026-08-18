import { createHash, timingSafeEqual } from "crypto";
import { Pool } from "pg";

// Length-independent, timing-safe comparison (hash both to a fixed size first,
// otherwise timingSafeEqual throws on differing lengths and leaks length info).
export function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type GateResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string };

// A connection string's *identity*: protocol, credentials, host, port and
// database — ignoring query params (pgbouncer, sslmode, connection_limit,
// channel_binding, …) and a trailing slash. Two URLs that point at the same DB
// with the same credentials but different pooling/SSL flags are treated as
// equal, so tweaking those flags (e.g. adding `?pgbouncer=true`) doesn't lock
// the owner out of the admin panel while still preventing SSRF to other hosts.
function dbIdentity(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const port = u.port || "5432";
    return [
      u.protocol.toLowerCase(),
      u.username,
      u.password,
      u.hostname.toLowerCase(),
      port,
      u.pathname.replace(/\/+$/, ""),
    ].join("|");
  } catch {
    return null;
  }
}

// Whether the pasted URL matches the server's, comparing by connection identity
// when both parse (query-param tolerant) and falling back to an exact,
// timing-safe string compare otherwise.
function dbUrlMatches(pasted: string, serverUrl: string): boolean {
  const a = dbIdentity(pasted);
  const b = dbIdentity(serverUrl);
  if (a && b) return secretsMatch(a, b);
  return secretsMatch(pasted.trim(), serverUrl.trim());
}

// Validates the two admin secrets against the server env and returns the DB URL
// to connect with. The AUTH_SECRET is the real gate; the DATABASE_URL must
// match the server's own (defence in depth against SSRF to arbitrary hosts).
export function adminGate(databaseUrl: string, authSecret: string): GateResult {
  const serverSecret = process.env.AUTH_SECRET;
  if (!serverSecret) {
    return { ok: false, status: 500, error: "Server is not configured for admin access." };
  }
  if (!secretsMatch(authSecret, serverSecret)) {
    return { ok: false, status: 401, error: "Invalid credentials." };
  }
  const url = databaseUrl.trim();
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return { ok: false, status: 400, error: "DATABASE_URL must be a valid PostgreSQL connection string." };
  }
  const envDbUrl = process.env.DATABASE_URL;
  if (envDbUrl && !dbUrlMatches(url, envDbUrl)) {
    return { ok: false, status: 401, error: "Invalid credentials." };
  }
  return { ok: true, url };
}

// Strip Prisma-only query params (`pgbouncer`, `connection_limit`) that the raw
// `pg` driver doesn't understand, so a pooled DATABASE_URL still connects fine
// from the admin panel.
function sanitizeForPg(url: string): string {
  try {
    const u = new URL(url.trim());
    u.searchParams.delete("pgbouncer");
    u.searchParams.delete("connection_limit");
    return u.toString();
  } catch {
    return url;
  }
}

export function makeAdminPool(url: string): Pool {
  return new Pool({
    connectionString: sanitizeForPg(url),
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 8000,
    statement_timeout: 8000,
  });
}
