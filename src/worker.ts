// Serves /mes and /mes/* from the lynx app through the tunnel; every other path
// is answered by static assets and never reaches this script (see runWorkerFirst
// in cloudflare.config.ts).

const ORIGIN = "https://mes-origin.cbxm.me";
const SESSION_COOKIE = "mes_session";

/** How long a copy stays available to serve while lynx is down. */
const RETAIN_SECONDS = 30 * 24 * 60 * 60;

const STORED_AT = "x-mes-stored-at";
const FRESH_FOR = "x-mes-fresh-for";
const CLIENT_CACHE_CONTROL = "x-mes-cache-control";
const ORIGIN_TAGS = "x-mes-cache-tags";

// The site typechecks against the DOM library, which lacks these Workers globals.
type WaitUntil = { waitUntil(promise: Promise<unknown>): void };
type WorkerCaches = CacheStorage & { default: Cache };

function isAuthed(request: Request): boolean {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies.split(";").some((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
}

/** Edge freshness in seconds, or null when the response must not be stored. */
function edgeFreshness(response: Response): number | null {
  if (response.status !== 200 || response.headers.has("set-cookie")) return null;
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!/\bpublic\b/.test(cacheControl)) return null;
  const maxAge = /\bs-maxage=(\d+)/.exec(cacheControl) ?? /\bmax-age=(\d+)/.exec(cacheControl);
  return maxAge ? Number(maxAge[1]) : null;
}

function forClient(response: Response, cacheState: string): Response {
  const out = new Response(response.body, response);
  const clientCacheControl = out.headers.get(CLIENT_CACHE_CONTROL);
  if (clientCacheControl) out.headers.set("cache-control", clientCacheControl);
  for (const header of [STORED_AT, FRESH_FOR, CLIENT_CACHE_CONTROL, ORIGIN_TAGS]) {
    out.headers.delete(header);
  }
  out.headers.set("x-mes-cache", cacheState);
  return out;
}

function forStorage(response: Response, freshFor: number): Response {
  const stored = new Response(response.body, response);
  stored.headers.set(STORED_AT, String(Date.now()));
  stored.headers.set(FRESH_FOR, String(freshFor));
  stored.headers.set(CLIENT_CACHE_CONTROL, response.headers.get("cache-control") ?? "");
  stored.headers.set("cache-control", `public, max-age=${Math.max(freshFor, RETAIN_SECONDS)}`);
  const tags = response.headers.get(ORIGIN_TAGS);
  if (tags) stored.headers.set("cache-tag", tags);
  return stored;
}

function isFresh(cached: Response): boolean {
  const storedAt = Number(cached.headers.get(STORED_AT));
  const freshFor = Number(cached.headers.get(FRESH_FOR));
  return Date.now() - storedAt < freshFor * 1000;
}

async function fetchThroughCache(
  upstream: Request,
  cacheKey: string,
  ctx: WaitUntil,
): Promise<Response> {
  const cache = (caches as WorkerCaches).default;
  const cached = await cache.match(cacheKey);
  if (cached && isFresh(cached)) return forClient(cached, "hit");

  let response: Response;
  try {
    response = await fetch(upstream);
  } catch (error) {
    if (cached) return forClient(cached, "stale");
    console.error("mes origin unreachable", error);
    return new Response("mes is unreachable", { status: 503 });
  }

  if (response.status >= 500 && cached) return forClient(cached, "stale");
  if (response.status === 404 && cached) ctx.waitUntil(cache.delete(cacheKey));

  const freshFor = edgeFreshness(response);
  if (freshFor === null) return forClient(response, "bypass");

  ctx.waitUntil(cache.put(cacheKey, forStorage(response.clone(), freshFor)));
  return forClient(response, "miss");
}

export default {
  async fetch(request: Request, _env: unknown, ctx: WaitUntil): Promise<Response> {
    const { pathname, search } = new URL(request.url);
    const target = new URL(pathname + search, ORIGIN);
    const upstream = new Request(target, request);

    if (request.method !== "GET" || isAuthed(request)) {
      return fetch(upstream, { redirect: "manual", cache: "no-store" });
    }

    const cacheable = new Request(upstream, { redirect: "manual", cache: "no-store" });
    return fetchThroughCache(cacheable, `https://cbxm.me${pathname}${search}`, ctx);
  },
};
