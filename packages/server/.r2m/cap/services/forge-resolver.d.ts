import { type SshHostnameResolver } from "../utils/ssh-hostname.js";
import type { ForgeService } from "./forge-service.js";
export interface ForgeResolution {
    /** Registered forge id, e.g. "github" or "gitlab". */
    forge: string;
    /** Remote host the cwd resolves to, e.g. "github.com" or "gitlab.example.com". */
    host: string;
    /** Adapter for {@link forge}, shared across resolutions of the same forge. */
    service: ForgeService;
}
/** Probe a host for a forge id when the name heuristic is inconclusive. */
export type ForgeHostProbe = (host: string) => Promise<string | null>;
export interface CreateForgeResolverOptions {
    resolveRemoteUrl?: (cwd: string) => Promise<string | null>;
    createService?: (forge: string) => ForgeService | null;
    probeForge?: ForgeHostProbe;
    resolveSshHostname?: SshHostnameResolver;
    now?: () => number;
}
export interface ForgeResolver {
    /** Resolve the forge for a working directory, or null when none applies. */
    resolve(cwd: string): Promise<ForgeResolution | null>;
    /** Resolve from a known origin remote URL using only the name heuristic + probe cache. */
    resolveFromRemoteUrl(remoteUrl: string | null): ForgeResolution | null;
    /** Resolve from a known origin remote URL, running the per-host probe when needed. */
    resolveFromRemoteUrlAsync(remoteUrl: string | null): Promise<ForgeResolution | null>;
    /**
     * Invalidate every cached adapter's state for a cwd. Routed through the
     * resolver so invalidation hits the same adapter instance the poller reads,
     * regardless of which forge backs the workspace.
     */
    invalidate(cwd: string): void;
}
export declare function parseRemoteHost(url: string): string | null;
/** Map a remote host through the matchers owned by registered adapters. */
export declare function forgeForHost(host: string): string | null;
export declare function createForgeResolver(options?: CreateForgeResolverOptions): ForgeResolver;
//# sourceMappingURL=forge-resolver.d.ts.map