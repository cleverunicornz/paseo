import { LRUCache } from "lru-cache";
import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { resolveSshHostname } from "../utils/ssh-hostname.js";
import { defaultResolveRemoteUrl } from "./forge-cli-command.js";
import { createForgeService, defaultForgeRegistry, probeRegisteredForgeHost, } from "./forge-registry.js";
// A positive probe (host IS a known forge) is cached permanently; a negative one
// expires so a CLI installed/authenticated later is picked up without a restart.
const NEGATIVE_PROBE_TTL_MS = 60000;
// Cap the per-resolver caches: session handlers resolve request-supplied cwds,
// so unbounded Maps would grow for the daemon's lifetime. Distinct hosts/cwds
// are few in practice; LRU eviction keeps the working set without a leak.
const FORGE_RESOLVER_CACHE_MAX = 512;
export function parseRemoteHost(url) {
    return parseGitRemoteLocation(url)?.host ?? null;
}
/** Map a remote host through the matchers owned by registered adapters. */
export function forgeForHost(host) {
    return defaultForgeRegistry.matchHost(host);
}
export function createForgeResolver(options = {}) {
    const resolveRemoteUrl = options.resolveRemoteUrl ?? defaultResolveRemoteUrl;
    const create = options.createService ?? createForgeService;
    const probeForge = options.probeForge ?? probeRegisteredForgeHost;
    const resolveSsh = options.resolveSshHostname ?? resolveSshHostname;
    const now = options.now ?? Date.now;
    const services = new Map();
    // Cache the per-host probe result so the synchronous resolveFromRemoteUrl can
    // reuse a forge discovered by an earlier async resolve. Positive results are
    // permanent; negative ones expire (NEGATIVE_PROBE_TTL_MS) so a CLI installed
    // or authenticated later is picked up without a daemon restart.
    const probedForgeByHost = new LRUCache({ max: FORGE_RESOLVER_CACHE_MAX });
    // Coalesce concurrent probes of the same host so "never re-probe" holds under
    // concurrency: callers racing on the same host await one shared probe.
    const inFlightProbes = new Map();
    // resolveRemoteUrl spawns `git config` — memoize per cwd so repeated resolve()
    // calls (the PR-status poll hits this every cycle) don't re-spawn it. TTL'd
    // (not permanent, unlike a positive host probe) so a remote added/changed
    // from outside Paseo — `git remote add`/`set-url` run in a terminal — is
    // still picked up within a cycle instead of staying pinned forever; a Paseo
    // git mutation still busts it immediately via invalidate(cwd).
    const remoteUrlByCwd = new LRUCache({ max: FORGE_RESOLVER_CACHE_MAX });
    function resolveRemoteUrlCached(cwd) {
        const cached = remoteUrlByCwd.get(cwd);
        if (cached && cached.expiresAt > now()) {
            return cached.promise;
        }
        const pending = resolveRemoteUrl(cwd).catch((error) => {
            if (remoteUrlByCwd.get(cwd)?.promise === pending) {
                remoteUrlByCwd.delete(cwd);
            }
            throw error;
        });
        remoteUrlByCwd.set(cwd, { promise: pending, expiresAt: now() + NEGATIVE_PROBE_TTL_MS });
        return pending;
    }
    function readFreshProbe(host) {
        const entry = probedForgeByHost.get(host);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
            probedForgeByHost.delete(host);
            return undefined;
        }
        return entry.forge;
    }
    function buildResolution(forge, host) {
        let service = services.get(forge);
        if (!service) {
            const created = create(forge);
            if (!created) {
                return null;
            }
            service = created;
            services.set(forge, service);
        }
        return { forge, host, service };
    }
    async function probeHostForge(host) {
        const cached = readFreshProbe(host);
        if (cached !== undefined) {
            return cached;
        }
        const existing = inFlightProbes.get(host);
        if (existing) {
            return existing;
        }
        const pending = (async () => {
            try {
                // A caller-injected probe that throws degrades to "no forge" and is
                // cached negatively, so a transient failure is retried after the TTL.
                let probed;
                try {
                    probed = await probeForge(host);
                }
                catch {
                    probed = null;
                }
                probedForgeByHost.set(host, {
                    forge: probed,
                    expiresAt: probed === null ? Date.now() + NEGATIVE_PROBE_TTL_MS : null,
                });
                return probed;
            }
            finally {
                inFlightProbes.delete(host);
            }
        })();
        inFlightProbes.set(host, pending);
        return pending;
    }
    function resolveFromRemoteUrl(remoteUrl) {
        if (!remoteUrl) {
            return null;
        }
        const host = parseRemoteHost(remoteUrl);
        if (!host) {
            return null;
        }
        const forge = forgeForHost(host) ?? readFreshProbe(host) ?? null;
        if (!forge) {
            return null;
        }
        return buildResolution(forge, host);
    }
    async function resolveFromRemoteUrlAsync(remoteUrl) {
        if (!remoteUrl) {
            return null;
        }
        const location = parseGitRemoteLocation(remoteUrl);
        if (!location) {
            return null;
        }
        const directForge = forgeForHost(location.host);
        if (directForge) {
            return buildResolution(directForge, location.host);
        }
        const resolved = await resolveHostForProbe(location);
        if (resolved.forge) {
            rememberAliasForge(location.host, resolved.host, resolved.forge);
            return buildResolution(resolved.forge, resolved.host);
        }
        const forge = await probeHostForge(resolved.host);
        rememberAliasForge(location.host, resolved.host, forge);
        if (!forge) {
            return null;
        }
        return buildResolution(forge, resolved.host);
    }
    // Seed the probe cache under the raw SSH-alias host too: the synchronous
    // resolveFromRemoteUrl (PR-status poll gating) sees the alias, not the
    // ssh -G resolved host, and would otherwise never find the forge.
    function rememberAliasForge(aliasHost, resolvedHost, forge) {
        if (aliasHost === resolvedHost) {
            return;
        }
        probedForgeByHost.set(aliasHost, {
            forge,
            expiresAt: forge === null ? Date.now() + NEGATIVE_PROBE_TTL_MS : null,
        });
    }
    async function resolveHostForProbe(location) {
        if (location.transport !== "scp" && location.transport !== "ssh") {
            return { host: location.host };
        }
        const resolvedHost = await resolveSsh(location.host);
        if (!resolvedHost) {
            return { host: location.host };
        }
        const resolvedForge = forgeForHost(resolvedHost);
        if (resolvedForge) {
            return { host: resolvedHost, forge: resolvedForge };
        }
        return { host: resolvedHost };
    }
    function invalidate(cwd) {
        remoteUrlByCwd.delete(cwd);
        for (const service of services.values()) {
            service.invalidate({ cwd });
        }
    }
    return {
        resolveFromRemoteUrl,
        resolveFromRemoteUrlAsync,
        invalidate,
        async resolve(cwd) {
            return resolveFromRemoteUrlAsync(await resolveRemoteUrlCached(cwd));
        },
    };
}
//# sourceMappingURL=forge-resolver.js.map