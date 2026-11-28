/**
 * Paths on :8786 that forward to an agent dashboard which is already listening
 * on its own port. The dashboard's own address keeps working.
 */
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { escapeHtml, injectShellBar, shellNavAnchors } from "./shell-nav.ts";

export interface DashboardPage {
  id: string;
  name: string;
  port: number;
  /** Site path without the trailing slash, for example /cos. */
  prefix: string;
}

export const DASHBOARD_PAGES: readonly DashboardPage[] = [
  { id: "cos", name: "Cos orchestrator", port: 8787, prefix: "/cos" },
  { id: "web-master", name: "Web master", port: 8789, prefix: "/web-master" },
  { id: "tasks", name: "Tasks", port: 8791, prefix: "/tasks" },
];

export type DashboardMatch =
  | { kind: "redirect"; location: string }
  | { kind: "forward"; page: DashboardPage; upstreamPath: string };

export function matchDashboard(pathname: string): DashboardMatch | undefined {
  for (const page of DASHBOARD_PAGES) {
    if (pathname === page.prefix) return { kind: "redirect", location: `${page.prefix}/` };
    if (pathname.startsWith(`${page.prefix}/`)) {
      const upstreamPath = pathname.slice(page.prefix.length) || "/";
      return { kind: "forward", page, upstreamPath };
    }
  }
  return undefined;
}

export function stoppedPage(page: DashboardPage): string {
  const name = escapeHtml(page.name);
  const id = escapeHtml(page.id);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <nav class="pi-shell" aria-label="Site">${shellNavAnchors(`${page.prefix}/`)}</nav>
  <header>
    <div>
      <p class="eyebrow">~/.pi</p>
      <h1>${name}</h1>
    </div>
  </header>
  <main>
    <p>Stopped.</p>
    <div class="actions"><button type="button" id="start">Start</button></div>
    <p id="start-status" class="status" role="status"></p>
  </main>
  <script>
    document.getElementById("start").addEventListener("click", async () => {
      const status = document.getElementById("start-status");
      status.textContent = "Starting.";
      try {
        const response = await fetch("/api/agents/${id}/start", { method: "POST" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Start failed.");
        location.reload();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Start failed.";
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Forwards one request to the dashboard process.
 * Drops Origin so the dashboard's allow-list does not reject :8786, and drops
 * Accept-Encoding so an HTML page can be rewritten without decoding gzip.
 */
export function forwardDashboard(
  request: IncomingMessage,
  response: ServerResponse,
  page: DashboardPage,
  upstreamPath: string,
): void {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) headers[key] = value;
  delete headers.origin;
  delete headers["accept-encoding"];
  headers.host = `127.0.0.1:${page.port}`;

  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: page.port,
      method: request.method,
      path: upstreamPath,
      headers,
    },
    (incoming) => {
      const type = String(incoming.headers["content-type"] ?? "");
      if (type.includes("text/html")) {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          if (response.headersSent) return;
          const html = injectShellBar(Buffer.concat(chunks).toString("utf8"), `${page.prefix}/`);
          const body = Buffer.from(html);
          const outHeaders = { ...incoming.headers };
          delete outHeaders["content-length"];
          delete outHeaders["content-encoding"];
          delete outHeaders["transfer-encoding"];
          response.writeHead(incoming.statusCode ?? 200, { ...outHeaders, "content-length": body.length });
          response.end(body);
        });
        return;
      }
      const outHeaders = { ...incoming.headers };
      delete outHeaders["transfer-encoding"];
      response.writeHead(incoming.statusCode ?? 200, outHeaders);
      incoming.pipe(response);
    },
  );
  response.on("close", () => upstream.destroy());

  upstream.on("error", () => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const method = request.method ?? "GET";
    const pathOnly = upstreamPath.split("?")[0] ?? upstreamPath;
    if (method === "GET" && !pathOnly.startsWith("/api/")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(stoppedPage(page));
      return;
    }
    response.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: `${page.name} is stopped.` }));
  });

  request.pipe(upstream);
}
