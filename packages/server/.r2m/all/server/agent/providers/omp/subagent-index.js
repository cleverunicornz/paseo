import { OmpHistoryMapper } from "./message-history.js";
import { OMP_HISTORY_MAPPER_HOOKS } from "./history-hooks.js";
import { formatOmpSubagentTitle } from "./subagent-title.js";
export class OmpSubagentIndex {
    constructor() {
        this.statesByParent = new WeakMap();
    }
    handleLifecycle(parent, payload) {
        const state = this.stateFor(parent, payload.id, payload.agent);
        state.title = payload.agent || state.title;
        state.description = payload.description ?? state.description;
        state.toolCallId = payload.parentToolCallId ?? state.toolCallId;
        state.status = mapLifecycleStatus(payload.status);
        return [this.upsert(payload.id, state.status, state)];
    }
    handleProgress(parent, payload) {
        const id = payload.progress.id;
        const state = this.stateFor(parent, id, payload.agent);
        state.title = payload.agent || state.title;
        state.description = payload.progress.description ?? payload.assignment ?? state.description;
        if (payload.progress.resolvedModel?.trim()) {
            state.resolvedModel = payload.progress.resolvedModel;
        }
        state.toolCallId = payload.parentToolCallId ?? state.toolCallId;
        state.status = mapProgressStatus(payload.progress.status);
        return [this.upsert(id, state.status, state)];
    }
    handleEvent(parent, payload) {
        const state = this.stateFor(parent, payload.id, "OMP subagent");
        const messages = messagesFromSessionEvent(payload.event);
        return state.mapper.mapMessages(messages).flatMap((mapped) => mapped.type === "timeline"
            ? [
                {
                    type: "provider_subagent",
                    provider: "omp",
                    event: {
                        type: "timeline",
                        id: payload.id,
                        item: mapped.item,
                        ...(mapped.timestamp ? { timestamp: mapped.timestamp } : {}),
                    },
                },
            ]
            : []);
    }
    terminalizeRunning(parent) {
        const states = this.statesByParent.get(parent);
        if (!states) {
            return [];
        }
        const events = [];
        for (const [id, state] of states) {
            if (state.status !== "running") {
                continue;
            }
            state.status = "canceled";
            events.push(this.upsert(id, state.status, state));
        }
        return events;
    }
    clear(parent) {
        this.statesByParent.delete(parent);
    }
    stateFor(parent, id, title) {
        const states = this.statesByParent.get(parent) ?? new Map();
        const existing = states.get(id);
        if (existing)
            return existing;
        const state = {
            title,
            description: null,
            resolvedModel: null,
            toolCallId: null,
            status: "running",
            mapper: new OmpHistoryMapper("omp", [], OMP_HISTORY_MAPPER_HOOKS),
        };
        states.set(id, state);
        this.statesByParent.set(parent, states);
        return state;
    }
    upsert(id, status, state) {
        return {
            type: "provider_subagent",
            provider: "omp",
            event: {
                type: "upsert",
                id,
                title: formatOmpSubagentTitle(state.title, state.resolvedModel),
                description: state.description,
                status,
                toolCallId: state.toolCallId,
            },
        };
    }
}
function messagesFromSessionEvent(event) {
    if (event.type === "message_end")
        return [event.message];
    return [];
}
function mapLifecycleStatus(status) {
    if (status === "started")
        return "running";
    return status === "aborted" ? "canceled" : status;
}
function mapProgressStatus(status) {
    if (status === "completed" || status === "failed")
        return status;
    return status === "aborted" ? "canceled" : "running";
}
//# sourceMappingURL=subagent-index.js.map