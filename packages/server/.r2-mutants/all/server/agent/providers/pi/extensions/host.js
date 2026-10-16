import { mapPiChildSession, PiChildSessionFollower } from "./child-session.js";
export class PiExtensionHost {
    constructor(extensions, logger, hydrationByteBudget = Number.POSITIVE_INFINITY, readChildSession = mapPiChildSession) {
        this.logger = logger;
        this.readChildSession = readChildSession;
        this.sessions = [];
        this.followers = new Map();
        this.pollingExtensions = false;
        this.remainingHydrationBytes = hydrationByteBudget;
        for (const extension of extensions) {
            const adapter = this.safe(extension.id, "createSession", () => extension.createSession());
            if (adapter)
                this.sessions.push({ id: extension.id, adapter });
        }
    }
    /** Live sessions follow child files and adapter polls; replay hosts read each file once. */
    follow(onEvent) {
        this.onFollowEvent = onEvent;
        this.followTimer ?? (this.followTimer = setInterval(() => {
            for (const [id, follower] of this.followers)
                void this.readFollower(id, follower);
            void this.pollExtensions();
        }, 250));
    }
    close() {
        if (this.followTimer)
            clearInterval(this.followTimer);
        this.followTimer = undefined;
        this.onFollowEvent = undefined;
        this.followers.clear();
    }
    readFollower(id, follower) {
        follower.pending = follower.pending
            .then(async () => {
            const events = await follower.reader.readNew();
            for (const event of events) {
                this.onFollowEvent?.({ type: "provider_subagent", provider: "pi", event });
            }
            return undefined;
        })
            .catch((error) => {
            this.logger?.warn({ err: error, operation: "follow", childId: id }, "Pi child follow failed");
        });
        return follower.pending;
    }
    async pollExtensions() {
        if (this.pollingExtensions || !this.onFollowEvent)
            return;
        this.pollingExtensions = true;
        try {
            for (const { id, adapter } of this.sessions) {
                const mapping = this.safe(id, "poll", () => adapter.poll?.());
                if (!mapping)
                    continue;
                const output = this.prepare(id, mapping);
                for (const event of output.events)
                    this.onFollowEvent?.(event);
                for (const event of await output.hydration)
                    this.onFollowEvent?.(event);
            }
        }
        finally {
            this.pollingExtensions = false;
        }
    }
    safe(id, operation, call) {
        try {
            return call();
        }
        catch (error) {
            this.logger?.warn({ err: error, extensionId: id, operation }, "Pi extension adapter failed");
            return undefined;
        }
    }
    mapToolCall(call) {
        for (const { id, adapter } of this.sessions) {
            const mapping = this.safe(id, "mapToolCall", () => adapter.mapToolCall?.(call));
            if (mapping) {
                const prepared = this.safe(id, "prepare", () => this.prepare(id, mapping));
                if (prepared)
                    return prepared;
            }
        }
        return undefined;
    }
    mapCustomMessage(message) {
        for (const { id, adapter } of this.sessions) {
            const mapping = this.safe(id, "mapCustomMessage", () => adapter.mapCustomMessage?.(message));
            if (mapping) {
                const prepared = this.safe(id, "prepare", () => this.prepare(id, mapping));
                if (prepared)
                    return prepared;
            }
        }
        return undefined;
    }
    mapRuntimeNotification(message) {
        for (const { id, adapter } of this.sessions) {
            const mapping = this.safe(id, "mapRuntimeNotification", () => adapter.mapRuntimeNotification?.(message));
            if (mapping) {
                const prepared = this.safe(id, "prepare", () => this.prepare(id, mapping));
                if (prepared)
                    return prepared;
            }
        }
        return undefined;
    }
    prepare(id, mapping) {
        const events = [
            ...("timeline" in mapping ? (mapping.timeline ?? []) : []).map((item) => ({ type: "timeline", provider: "pi", item })),
            ...(mapping.subagents ?? []).map((event) => ({ type: "provider_subagent", provider: "pi", event })),
        ];
        const hydration = (this.onFollowEvent ? this.followChildren(mapping) : this.readChildren(mapping)).catch((error) => {
            this.logger?.warn({ err: error, extensionId: id, operation: "hydrate" }, "Pi extension adapter failed");
            return [];
        });
        return { ...mapping, events, hydration };
    }
    async followChildren(mapping) {
        for (const { id, file } of mapping.childSessions ?? []) {
            if (!this.followers.has(id)) {
                this.followers.set(id, {
                    reader: new PiChildSessionFollower(id, file),
                    pending: Promise.resolve(),
                });
            }
        }
        const finished = (mapping.subagents ?? []).flatMap((event) => event.type === "upsert" && event.status && event.status !== "running" ? [event.id] : []);
        const reads = [
            ...new Set([...(mapping.childSessions ?? []).map(({ id }) => id), ...finished]),
        ].flatMap((id) => {
            const follower = this.followers.get(id);
            return follower ? [this.readFollower(id, follower)] : [];
        });
        for (const id of finished)
            this.followers.delete(id);
        await Promise.all(reads);
        return [];
    }
    async readChildren(mapping) {
        const groups = await Promise.all((mapping.childSessions ?? []).map(async ({ id, file }) => {
            const bytes = Math.min(this.remainingHydrationBytes, 2 * 1024 * 1024);
            if (bytes <= 0)
                return [];
            this.remainingHydrationBytes -= bytes;
            return (await this.readChildSession(id, file, bytes)).map((event) => ({ type: "provider_subagent", provider: "pi", event }));
        }));
        return groups.flat();
    }
    onToolStart(call, provider = "pi") {
        let request;
        for (const { id, adapter } of this.sessions) {
            const candidate = this.safe(id, "onToolStart", () => adapter.onToolStart?.(call, provider));
            request ?? (request = candidate);
        }
        return request;
    }
    onToolEnd(call) {
        for (const { id, adapter } of this.sessions) {
            this.safe(id, "onToolEnd", () => adapter.onToolEnd?.(call));
        }
    }
    mapDialog(dialog, provider) {
        for (const { id, adapter } of this.sessions) {
            const mapping = this.safe(id, "mapDialog", () => adapter.mapDialog?.(dialog, provider));
            if (mapping)
                return mapping;
        }
        return undefined;
    }
    respondToPermission(request, response) {
        for (const { id, adapter } of this.sessions) {
            const mapped = this.safe(id, "respondToPermission", () => adapter.respondToPermission?.(request, response));
            if (mapped)
                return mapped;
        }
        return undefined;
    }
}
//# sourceMappingURL=host.js.map