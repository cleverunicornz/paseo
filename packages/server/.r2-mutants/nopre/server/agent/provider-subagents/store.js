import { limitAgentTimelineItemContent } from "../agent-timeline-content.js";
import { InMemoryAgentTimelineStore } from "../agent-timeline-store.js";
function storeKey(parentAgentId, subagentId) {
    return `${parentAgentId}\0${subagentId}`;
}
/**
 * Sticky upsert semantics for a descriptor field: an omitted value preserves what is stored, an
 * explicit `null` clears it. Providers observe these fields incrementally, so a partial upsert
 * must never blank fields it says nothing about.
 */
function stickyField(next, previous) {
    return next === undefined ? (previous ?? null) : next;
}
export class ProviderSubagentStore {
    constructor() {
        this.descriptors = new Map();
        this.timelines = new InMemoryAgentTimelineStore();
    }
    apply(parentAgentId, provider, event) {
        const key = storeKey(parentAgentId, event.id);
        if (event.type === "remove") {
            this.descriptors.delete(key);
            this.timelines.delete(key);
            return { type: "remove", parentAgentId, subagentId: event.id };
        }
        if (event.type === "timeline") {
            if (!this.timelines.has(key)) {
                this.timelines.initialize(key);
            }
            const row = this.timelines.append(key, limitAgentTimelineItemContent(event.item), {
                timestamp: event.timestamp,
            });
            return {
                type: "timeline",
                parentAgentId,
                subagentId: event.id,
                provider,
                row,
                epoch: this.timelines.getEpoch(key),
            };
        }
        const previous = this.descriptors.get(key);
        if (!this.timelines.has(key)) {
            this.timelines.initialize(key);
        }
        const timestamp = event.timestamp ?? new Date().toISOString();
        const subagent = {
            id: event.id,
            parentAgentId,
            provider,
            title: stickyField(event.title, previous?.title),
            description: stickyField(event.description, previous?.description),
            status: event.status ?? previous?.status ?? "running",
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
            toolCallId: stickyField(event.toolCallId, previous?.toolCallId),
            cwd: stickyField(event.cwd, previous?.cwd),
            subtitle: stickyField(event.subtitle, previous?.subtitle),
            parentSubagentId: stickyField(event.parentSubagentId, previous?.parentSubagentId),
        };
        this.descriptors.set(key, subagent);
        return { type: "upsert", subagent };
    }
    list(parentAgentId) {
        return [...this.descriptors.values()]
            .filter((subagent) => subagent.parentAgentId === parentAgentId)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    listAll() {
        return [...this.descriptors.values()];
    }
    get(parentAgentId, subagentId) {
        return this.descriptors.get(storeKey(parentAgentId, subagentId)) ?? null;
    }
    fetchTimeline(parentAgentId, subagentId, options) {
        return this.timelines.fetch(storeKey(parentAgentId, subagentId), options);
    }
    deleteParent(parentAgentId) {
        const events = [];
        for (const subagent of this.list(parentAgentId)) {
            const key = storeKey(parentAgentId, subagent.id);
            this.descriptors.delete(key);
            this.timelines.delete(key);
            events.push({ type: "remove", parentAgentId, subagentId: subagent.id });
        }
        return events;
    }
}
//# sourceMappingURL=store.js.map