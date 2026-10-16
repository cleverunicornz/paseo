var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _ForgeRegistry_instances, _ForgeRegistry_adapters, _ForgeRegistry_warnedAmbiguousHosts, _ForgeRegistry_warnAmbiguous;
import { getForgeDefinition } from "@getpaseo/protocol/forge-manifest";
import { normalizeHost } from "@getpaseo/protocol/git-remote";
import { createGitHubService, probeGitHubHost } from "./github-service.js";
import { createGiteaService, resolveGiteaFamilyForge } from "./gitea-service.js";
import { createGitLabService, probeGitLabHost } from "./gitlab-service.js";
/**
 * Open composition boundary for forge adapters. Resolver code depends only on
 * these registration hooks, so a new adapter does not require another branch.
 */
export class ForgeRegistry {
    constructor(entries = []) {
        _ForgeRegistry_instances.add(this);
        _ForgeRegistry_adapters.set(this, new Map());
        _ForgeRegistry_warnedAmbiguousHosts.set(this, new Set());
        for (const [forge, adapter] of entries) {
            this.register(forge, adapter);
        }
    }
    register(forge, adapter) {
        const normalizedForge = parseForgeId(forge);
        if (!normalizedForge) {
            throw new Error(`Invalid forge adapter id: ${forge}`);
        }
        if (__classPrivateFieldGet(this, _ForgeRegistry_adapters, "f").has(normalizedForge)) {
            throw new Error(`Forge adapter already registered: ${normalizedForge}`);
        }
        __classPrivateFieldGet(this, _ForgeRegistry_adapters, "f").set(normalizedForge, adapter);
        return () => {
            if (__classPrivateFieldGet(this, _ForgeRegistry_adapters, "f").get(normalizedForge) === adapter) {
                __classPrivateFieldGet(this, _ForgeRegistry_adapters, "f").delete(normalizedForge);
            }
        };
    }
    ids() {
        return [...__classPrivateFieldGet(this, _ForgeRegistry_adapters, "f").keys()];
    }
    has(forge) {
        const normalizedForge = parseForgeId(forge);
        return normalizedForge ? __classPrivateFieldGet(this, _ForgeRegistry_adapters, "f").has(normalizedForge) : false;
    }
    create(forge) {
        const normalizedForge = parseForgeId(forge);
        if (!normalizedForge) {
            return null;
        }
        const adapter = __classPrivateFieldGet(this, _ForgeRegistry_adapters, "f").get(normalizedForge);
        return adapter ? adapter.createService() : null;
    }
    matchHost(host) {
        const matches = [];
        for (const [forge, adapter] of __classPrivateFieldGet(this, _ForgeRegistry_adapters, "f")) {
            if (adapter.matchesHost?.(host)) {
                matches.push(forge);
            }
        }
        if (matches.length > 1) {
            __classPrivateFieldGet(this, _ForgeRegistry_instances, "m", _ForgeRegistry_warnAmbiguous).call(this, "matched", host, matches);
            return null;
        }
        return matches[0] ?? null;
    }
    async probeHost(host) {
        const entries = [...__classPrivateFieldGet(this, _ForgeRegistry_adapters, "f")];
        // allSettled, not all: a third-party probe that throws means "not this
        // forge", never a crash of the shared resolution path.
        const settled = await Promise.allSettled(entries.map(async ([, adapter]) => adapter.probeHost ? await adapter.probeHost(host) : false));
        const matches = entries
            .filter((_, index) => {
            const result = settled[index];
            return result.status === "fulfilled" && result.value === true;
        })
            .map(([forge]) => forge);
        if (matches.length > 1) {
            __classPrivateFieldGet(this, _ForgeRegistry_instances, "m", _ForgeRegistry_warnAmbiguous).call(this, "recognized", host, matches);
            return null;
        }
        return matches[0] ?? null;
    }
}
_ForgeRegistry_adapters = new WeakMap(), _ForgeRegistry_warnedAmbiguousHosts = new WeakMap(), _ForgeRegistry_instances = new WeakSet(), _ForgeRegistry_warnAmbiguous = function _ForgeRegistry_warnAmbiguous(verb, host, matches) {
    const key = `${verb}:${host}`;
    if (__classPrivateFieldGet(this, _ForgeRegistry_warnedAmbiguousHosts, "f").has(key)) {
        return;
    }
    __classPrivateFieldGet(this, _ForgeRegistry_warnedAmbiguousHosts, "f").add(key);
    console.warn(`Multiple forge adapters ${verb} host ${host}: ${matches.join(", ")}`);
};
function parseForgeId(forge) {
    const normalized = forge.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9._-]*$/.test(normalized) ? normalized : null;
}
/**
 * Build a host matcher from a forge's declared cloud hosts in the manifest, so
 * the registry never hardcodes a host list. Returns undefined for forges with
 * no cloud hosts (recognized only by runtime probe, e.g. Forgejo).
 */
function matchesCloudHost(forgeId) {
    const hosts = getForgeDefinition(forgeId)?.cloudHosts;
    if (!hosts || hosts.length === 0) {
        return undefined;
    }
    const normalized = new Set(hosts.map(normalizeHost));
    return (host) => normalized.has(normalizeHost(host));
}
export const defaultForgeRegistry = new ForgeRegistry([
    // GitHub Enterprise Server is recognized at runtime by probeHost, exactly like
    // self-hosted GitLab/Gitea: github.com short-circuits via matchHost, so the
    // probe only runs on non-cloud hosts. The PR-status poll gates on the resolver
    // alone (no cloud-identity check), so a probed GHES host polls normally.
    [
        "github",
        {
            createService: createGitHubService,
            matchesHost: matchesCloudHost("github"),
            probeHost: probeGitHubHost,
        },
    ],
    [
        "gitlab",
        {
            createService: createGitLabService,
            matchesHost: matchesCloudHost("gitlab"),
            probeHost: probeGitLabHost,
        },
    ],
    [
        "gitea",
        {
            createService: createGiteaService,
            matchesHost: matchesCloudHost("gitea"),
            probeHost: async (host) => (await resolveGiteaFamilyForge(host)) === "gitea",
        },
    ],
    [
        "forgejo",
        {
            createService: createGiteaService,
            probeHost: async (host) => (await resolveGiteaFamilyForge(host)) === "forgejo",
        },
    ],
    ["codeberg", { createService: createGiteaService, matchesHost: matchesCloudHost("codeberg") }],
]);
export function createForgeService(forge) {
    return defaultForgeRegistry.create(forge);
}
export function probeRegisteredForgeHost(host) {
    return defaultForgeRegistry.probeHost(host);
}
//# sourceMappingURL=forge-registry.js.map