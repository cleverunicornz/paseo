import { randomUUID } from "node:crypto";
import { TimelineProjection, selectProjectedTimelinePage, } from "./timeline-projection.js";
const DEFAULT_TIMELINE_FETCH_LIMIT = 200;
function cloneRow(row) {
    return { ...row };
}
export class InMemoryAgentTimelineStore {
    constructor() {
        this.states = new Map();
    }
    has(agentId) {
        return this.states.has(agentId);
    }
    initialize(agentId, options) {
        const timestamp = options?.timestamp ?? new Date().toISOString();
        const rows = options?.rows?.length
            ? options.rows.map(cloneRow)
            : this.buildRowsFromItems(options?.items ?? [], options?.nextSeq ?? 1, timestamp);
        const nextSeq = rows.reduce((next, row) => Math.max(next, row.seq + 1), options?.nextSeq ?? 1);
        const projection = new TimelineProjection();
        for (const row of rows)
            projection.append(row);
        this.states.set(agentId, {
            epoch: options?.epoch ?? randomUUID(),
            projection,
            minSeq: projection.getRows()[0]?.seqStart ?? 0,
            nextSeq,
        });
    }
    delete(agentId) {
        this.states.delete(agentId);
    }
    getItems(agentId) {
        return this.requireState(agentId)
            .projection.getRows()
            .map((row) => row.item);
    }
    getRows(agentId) {
        return this.requireState(agentId).projection.getRows().map(cloneRow);
    }
    getSubmittedUserMessage(agentId, clientMessageId) {
        const row = this.requireState(agentId)
            .projection.getRows()
            .find((candidate) => candidate.item.type === "user_message" &&
            candidate.item.clientMessageId === clientMessageId);
        return row ? cloneRow(row) : null;
    }
    enrichSubmittedUserMessage(agentId, clientMessageId, providerMessageId) {
        return this.requireState(agentId).projection.enrichSubmittedUserMessage(clientMessageId, providerMessageId);
    }
    getEpoch(agentId) {
        return this.requireState(agentId).epoch;
    }
    fetch(agentId, options) {
        const state = this.requireState(agentId);
        const direction = options?.direction ?? "tail";
        const cursor = options?.cursor;
        const rows = state.projection.getRows();
        const window = { minSeq: state.minSeq, maxSeq: state.nextSeq - 1, nextSeq: state.nextSeq };
        const staleCursor = cursor !== undefined && cursor.epoch !== state.epoch;
        const gap = !staleCursor &&
            direction === "after" &&
            cursor !== undefined &&
            rows.length > 0 &&
            cursor.seq < state.minSeq - 1;
        const reset = staleCursor || gap;
        const page = selectProjectedTimelinePage({
            rows,
            bounds: window,
            direction: reset ? "tail" : direction,
            cursorSeq: cursor?.seq,
            limit: options?.limit ?? DEFAULT_TIMELINE_FETCH_LIMIT,
        });
        return {
            epoch: state.epoch,
            direction,
            reset,
            staleCursor,
            gap,
            window,
            hasOlder: page.hasOlder,
            hasNewer: page.hasNewer,
            startSeq: page.startSeq,
            endSeq: page.endSeq,
            rows: page.entries.map((entry) => Object.assign({ seq: entry.seqEnd }, entry)),
        };
    }
    append(agentId, item, options) {
        const state = this.requireState(agentId);
        const row = {
            seq: state.nextSeq,
            timestamp: options?.timestamp ?? new Date().toISOString(),
            item,
            ...(options?.turnId ? { turnId: options.turnId } : {}),
            ...(options?.providerMessageId ? { providerMessageId: options.providerMessageId } : {}),
        };
        state.nextSeq += 1;
        if (state.minSeq === 0)
            state.minSeq = row.seq;
        state.projection.append(row);
        return cloneRow(row);
    }
    getLastItem(agentId) {
        const state = this.requireState(agentId);
        return state.projection.getRows().find((row) => row.seqEnd === state.nextSeq - 1)?.item ?? null;
    }
    getLastAssistantMessage(agentId) {
        const row = this.requireState(agentId)
            .projection.getRows()
            .findLast((candidate) => candidate.item.type === "assistant_message");
        return row?.item.type === "assistant_message" ? row.item.text : null;
    }
    requireState(agentId) {
        const state = this.states.get(agentId);
        if (!state) {
            throw new Error(`Unknown agent '${agentId}'`);
        }
        return state;
    }
    buildRowsFromItems(items, startSeq, timestamp) {
        let nextSeq = startSeq;
        return items.map((item) => {
            const row = {
                seq: nextSeq,
                timestamp,
                item,
            };
            nextSeq += 1;
            return row;
        });
    }
}
//# sourceMappingURL=agent-timeline-store.js.map