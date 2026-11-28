/**
 * The shared-token gate for the project site.
 *
 * One secret string, no accounts. `PI_SITE_TOKEN` (from the machine-local
 * `~/.config/pi-site.env`, mode 600) must reach the server either as
 *
 *     GET /?k=<token>          once, per browser: sets an HttpOnly cookie
 *     Cookie: pi_site=<token>  on every later request
 *
 * Empty or missing token = no gate, which is what the laptop uses: it binds
 * 127.0.0.1, so only that machine can reach it. The VPS binds its tailnet
 * address and therefore sets a token.
 *
 * What it is not: per-user accounts, sessions, or a replacement for the
 * tailnet. Whoever holds the token holds the page; rotating the line in the
 * env file and restarting the unit revokes every browser at once.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const TOKEN_ENV = "PI_SITE_TOKEN";
export const COOKIE_NAME = "pi_site";
export const COOKIE_MAX_AGE = 31_536_000; // one year

export function siteToken(env: NodeJS.ProcessEnv = process.env): string {
  return (env[TOKEN_ENV] ?? "").trim();
}

/** Compares through a fixed-size digest, so length and timing reveal nothing. */
export function sameToken(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

/** The token carried by a Cookie header, or "". */
export function cookieToken(header: string | undefined, name: string = COOKIE_NAME): string {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    const raw = rest.join("=");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return "";
}

export function tokenCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

export type GateDecision =
  | { kind: "allow" }
  | { kind: "login"; location: string; cookie: string }
  | { kind: "deny" };

/** No token configured = open (localhost); with one, every path is gated. */
export function decideGate(input: {
  token: string;
  url: URL;
  cookie?: string;
}): GateDecision {
  if (!input.token) return { kind: "allow" };
  const presented = input.url.searchParams.get("k") ?? "";
  if (presented && sameToken(presented, input.token)) {
    const clean = new URL(input.url.toString());
    clean.searchParams.delete("k");
    return { kind: "login", location: `${clean.pathname}${clean.search}`, cookie: tokenCookie(input.token) };
  }
  if (sameToken(cookieToken(input.cookie, COOKIE_NAME), input.token)) return { kind: "allow" };
  return { kind: "deny" };
}

/** The one-page prompt: a password field that submits back as ?k=… */
export function loginPage(path = "/"): string {
  const action = path.split("?")[0] || "/";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project site</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header>
    <div>
      <p class="eyebrow">~/.pi</p>
      <h1>Project site</h1>
    </div>
  </header>
  <main>
    <form class="card" method="get" action="${action}">
      <h3>Shared token</h3>
      <label class="inline"><input type="password" name="k" autocomplete="current-password" autofocus /> token</label>
      <div class="actions"><button type="submit">Open</button></div>
      <p class="meta">The token is PI_SITE_TOKEN in ~/.config/pi-site.env on this host. One entry per browser; it is kept as a cookie.</p>
    </form>
  </main>
</body>
</html>`;
}
