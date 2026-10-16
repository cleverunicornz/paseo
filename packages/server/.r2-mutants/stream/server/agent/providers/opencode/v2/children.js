import { V2Timeline } from "./timeline.js";
import { messages } from "./history.js";
export class SessionChildren {
    constructor(options) {
        this.options = options;
        this.children = new Map();
        this.childStates = new Map();
    }
    async observe(event) {
        if (event.type === "session.created" &&
            event.data.parentID &&
            (event.data.parentID === this.options.id || this.children.has(event.data.parentID))) {
            await this.reconcile(event.data.parentID);
        }
        if ("sessionID" in event.data &&
            typeof event.data.sessionID === "string" &&
            this.children.has(event.data.sessionID)) {
            await this.reconcileChild(await this.options.client().session.get({ sessionID: event.data.sessionID }));
        }
    }
    async reconcile(parentID) {
        let cursor;
        do {
            const page = await this.options.client().session.list({
                ...(cursor ? { cursor } : { parentID }),
                limit: 100,
            });
            for (const child of page.data) {
                await this.reconcileChild(child);
                await this.reconcile(child.id);
            }
            cursor = page.cursor.next ?? undefined;
        } while (cursor);
    }
    async reconcileChild(info) {
        await this.options.reconcilePermissions(info.id);
        let timeline = this.children.get(info.id);
        if (!timeline) {
            timeline = new V2Timeline();
            this.children.set(info.id, timeline);
            this.options.bindChild?.(info.id);
        }
        const active = await this.options.client().session.active();
        let status = "completed";
        if (active[info.id])
            status = "running";
        else if (info.outcome === "failed")
            status = "failed";
        else if (info.outcome === "interrupted")
            status = "canceled";
        const presentation = {
            type: "upsert",
            id: info.id,
            parentSubagentId: info.parentID === this.options.id ? null : info.parentID,
            title: info.title ?? null,
            status,
            cwd: info.location.directory,
            timestamp: new Date(info.time.updated).toISOString(),
        };
        const signature = JSON.stringify(presentation);
        if (this.childStates.get(info.id) !== signature) {
            this.childStates.set(info.id, signature);
            this.options.emit({ type: "provider_subagent", provider: "opencode", event: presentation });
        }
        for (const event of timeline.messages(await messages(this.options.client(), info.id))) {
            if (event.type === "timeline")
                this.options.emit({
                    type: "provider_subagent",
                    provider: "opencode",
                    event: { type: "timeline", id: info.id, item: event.item, timestamp: event.timestamp },
                });
        }
    }
}
//# sourceMappingURL=children.js.map