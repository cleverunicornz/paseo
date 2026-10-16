import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AgentPromptInput } from "./agent-sdk-types.js";
export declare function buildAgentPrompt(text: string, images?: Array<{
    data: string;
    mimeType: string;
}>, attachments?: AgentAttachment[]): AgentPromptInput;
export declare function renderPromptAttachmentAsText(attachment: AgentAttachment): string;
export declare function buildAgentBranchNameSeed(firstAgentContext: {
    prompt?: string;
    attachments?: readonly AgentAttachment[];
} | undefined): string | undefined;
//# sourceMappingURL=prompt-attachments.d.ts.map