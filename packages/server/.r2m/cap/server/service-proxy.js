import http, { createServer as createHTTPServer } from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import express from "express";
const MAX_DNS_LABEL_LENGTH = 63;
const HASH_SUFFIX_LENGTH = 8;
const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
]);
function normalizeHostHeader(host) {
    return host.trim().toLowerCase().replace(/:\d+$/, "");
}
function toHostnameLabel(value) {
    return (value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "untitled");
}
function hashLabel(label) {
    return createHash("sha256").update(label).digest("hex").slice(0, HASH_SUFFIX_LENGTH);
}
function capDnsLabel(label) {
    if (label.length <= MAX_DNS_LABEL_LENGTH) {
        return label;
    }
    const suffix = hashLabel(label);
    const maxPrefixLength = MAX_DNS_LABEL_LENGTH - suffix.length - 2;
    const prefix = label.slice(0, maxPrefixLength).replace(/-+$/g, "") || "svc";
    return `${prefix}--${suffix}`;
}
export function buildServiceProxyLabel({ projectSlug, branchName, scriptName, }) {
    const labels = [toHostnameLabel(scriptName)];
    const isDefaultBranch = branchName === null || branchName === "main" || branchName === "master";
    if (!isDefaultBranch) {
        labels.push(toHostnameLabel(branchName));
    }
    labels.push(toHostnameLabel(projectSlug));
    return capDnsLabel(labels.join("--"));
}
export function buildLocalServiceHostname(input) {
    return `${buildServiceProxyLabel(input)}.localhost`;
}
export function buildPublicServiceHostname({ publicBaseUrl, ...service }) {
    const base = new URL(publicBaseUrl);
    return `${buildServiceProxyLabel(service)}.${base.hostname}`;
}
export function buildPublicServiceProxyUrl(options) {
    const base = new URL(options.publicBaseUrl);
    const hostname = buildPublicServiceHostname(options);
    const port = base.port ? `:${base.port}` : "";
    return `${base.protocol}//${hostname}${port}`;
}
export function projectServiceProxyUrls(options) {
    const localHostname = buildLocalServiceHostname(options);
    const localProxyUrl = options.daemonPort === null || options.daemonPort === undefined
        ? null
        : `http://${localHostname}:${options.daemonPort}`;
    const publicProxyUrl = options.publicBaseUrl
        ? buildPublicServiceProxyUrl({
            projectSlug: options.projectSlug,
            branchName: options.branchName,
            scriptName: options.scriptName,
            publicBaseUrl: options.publicBaseUrl,
        })
        : null;
    return {
        localProxyUrl,
        publicProxyUrl,
        proxyUrl: publicProxyUrl ?? localProxyUrl,
    };
}
export function projectWorkspaceService(input) {
    return {
        hostname: buildLocalServiceHostname(input),
        ...projectServiceProxyUrls(input),
    };
}
export function projectRegisteredServiceProxyUrls(options) {
    const localProxyUrl = options.daemonPort === null || options.daemonPort === undefined
        ? null
        : `http://${options.route.hostname}:${options.daemonPort}`;
    let publicProxyUrl = null;
    if (options.route.publicHostname && options.route.publicBaseUrl) {
        const base = new URL(options.route.publicBaseUrl);
        const port = base.port ? `:${base.port}` : "";
        publicProxyUrl = `${base.protocol}//${options.route.publicHostname}${port}`;
    }
    return {
        localProxyUrl,
        publicProxyUrl,
        proxyUrl: publicProxyUrl ?? localProxyUrl,
    };
}
function toHealthTarget(route) {
    return {
        workspaceId: route.workspaceId,
        scriptName: route.scriptName,
        hostname: route.hostname,
        port: route.port,
    };
}
function stripHopByHopHeaders(rawHeaders) {
    const out = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
        if (value === undefined)
            continue;
        if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()))
            continue;
        out[key] = value;
    }
    return out;
}
const MAX_TCP_PORT = 65535;
function parseHostHeaderPort(hostHeader) {
    const match = /:(\d+)$/.exec(hostHeader);
    if (!match) {
        return null;
    }
    // The authority is client-supplied — route lookup strips the port before
    // matching, so any digits reach us. Only pass on something that could be a
    // real port rather than handing services a number they will build URLs from.
    const port = Number(match[1]);
    return port >= 1 && port <= MAX_TCP_PORT ? match[1] : null;
}
function buildForwardedHeaders({ req, route, protocol, }) {
    const hostHeader = String(req.headers.host ?? route.hostname);
    const forwardedHeaders = stripHopByHopHeaders(req.headers);
    forwardedHeaders["x-forwarded-for"] = req.socket.remoteAddress ?? "127.0.0.1";
    // Forward the authority verbatim, port included. Services derive their public
    // origin from this header, so a stripped port makes them emit absolute URLs
    // (redirects, links) pointing at port 80. Route lookup already normalized the
    // port away, which also means the port here is client-chosen: upstream apps
    // must treat the forwarded authority as untrusted input.
    forwardedHeaders["x-forwarded-host"] = hostHeader;
    forwardedHeaders["x-forwarded-proto"] = protocol;
    // Keep the two headers consistent: x-forwarded-host is set from Host just
    // above, and frameworks apply x-forwarded-port afterwards, so an inbound port
    // that disagrees would silently win over the authority we forwarded. The port
    // in Host therefore takes precedence. When Host carries no port there is
    // nothing to derive from and an upstream proxy's value survives — the
    // nginx-on-:8443 case, where $host drops the port and x-forwarded-port is the
    // only source. Never derive the port from the scheme: the upgrade path
    // hardcodes "http", so defaulting would turn a correct 443 into 80.
    //
    // LIMITATION: none of this is authenticated, and the port in Host is not an
    // observation of the connection — it is whatever the client wrote, since
    // route lookup normalizes the port away before matching. Paseo also does not
    // check whether an inbound x-forwarded-port arrived from a configured trusted
    // proxy. Services must treat the forwarded authority as client-influenced
    // input, not as a trusted origin. This predates the header handling here:
    // Host has always carried a client-chosen port, and an inbound
    // x-forwarded-port has always passed straight through. Closing it means
    // threading the daemon's trustedProxies into this subsystem and into the
    // upgrade path, which has no Express trust context. Tracked separately.
    const port = parseHostHeaderPort(hostHeader);
    if (port !== null) {
        forwardedHeaders["x-forwarded-port"] = port;
    }
    return forwardedHeaders;
}
function proxyHttpRequest({ req, res, route, logger, }) {
    const forwardedHeaders = buildForwardedHeaders({ req, route, protocol: req.protocol });
    const proxyReq = http.request({
        hostname: "127.0.0.1",
        port: route.port,
        path: req.originalUrl,
        method: req.method,
        headers: forwardedHeaders,
    }, (proxyRes) => {
        const responseHeaders = stripHopByHopHeaders(proxyRes.headers);
        res.writeHead(proxyRes.statusCode ?? 502, responseHeaders);
        proxyRes.pipe(res, { end: true });
    });
    proxyReq.on("error", (err) => {
        logger.warn({ err, hostname: route.hostname, port: route.port }, "Service proxy: upstream unreachable");
        if (!res.headersSent) {
            res.writeHead(502, { "content-type": "text/plain" });
            res.end("502 Bad Gateway");
        }
    });
    req.pipe(proxyReq, { end: true });
}
function proxyUpgradeRequest({ req, socket, head, route, logger, }) {
    const targetSocket = net.connect({ host: "127.0.0.1", port: route.port }, () => {
        const forwardedHeaders = buildForwardedHeaders({ req, route, protocol: "http" });
        forwardedHeaders.connection = "Upgrade";
        forwardedHeaders.upgrade = req.headers.upgrade ?? "websocket";
        const headerLines = [];
        headerLines.push(`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}`);
        for (const [key, value] of Object.entries(forwardedHeaders)) {
            if (Array.isArray(value)) {
                for (const v of value)
                    headerLines.push(`${key}: ${v}`);
            }
            else {
                headerLines.push(`${key}: ${value}`);
            }
        }
        headerLines.push("\r\n");
        targetSocket.write(headerLines.join("\r\n"));
        if (head.length > 0)
            targetSocket.write(head);
        targetSocket.pipe(socket);
        socket.pipe(targetSocket);
    });
    targetSocket.on("error", (err) => {
        logger.warn({ err, hostname: route.hostname, port: route.port }, "Service proxy: WebSocket upstream unreachable");
        socket.end();
    });
    socket.on("error", () => {
        targetSocket.destroy();
    });
}
function sameRouteOwner(left, right) {
    return left.workspaceId === right.workspaceId && left.scriptName === right.scriptName;
}
export class ServiceProxyRouteCollisionError extends Error {
    constructor(hostname, existing, incoming) {
        super(`Another workspace is already serving "${incoming.scriptName}" at ${hostname}. Stop that service or run this one on a different branch to free the address.`);
        this.hostname = hostname;
        this.existing = existing;
        this.incoming = incoming;
        this.name = "ServiceProxyRouteCollisionError";
    }
}
export class ServiceProxyRouteRegistry {
    constructor(publicBaseUrl) {
        this.routes = new Map();
        this.hostnameAliases = new Map();
        this.workspaceHostnames = new Map();
        this.configuredPublicBaseHostnames = new Set();
        this.publicBaseHostnames = new Set();
        if (publicBaseUrl) {
            const hostname = new URL(publicBaseUrl).hostname.toLowerCase();
            this.configuredPublicBaseHostnames.add(hostname);
            this.publicBaseHostnames.add(hostname);
        }
    }
    registerWorkspaceService(input) {
        const localHostname = buildLocalServiceHostname(input);
        const publicHostname = input.publicBaseUrl
            ? buildPublicServiceHostname({ ...input, publicBaseUrl: input.publicBaseUrl })
            : null;
        const entry = {
            hostname: localHostname,
            ...(publicHostname ? { publicHostname } : {}),
            ...(input.publicBaseUrl ? { publicBaseUrl: input.publicBaseUrl } : {}),
            port: input.port,
            workspaceId: input.workspaceId,
            projectSlug: input.projectSlug,
            scriptName: input.scriptName,
        };
        this.registerRoute(entry);
        return { ...entry };
    }
    registerRoute(entry) {
        this.assertCanRegister(entry);
        const previous = this.routes.get(entry.hostname);
        if (previous) {
            this.removeRoute(previous.hostname);
        }
        const storedEntry = this.toStoredEntry(entry);
        this.routes.set(storedEntry.hostname, storedEntry);
        for (const alias of this.getRouteHostnames(storedEntry)) {
            this.hostnameAliases.set(alias, storedEntry.hostname);
        }
        if (storedEntry.publicBaseUrl) {
            this.publicBaseHostnames.add(new URL(storedEntry.publicBaseUrl).hostname.toLowerCase());
        }
        this.addHostnameToWorkspaceIndex(storedEntry.workspaceId, storedEntry.hostname);
    }
    replaceWorkspaceBranchRoutes(params) {
        const routes = this.listRoutesForWorkspace(params.workspaceId);
        if (routes.length === 0) {
            return false;
        }
        const updates = routes.map((route) => ({
            oldHostname: route.hostname,
            entry: this.toStoredEntry({
                ...route,
                hostname: buildLocalServiceHostname({
                    projectSlug: route.projectSlug,
                    branchName: params.newBranch,
                    scriptName: route.scriptName,
                }),
                publicHostname: route.publicBaseUrl
                    ? buildPublicServiceHostname({
                        projectSlug: route.projectSlug,
                        branchName: params.newBranch,
                        scriptName: route.scriptName,
                        publicBaseUrl: route.publicBaseUrl,
                    })
                    : null,
            }),
        }));
        if (updates.every(({ oldHostname, entry }) => oldHostname === entry.hostname &&
            (this.routes.get(oldHostname)?.publicHostname ?? null) === (entry.publicHostname ?? null))) {
            return false;
        }
        const replacingHostnames = new Set(routes.map((route) => route.hostname));
        this.assertNoInternalCollisions(updates.map(({ entry }) => entry));
        for (const { entry } of updates) {
            this.assertCanRegister(entry, replacingHostnames);
        }
        for (const { oldHostname } of updates) {
            this.removeRoute(oldHostname);
        }
        for (const { entry } of updates) {
            this.registerRoute(entry);
        }
        return true;
    }
    removeRoute(hostname) {
        const canonicalHostname = this.hostnameAliases.get(normalizeHostHeader(hostname)) ?? hostname;
        const entry = this.routes.get(canonicalHostname);
        if (!entry) {
            return;
        }
        this.routes.delete(canonicalHostname);
        for (const alias of this.getRouteHostnames(entry)) {
            this.hostnameAliases.delete(alias);
        }
        this.removeHostnameFromWorkspaceIndex(entry.workspaceId, canonicalHostname);
        this.rebuildPublicBaseHostnames();
    }
    removeRouteForWorkspaceScript(params) {
        const route = this.listRoutesForWorkspace(params.workspaceId).find((entry) => entry.scriptName === params.scriptName);
        if (route) {
            this.removeRoute(route.hostname);
        }
    }
    removeWorkspaceService(params) {
        this.removeRouteForWorkspaceScript(params);
    }
    projectUrls(input) {
        return projectServiceProxyUrls(input);
    }
    projectWorkspaceService(input) {
        return projectWorkspaceService(input);
    }
    projectWorkspaceServiceState(input) {
        const route = this.listRoutesForWorkspace(input.workspaceId).find((entry) => entry.scriptName === input.scriptName);
        if (route) {
            return {
                hostname: route.hostname,
                port: route.port,
                ...projectRegisteredServiceProxyUrls({ route, daemonPort: input.daemonPort }),
            };
        }
        return {
            port: null,
            ...projectWorkspaceService(input),
        };
    }
    getHealthCheckTargets() {
        return this.listRoutes().map(toHealthTarget);
    }
    getWorkspaceHealthTargets(workspaceId) {
        return this.listRoutesForWorkspace(workspaceId).map(toHealthTarget);
    }
    getHealthTargetForHostname(hostname) {
        const entry = this.getRouteEntry(hostname);
        return entry ? toHealthTarget(entry) : null;
    }
    removeServiceRoutesByHostnames(hostnames) {
        for (const hostname of hostnames) {
            this.removeRoute(hostname);
        }
    }
    removeRoutesForPort(port) {
        for (const [hostname, entry] of Array.from(this.routes)) {
            if (entry.port === port) {
                this.routes.delete(hostname);
                for (const alias of this.getRouteHostnames(entry)) {
                    this.hostnameAliases.delete(alias);
                }
                this.removeHostnameFromWorkspaceIndex(entry.workspaceId, hostname);
            }
        }
        this.rebuildPublicBaseHostnames();
    }
    classifyHost(host) {
        if (!host) {
            return { type: "daemon" };
        }
        const hostname = normalizeHostHeader(host);
        const exactRoute = this.getRouteByHostname(hostname);
        if (exactRoute) {
            return {
                type: "registered-service",
                route: { hostname: exactRoute.hostname, port: exactRoute.port },
            };
        }
        if (hostname.endsWith(".localhost") && hostname.split(".")[0]?.includes("--")) {
            return { type: "known-service-miss" };
        }
        for (const baseHostname of this.publicBaseHostnames) {
            if (hostname === baseHostname || hostname.endsWith(`.${baseHostname}`)) {
                return { type: "known-service-miss" };
            }
        }
        return { type: "daemon" };
    }
    findRoute(host) {
        const classification = this.classifyHost(host);
        return classification.type === "registered-service" ? classification.route : null;
    }
    getRouteEntry(hostname) {
        const entry = this.getRouteByHostname(normalizeHostHeader(hostname));
        return entry ? { ...entry } : null;
    }
    listRoutes() {
        return Array.from(this.routes.values()).map((entry) => Object.assign({}, entry));
    }
    listRoutesForWorkspace(workspaceId) {
        const hostnames = this.workspaceHostnames.get(workspaceId);
        if (!hostnames) {
            return [];
        }
        const routes = [];
        for (const hostname of hostnames) {
            const entry = this.routes.get(hostname);
            if (entry) {
                routes.push({ ...entry });
            }
        }
        return routes;
    }
    assertCanRegister(entry, replacingHostnames = new Set()) {
        const incomingHostnames = this.getRouteHostnames(entry);
        for (const hostname of incomingHostnames) {
            const canonical = this.hostnameAliases.get(hostname) ?? hostname;
            if (replacingHostnames.has(canonical)) {
                continue;
            }
            const existing = this.routes.get(canonical);
            if (existing && !sameRouteOwner(existing, entry)) {
                throw new ServiceProxyRouteCollisionError(hostname, existing, entry);
            }
        }
    }
    assertNoInternalCollisions(entries) {
        const ownersByHostname = new Map();
        for (const entry of entries) {
            for (const hostname of this.getRouteHostnames(entry)) {
                const existing = ownersByHostname.get(hostname);
                if (existing) {
                    throw new ServiceProxyRouteCollisionError(hostname, existing, entry);
                }
                ownersByHostname.set(hostname, entry);
            }
        }
    }
    toStoredEntry(entry) {
        const { publicHostname, publicBaseUrl, ...requiredEntry } = entry;
        return {
            ...requiredEntry,
            ...(publicHostname ? { publicHostname } : {}),
            ...(publicBaseUrl ? { publicBaseUrl } : {}),
        };
    }
    getRouteByHostname(hostname) {
        const canonicalHostname = this.hostnameAliases.get(hostname) ?? hostname;
        return this.routes.get(canonicalHostname);
    }
    getRouteHostnames(entry) {
        return [entry.hostname, ...(entry.publicHostname ? [entry.publicHostname] : [])].map((host) => host.toLowerCase());
    }
    addHostnameToWorkspaceIndex(workspaceId, hostname) {
        const hostnames = this.workspaceHostnames.get(workspaceId) ?? new Set();
        hostnames.add(hostname);
        this.workspaceHostnames.set(workspaceId, hostnames);
    }
    removeHostnameFromWorkspaceIndex(workspaceId, hostname) {
        const hostnames = this.workspaceHostnames.get(workspaceId);
        if (!hostnames) {
            return;
        }
        hostnames.delete(hostname);
        if (hostnames.size === 0) {
            this.workspaceHostnames.delete(workspaceId);
        }
    }
    rebuildPublicBaseHostnames() {
        this.publicBaseHostnames = new Set(this.configuredPublicBaseHostnames);
        for (const entry of this.routes.values()) {
            if (entry.publicBaseUrl) {
                this.publicBaseHostnames.add(new URL(entry.publicBaseUrl).hostname.toLowerCase());
            }
        }
    }
}
export { ServiceProxyRouteRegistry as ScriptRouteStore };
export function createScriptProxyMiddleware({ routeStore, logger, }) {
    return (req, res, next) => {
        const classification = routeStore.classifyHost(req.headers.host);
        if (classification.type === "daemon") {
            next();
            return;
        }
        if (classification.type === "known-service-miss") {
            res.status(404).send("404 Not Found");
            return;
        }
        proxyHttpRequest({ req, res, route: classification.route, logger });
    };
}
export function createScriptProxyUpgradeHandler({ routeStore, logger, passthroughUnknown = true, }) {
    return (req, socket, head) => {
        const classification = routeStore.classifyHost(req.headers.host);
        if (classification.type !== "registered-service") {
            if (!passthroughUnknown) {
                socket.destroy();
            }
            return;
        }
        proxyUpgradeRequest({ req, socket, head, route: classification.route, logger });
    };
}
export function createServiceProxySubsystem({ logger, publicBaseUrl, }) {
    return new NodeServiceProxySubsystem(logger, publicBaseUrl ?? null);
}
class NodeServiceProxySubsystem {
    constructor(logger, publicBaseUrl) {
        this.logger = logger;
        this.standaloneServer = null;
        this.standaloneListenTarget = null;
        this.routes = new ServiceProxyRouteRegistry(publicBaseUrl);
    }
    registerWorkspaceService(input) {
        return this.routes.registerWorkspaceService(input);
    }
    removeWorkspaceService(params) {
        this.routes.removeRouteForWorkspaceScript(params);
    }
    removeServiceRoutesByHostnames(hostnames) {
        this.routes.removeServiceRoutesByHostnames(hostnames);
    }
    replaceWorkspaceBranchRoutes(params) {
        return this.routes.replaceWorkspaceBranchRoutes(params);
    }
    getHealthCheckTargets() {
        return this.routes.getHealthCheckTargets();
    }
    getWorkspaceHealthTargets(workspaceId) {
        return this.routes.getWorkspaceHealthTargets(workspaceId);
    }
    getHealthTargetForHostname(hostname) {
        return this.routes.getHealthTargetForHostname(hostname);
    }
    projectUrls(input) {
        return projectServiceProxyUrls(input);
    }
    projectWorkspaceService(input) {
        return projectWorkspaceService(input);
    }
    projectWorkspaceServiceState(input) {
        return this.routes.projectWorkspaceServiceState(input);
    }
    middleware() {
        return createScriptProxyMiddleware({ routeStore: this.routes, logger: this.logger });
    }
    upgradeHandler(options) {
        // Pass passthroughUnknown explicitly: the factory defaults it to true, the
        // subsystem requires callers to choose.
        return createScriptProxyUpgradeHandler({
            routeStore: this.routes,
            logger: this.logger,
            passthroughUnknown: options.passthroughUnknown,
        });
    }
    async startStandalone(options) {
        if (this.standaloneServer) {
            return this.standaloneListenTarget ?? options.listenTarget;
        }
        const app = express();
        app.set("trust proxy", true);
        app.use(this.middleware());
        app.use((_req, res) => {
            res.status(404).send("404 Not Found");
        });
        const server = createHTTPServer(app);
        server.on("upgrade", this.upgradeHandler({ passthroughUnknown: false }));
        this.standaloneServer = server;
        try {
            await listen(server, options.listenTarget);
            this.standaloneListenTarget = resolveBoundListenTarget(options.listenTarget, server);
            return this.standaloneListenTarget;
        }
        catch (error) {
            this.standaloneServer = null;
            this.standaloneListenTarget = null;
            throw error;
        }
    }
    async stopStandalone() {
        const server = this.standaloneServer;
        const listenTarget = this.standaloneListenTarget;
        this.standaloneServer = null;
        this.standaloneListenTarget = null;
        if (!server) {
            return;
        }
        server.closeAllConnections();
        await new Promise((resolve) => {
            server.close(() => resolve());
        });
        if (listenTarget?.type === "socket" && existsSync(listenTarget.path)) {
            unlinkSync(listenTarget.path);
        }
    }
}
function listen(server, listenTarget) {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            server.off("listening", onListening);
            reject(err);
        };
        const onListening = () => {
            server.off("error", onError);
            resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        if (listenTarget.type === "tcp") {
            server.listen(listenTarget.port, listenTarget.host);
        }
        else {
            if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
                unlinkSync(listenTarget.path);
            }
            server.listen(listenTarget.path);
        }
    });
}
function resolveBoundListenTarget(listenTarget, httpServer) {
    if (listenTarget.type !== "tcp") {
        return listenTarget;
    }
    const address = httpServer.address();
    if (!address || typeof address === "string") {
        throw new Error("HTTP server did not expose a TCP address after listening");
    }
    return { type: "tcp", host: listenTarget.host, port: address.port };
}
export function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("Failed to get assigned port"));
                return;
            }
            const { port } = address;
            server.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve(port);
            });
        });
        server.on("error", reject);
    });
}
//# sourceMappingURL=service-proxy.js.map