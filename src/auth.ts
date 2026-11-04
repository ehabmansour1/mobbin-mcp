import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COOKIE_CHUNK_SIZE, COOKIE_PREFIX, REFRESH_BUFFER_SECONDS, SUPABASE_KEY, SUPABASE_URL } from "./constants.js";

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type?: string;
  expires_in?: number;
  user?: { id?: string; email?: string } & Record<string, unknown>;
  [k: string]: unknown;
}

export const AUTH_DIR = path.join(os.homedir(), ".mobbin-mcp");
export const AUTH_FILE = path.join(AUTH_DIR, "auth.json");

/**
 * Parse whatever the user pasted into a Supabase session. Accepts:
 *  - a `document.cookie` / Cookie-header string ("a=b; sb-…-auth-token.0=…; …")
 *  - a cookie-export JSON array from a browser extension ([{name, value}, …])
 *  - a raw session JSON object ({access_token, refresh_token, …})
 */
export function parseSessionInput(raw: string): Session {
  const text = raw.trim();
  if (!text) throw new Error("Nothing was pasted.");

  let pairs: Array<[string, string]> = [];
  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Input looks like JSON but could not be parsed (was it cut off?).");
    }
    if (!Array.isArray(parsed) && parsed && typeof parsed === "object" && "access_token" in parsed) {
      return validateSession(parsed as Session);
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of list) {
      if (c && typeof c === "object" && "name" in c && "value" in c) pairs.push([String(c.name), String(c.value)]);
    }
  } else {
    pairs = text
      .replace(/^cookie:\s*/i, "")
      .split(/;\s*/)
      .map((p) => {
        const i = p.indexOf("=");
        return i < 0 ? null : ([p.slice(0, i).trim(), p.slice(i + 1).trim()] as [string, string]);
      })
      .filter((p): p is [string, string] => p !== null);
  }

  const chunks = pairs
    .map(([name, value]) => {
      if (name === COOKIE_PREFIX) return { idx: 0, value };
      const m = name.match(new RegExp(`^${COOKIE_PREFIX}\\.(\\d+)$`));
      return m ? { idx: Number(m[1]), value } : null;
    })
    .filter((c): c is { idx: number; value: string } => c !== null)
    .sort((a, b) => a.idx - b.idx);

  if (chunks.length === 0) {
    throw new Error(
      `No Mobbin session cookie found. Expected cookies named ${COOKIE_PREFIX}.0 / .1 — make sure you are logged in on mobbin.com when copying.`,
    );
  }

  let joined = chunks.map((c) => decodeURIComponent(c.value)).join("");
  if (joined.startsWith("base64-")) joined = Buffer.from(joined.slice(7), "base64url").toString("utf8");
  let session: Session;
  try {
    session = JSON.parse(joined);
  } catch {
    throw new Error("Found the session cookies but could not decode them (are both .0 and .1 included?).");
  }
  return validateSession(session);
}

function validateSession(s: Session): Session {
  if (!s.access_token || !s.refresh_token) throw new Error("Session is missing access_token / refresh_token.");
  if (!s.expires_at) {
    try {
      const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64url").toString("utf8"));
      s.expires_at = payload.exp;
    } catch {
      s.expires_at = 0;
    }
  }
  return s;
}

export function loadSession(): Session | null {
  const env = process.env.MOBBIN_AUTH_COOKIE;
  if (env) return parseSessionInput(env);
  if (!fs.existsSync(AUTH_FILE)) return null;
  return validateSession(JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")));
}

export function saveSession(s: Session): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** Holds the session, refreshes it before expiry, and builds the cookie header Mobbin expects. */
export class SessionManager {
  private refreshing: Promise<void> | null = null;

  constructor(
    private session: Session,
    private persist: boolean,
  ) {}

  get current(): Session {
    return this.session;
  }

  async cookieHeader(): Promise<string> {
    if (this.session.expires_at - REFRESH_BUFFER_SECONDS < Date.now() / 1000) await this.refresh();
    return buildCookie(this.session);
  }

  async refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: this.session.refresh_token }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Mobbin session refresh failed (${res.status}). Log in again with \`mobbin-mcp auth\`. ${body.slice(0, 200)}`,
      );
    }
    this.session = validateSession((await res.json()) as Session);
    if (this.persist) saveSession(this.session);
  }
}

export function buildCookie(s: Session): string {
  const encoded = "base64-" + Buffer.from(JSON.stringify(s)).toString("base64url");
  const parts: string[] = [];
  for (let i = 0; i < encoded.length; i += COOKIE_CHUNK_SIZE) {
    parts.push(`${COOKIE_PREFIX}.${parts.length}=${encoded.slice(i, i + COOKIE_CHUNK_SIZE)}`);
  }
  return parts.join("; ");
}
