import type { AgentSession } from "../agent-sdk-types.js";
export type RewindMode = "conversation" | "files" | "both";
export declare class RewindCapabilityError extends Error {
    constructor(mode: RewindMode);
}
export declare function invokeRewindCapability(session: AgentSession, input: {
    messageId: string;
    mode: RewindMode;
}): Promise<void>;
//# sourceMappingURL=rewind.d.ts.map