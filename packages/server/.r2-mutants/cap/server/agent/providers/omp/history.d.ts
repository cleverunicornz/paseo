import type { AgentProvider, AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";
import type { OmpRuntimeSession } from "./runtime.js";
import type { OmpBridgedToolIdentity } from "./mcp-bridge.js";
interface OmpSessionEntry {
    type?: string;
    id?: string;
    parentId?: string | null;
    timestamp?: string | number;
    message?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare function readOmpHistoryTodoState(sessionFile: string): Promise<AgentTimelineItem | null>;
export declare function streamOmpHistory(input: {
    sessionFile?: string;
    runtimeSession?: OmpRuntimeSession;
    provider: AgentProvider;
    bridgedTools?: ReadonlyMap<string, OmpBridgedToolIdentity>;
    visitedSessionFiles?: Set<string>;
}): AsyncGenerator<AgentStreamEvent>;
export declare function readActiveOmpEntryChain(sessionFile: string, activeEntryId?: string): Promise<OmpSessionEntry[]>;
export {};
//# sourceMappingURL=history.d.ts.map