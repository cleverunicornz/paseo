import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import type { OmpSubagentEventPayload, OmpSubagentLifecyclePayload, OmpSubagentProgressPayload } from "./rpc-types.js";
export declare class OmpSubagentIndex {
    private readonly statesByParent;
    handleLifecycle(parent: object, payload: OmpSubagentLifecyclePayload): AgentStreamEvent[];
    handleProgress(parent: object, payload: OmpSubagentProgressPayload): AgentStreamEvent[];
    handleEvent(parent: object, payload: OmpSubagentEventPayload): AgentStreamEvent[];
    terminalizeRunning(parent: object): AgentStreamEvent[];
    clear(parent: object): void;
    private stateFor;
    private upsert;
}
//# sourceMappingURL=subagent-index.d.ts.map