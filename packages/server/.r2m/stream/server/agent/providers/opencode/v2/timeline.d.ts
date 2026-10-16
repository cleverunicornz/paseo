import type { SessionMessageInfo } from "@opencode/client";
import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
export declare class V2Timeline {
    private readonly includeClientMessageId;
    private readonly content;
    private readonly streams;
    resetStreams(): void;
    startPart(part: TextPartIdentity): void;
    constructor(includeClientMessageId?: boolean);
    delta(event: TextPartDelta): AgentStreamEvent | null;
    messages(messages: SessionMessageInfo[]): AgentStreamEvent[];
    private userMessage;
    private assistantMessage;
    private structuredOutputPart;
    private textPart;
    private toolPart;
    private compactionMessage;
}
interface TextPartIdentity {
    assistantMessageID: string;
    type: "text" | "reasoning";
    ordinal: number;
}
interface TextPartDelta extends TextPartIdentity {
    delta: string;
}
export {};
//# sourceMappingURL=timeline.d.ts.map