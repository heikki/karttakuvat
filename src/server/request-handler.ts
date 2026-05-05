/**
 * Shared HTTP request handler used by both `src/server/server.ts` (dev) and
 * `src/app/index.ts` (Electrobun launcher). Each caller passes a config that
 * differs only in static-root order, vendor-file overrides, and the
 * post-response hook (logging vs. Full Disk Access detection).
 */

type ApiRouter = (
  req: Request,
  pathname: string
) => Promise<Response | null> | Response | null;

export interface RequestHandlerConfig {
  routeApi: ApiRouter;
  /** Filesystem roots tried in order for static files. */
  staticRoots: string[];
  /** Path → filesystem location for vendor / aliased files. */
  vendorFiles?: Record<string, string>;
  /** Called after every response. Receives the URL's raw pathname. */
  onResponse?: (
    req: Request,
    res: Response,
    pathname: string,
    elapsedMs: number
  ) => Promise<void> | void;
}

export function createRequestHandler(
  config: RequestHandlerConfig
): (req: Request) => Promise<Response> {
  return async (req) => {
    const start = performance.now();
    const url = new URL(req.url);
    const response = await resolve(req, url, config);
    if (config.onResponse !== undefined) {
      await config.onResponse(
        req,
        response,
        url.pathname,
        performance.now() - start
      );
    }
    return response;
  };
}

async function resolve(
  req: Request,
  url: URL,
  config: RequestHandlerConfig
): Promise<Response> {
  const api = config.routeApi(req, url.pathname);
  if (api !== null) {
    const resolved = await api;
    if (resolved !== null) return resolved;
  }

  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';

  const vendor = config.vendorFiles?.[path];
  if (vendor !== undefined) {
    return new Response(Bun.file(vendor));
  }

  for (const root of config.staticRoots) {
    const file = Bun.file(`${root}${path}`);
    if (file.size > 0) return new Response(file);
  }

  return new Response('Not Found', { status: 404 });
}
