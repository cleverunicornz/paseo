import type { OpenCodeEvent, SessionInfo } from "@opencode/client";
import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import type { V2Api } from "./api.js";
interface UsageOptions {
    client(): V2Api;
    cwd: string;
    info(): SessionInfo;
    emit(event: AgentStreamEvent): void;
    reportError(error: unknown): void;
}
export declare class SessionUsage {
    private readonly options;
    private readonly limits;
    private reports;
    constructor(options: UsageOptions);
    observe(event: OpenCodeEvent): void;
    private report;
    private contextLimit;
}
export {};
//# sourceMappingURL=usage.d.ts.map