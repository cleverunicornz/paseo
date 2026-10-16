import { isReply } from "./replies.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
// One registration per context kind; per-session registrations outlive closed sessions in Node.
const requests = new AsyncLocalStorage();
const projectionSource = new AsyncLocalStorage();
/** Source provenance and lifetimes. Domain producers own snapshots, filters and buffering. */
export class SessionDelivery {
    constructor(send, sendBinary = () => { }, project = (_source, message) => message, unexpectedReply = () => { }) {
        this.send = send;
        this.sendBinary = sendBinary;
        this.project = project;
        this.unexpectedReply = unexpectedReply;
        this.sources = new Map();
        this.proofs = new WeakMap();
        this.defaultSource = {};
        this.scope = {};
    }
    attach(socket, modern) {
        if (this.closing)
            throw new Error("Session delivery is closed");
        const existing = this.sources.get(socket);
        if (existing) {
            if (existing.modern !== modern)
                throw new Error("Cannot renegotiate subscription ownership on an active source");
            return;
        }
        this.sources.set(socket, {
            socket,
            modern,
            active: true,
            handshakePending: true,
            cancellation: new AbortController(),
            subscriptions: new Map(),
            operations: new Set(),
        });
    }
    get currentSource() {
        const projection = projectionSource.getStore();
        if (projection?.scope === this.scope)
            return projection.source;
        return this.currentRequest?.source.socket;
    }
    get currentRequest() {
        const owner = requests.getStore();
        return owner?.scope === this.scope ? owner : undefined;
    }
    get requestSignal() {
        const request = this.currentRequest;
        if (!request)
            throw new Error("Operation has no requesting source");
        return request.source.cancellation.signal;
    }
    forSource(source, project) {
        if (this.closing)
            throw new Error("Session delivery is closed");
        return projectionSource.run({ scope: this.scope, source }, project);
    }
    hasLegacySources() {
        return [...this.sources.values()].some((source) => source.active && !source.modern);
    }
    hasDemand(family) {
        return [...this.sources.values()].some((source) => source.active &&
            [...source.subscriptions.values()].some((owner) => owner.active && owner.family === family));
    }
    subscriptionIds(source, family) {
        return [...(this.sources.get(source)?.subscriptions.values() ?? [])]
            .filter((owner) => owner.active && owner.family === family)
            .map((owner) => owner.id);
    }
    get registrationCount() {
        return [...this.sources.values()].reduce((count, source) => count + source.subscriptions.size + source.operations.size, 0);
    }
    sourceRegistrationCount(socket = this.currentSource) {
        const source = socket ? this.sources.get(socket) : undefined;
        return source ? source.subscriptions.size + source.operations.size : 0;
    }
    async releaseFamily(family) {
        await Promise.all([...this.sources.values()].flatMap((source) => [...source.subscriptions.values()]
            .filter((owner) => owner.family === family)
            .map((owner) => this.releaseOwner(owner))));
    }
    isModern(socket) {
        return socket ? this.sources.get(socket)?.modern === true : false;
    }
    async detach(socket) {
        const source = this.sources.get(socket);
        if (!source)
            return;
        source.active = false;
        source.cancellation.abort();
        await Promise.all([...source.subscriptions.values(), ...source.operations].map((owner) => this.releaseOwner(owner)));
        this.sources.delete(socket);
    }
    close() {
        this.closing ?? (this.closing = Promise.resolve().then(() => this.dispose()));
        return this.closing;
    }
    async dispose() {
        const releases = [...this.sources.keys()].map((socket) => this.detach(socket));
        const releaseResults = await Promise.allSettled(releases);
        for (const result of releaseResults) {
            if (result.status === "rejected")
                throw result.reason;
        }
    }
    async request(socket, request, run) {
        if (this.closing)
            throw new Error("Session delivery is closed");
        socket ?? (socket = this.defaultSource);
        if (!this.sources.has(socket))
            this.attach(socket, false);
        const source = this.sources.get(socket);
        const owner = { scope: this.scope, source, request, active: true };
        try {
            await requests.run(owner, run);
        }
        finally {
            owner.active = false;
        }
    }
    protocolFailure(socket, failure) {
        const source = this.sources.get(socket);
        if (!source?.active)
            return;
        const message = failure.requestId !== undefined
            ? { type: "rpc_error", payload: { ...failure, requestId: failure.requestId } }
            : { type: "status", payload: { status: "error", message: failure.error } };
        const owner = { source, active: true };
        try {
            this.sendOwned(owner, message);
        }
        finally {
            owner.active = false;
        }
    }
    authorizeReply(message, socket) {
        message = this.project(socket, message);
        const owner = this.currentRequest;
        if (owner?.active &&
            owner.source.active &&
            owner.source.socket === socket &&
            isReply(owner.request, message))
            this.proofs.set(message, owner);
        return message;
    }
    reply(message) {
        const owner = this.currentRequest;
        if (!owner)
            return false;
        if (!isReply(owner.request, message)) {
            if ("requestId" in owner.request &&
                "payload" in message &&
                "requestId" in message.payload &&
                message.payload.requestId === owner.request.requestId) {
                this.unexpectedReply(owner.request, message);
            }
            return false;
        }
        if (owner.active && owner.source.active) {
            const reply = owner.source.modern ? message : legacyMessage(message);
            this.sendOwned(owner, reply);
        }
        return true;
    }
    begin(family, requestedId, stop, legacySlot = family) {
        const request = this.currentRequest;
        if (!request?.active || !request.source.active)
            throw new Error("Subscription source is closed");
        const source = request.source;
        if (source.modern && (!("requestId" in request.request) || !request.request.requestId))
            throw new Error("Owned subscriptions require a requestId");
        if (source.modern && requestedId !== undefined)
            throw new Error("Subscription IDs are assigned by the host");
        // COMPAT(ownedSubscriptions): added in v0.8.0, remove after 2027-03-09 once client floor >= v0.8.0.
        if (!source.modern) {
            for (const prior of source.subscriptions.values()) {
                // Keep failed teardown registered so disconnect/close can report it.
                if (prior.legacySlot === legacySlot)
                    void this.releaseOwner(prior).catch(() => { });
            }
        }
        const id = randomUUID();
        const responseId = source.modern ? id : requestedId?.trim() || id;
        const owner = {
            id,
            responseId,
            source,
            family,
            legacySlot,
            active: true,
            cancellation: new AbortController(),
            stop: () => stop(id),
            forget: () => {
                source.subscriptions.delete(id);
            },
        };
        source.subscriptions.set(id, owner);
        return {
            id,
            responseId,
            source: source.socket,
            signal: owner.cancellation.signal,
            emit: (message) => {
                if (!owner.active || !source.active)
                    return;
                const tagged = source.modern ||
                    message.type === "fs.file.update" ||
                    message.type === "checkout_diff_update"
                    ? withSubscriptionId(message, responseId)
                    : legacyMessage(message);
                this.sendOwned(owner, tagged);
            },
            emitBinary: (frame) => {
                if (!owner.active || !source.active)
                    return;
                this.proofs.set(frame, owner);
                this.sendBinary(source.socket, frame);
            },
            release: () => this.releaseOwner(owner),
        };
    }
    /** A domain extends the originating request until its asynchronous operation ends. */
    operation(accepts, stop) {
        const request = this.currentRequest;
        if (!request?.active || !request.source.active)
            throw new Error("Operation source is closed");
        const source = request.source;
        const owner = {
            source,
            active: true,
            cancellation: new AbortController(),
            stop,
            forget: () => {
                source.operations.delete(owner);
            },
        };
        source.operations.add(owner);
        return {
            source: source.socket,
            signal: owner.cancellation.signal,
            emit: (message) => {
                if (!owner.active || !source.active || !accepts(message))
                    return;
                this.sendOwned(owner, message);
            },
            release: () => this.releaseOwner(owner),
        };
    }
    async release(id) {
        const source = this.currentRequest?.source;
        const owner = source?.subscriptions.get(id) ??
            (source && !source.modern
                ? [...source.subscriptions.values()].find((candidate) => candidate.responseId === id)
                : undefined);
        if (owner)
            await this.releaseOwner(owner);
    }
    async releaseLegacySlot(slot) {
        const source = this.currentRequest?.source;
        if (!source)
            return;
        if (source.modern)
            throw new Error("Release subscriptions using the server-assigned subscription ID");
        const owner = [...source.subscriptions.values()].find((candidate) => candidate.legacySlot === slot);
        if (owner)
            await this.releaseOwner(owner);
    }
    authorizeFileReply(frame, socket) {
        const owner = this.currentRequest;
        if (owner?.active &&
            owner.source.socket === socket &&
            owner.request.type === "file_explorer_request")
            this.proofs.set(frame, owner);
    }
    permitsBinary(socket, frame) {
        const source = this.sources.get(socket);
        if (!source?.active)
            return false;
        // COMPAT(ownedSubscriptions): added in v0.8.0, remove after 2027-03-09 once client floor >= v0.8.0.
        if (!source.modern)
            return true;
        const owner = this.proofs.get(frame);
        return owner?.active === true && owner.source === source;
    }
    permits(socket, message) {
        const source = this.sources.get(socket);
        if (!source?.active)
            return false;
        // COMPAT(ownedSubscriptions): added in v0.8.0, remove after 2027-03-09 once client floor >= v0.8.0.
        if (!source.modern)
            return true;
        if (message.type === "status" &&
            message.payload.status === "server_info" &&
            source.handshakePending) {
            source.handshakePending = false;
            return true;
        }
        const owner = this.proofs.get(message);
        return owner?.active === true && owner.source === source;
    }
    sendOwned(owner, message) {
        const projected = this.project(owner.source.socket, message);
        this.proofs.set(projected, owner);
        this.send(owner.source.socket, projected);
    }
    releaseOwner(owner) {
        if (owner.release)
            return owner.release;
        owner.active = false;
        let resolve;
        let reject;
        owner.release = new Promise((accept, fail) => {
            resolve = accept;
            reject = fail;
        });
        owner.cancellation.abort();
        try {
            void Promise.resolve(owner.stop()).then(() => {
                owner.forget();
                resolve();
                return undefined;
            }, reject);
        }
        catch (error) {
            reject(error);
        }
        return owner.release;
    }
}
function withSubscriptionId(message, subscriptionId) {
    return "payload" in message
        ? { ...message, payload: { ...message.payload, subscriptionId } }
        : { ...message, subscriptionId };
}
// COMPAT(ownedSubscriptions): added in v0.8.0, remove after 2027-03-09 once client floor >= v0.8.0.
function legacyMessage(message) {
    if (message.type === "terminals_changed") {
        const { workspaceId: _workspaceId, ...payload } = message.payload;
        return { ...message, payload };
    }
    if (message.type !== "subscribe_terminal_response" &&
        message.type !== "session.events.set_subscription.response" &&
        message.type !== "agent.timeline.set_subscription.response" &&
        message.type !== "workspace.label.list.response")
        return message;
    if (!("subscriptionId" in message.payload))
        return message;
    const { subscriptionId: _subscriptionId, ...payload } = message.payload;
    return { ...message, payload };
}
//# sourceMappingURL=index.js.map