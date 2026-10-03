interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const MAX_BYTES = 80 * 1024 * 1024;
const HOST_BLOCKLIST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\])/;
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};

/**
 * TurboFuzz API worker.
 *
 * Static assets are served directly by Cloudflare (asset-first routing); this
 * script only runs for paths without a matching asset. `/api/fetch` is a
 * minimal CORS-friendly proxy used by the "Load URL" and "Scrape table"
 * options.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/fetch") {
      return handleFetch(url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleFetch(url: URL): Promise<Response> {
  const target = url.searchParams.get("url");
  if (target === null || target === "") {
    return new Response("Missing ?url=", { status: 400, headers: CORS_HEADERS });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: CORS_HEADERS });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response("Only http(s) urls are allowed", { status: 400, headers: CORS_HEADERS });
  }
  if (HOST_BLOCKLIST.test(parsed.hostname) || PRIVATE_172.test(parsed.hostname)) {
    return new Response("Host not allowed", { status: 403, headers: CORS_HEADERS });
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; TurboFuzz/0.1; +https://github.com/jay-stein/turbofuzz)",
        accept: "text/csv,text/plain,text/html,application/json,*/*",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return new Response(`Upstream fetch failed: ${message}`, { status: 502, headers: CORS_HEADERS });
  }

  if (!upstream.ok) {
    return new Response(`Upstream returned ${upstream.status}`, {
      status: 502,
      headers: CORS_HEADERS,
    });
  }

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    return new Response("Response too large", { status: 413, headers: CORS_HEADERS });
  }

  return new Response(buffer, {
    headers: {
      ...CORS_HEADERS,
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}
