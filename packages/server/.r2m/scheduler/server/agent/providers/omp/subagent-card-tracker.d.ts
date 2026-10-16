import type { ToolCallDetail } from "../../agent-sdk-types.js";
import type { OmpSubagentLifecyclePayload, OmpSubagentProgressPayload } from "./rpc-types.js";
export interface OmpSubagentCardTimer {
    readonly token: unknown;
}
export interface OmpSubagentCardScheduler {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): OmpSubagentCardTimer;
    clearTimeout(timer: OmpSubagentCardTimer): void;
}
export interface OmpSubagentCardTrackerOptions {
    scheduler?: OmpSubagentCardScheduler;
    emitToolCall?: (toolCallId: string) => boolean;
}
export declare function createOmpSubagentCardScheduler(): OmpSubagentCardScheduler;
export declare class OmpSubagentCardTracker {
    private readonly scheduler;
    private readonly emitToolCall;
    private readonly states;
    constructor(options: OmpSubagentCardTrackerOptions);
    handleLifecycle(payload: OmpSubagentLifecyclePayload, emitToolCall?: (toolCallId: string) => boolean): void;
    handleProgress(payload: OmpSubagentProgressPayload, emitToolCall?: (toolCallId: string) => boolean): void;
    detailFor(toolCallId: string, baseDetail: ToolCallDetail): ToolCallDetail;
    flush(toolCallId: string): void;
    delete(toolCallId: string): void;
    clear(): void;
    private upsertItem;
    private stateFor;
    private appendLine;
    private requestEmit;
    private emitNow;
}
//# sourceMappingURL=subagent-card-tracker.d.ts.map