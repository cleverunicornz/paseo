import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";

/**
 * Returns `url` without the base path when it is under it (`/s/abc/api/x` →
 * `/api/x`, `/s/abc` → `/`), or null when it is not. `basePath` has both
 * slashes, as `session-runtime-config` normalizes it.
 */
export function stripWebBasePath(url: string, basePath: string): string | null {
  if (basePath === "/") return url;
  const bare = basePath.slice(0, -1);
  if (url === bare || url.startsWith(`${bare}?`) || url.startsWith(`${bare}#`)) {
    return `/${url.slice(bare.length)}`;
  }
  return url.startsWith(basePath) ? url.slice(bare.length) : null;
}

/**
 * A reverse proxy forwards `/s/abc/...` unchanged; the daemon routes it as if
 * it came without the prefix. Requests without the prefix still reach the
 * daemon as before, so local clients (the CLI, agents' loopback MCP URLs)
 * keep working.
 */
export function createWebBasePathMiddleware(basePath: string): RequestHandler {
  return (req, _res, next) => {
    const stripped = stripWebBasePath(req.url, basePath);
    if (stripped !== null) req.url = stripped;
    next();
  };
}

/** The same rewrite for WebSocket upgrades, which never pass through Express. */
export function stripUpgradeBasePath(req: IncomingMessage, basePath: string): void {
  if (req.url === undefined) return;
  const stripped = stripWebBasePath(req.url, basePath);
  if (stripped !== null) req.url = stripped;
}
