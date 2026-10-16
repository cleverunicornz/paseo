import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMetadata, AgentStreamEvent } from "../../agent-sdk-types.js";
export declare class ClaudeSidechainTracker {
    private readonly activeSidechains;
    private readonly getToolInput;
    private readonly isDescriptorOwnedElsewhere;
    private readonly needsSyntheticParentToolCard;
    constructor(input: {
        getToolInput: (toolUseId: string) => AgentMetadata | null | undefined;
        /**
         * When the provider learns subagent identity and status declaratively, this tracker stops
         * emitting descriptor upserts and maps frames to timeline items only. Two owners writing the
         * same descriptor from different evidence is how the live and replay paths drifted apart.
         */
        isDescriptorOwnedElsewhere?: () => boolean;
        needsSyntheticParentToolCard?: (toolUseId: string) => boolean;
    });
    handleMessage(message: SDKMessage, parentToolUseId: string): AgentStreamEvent[];
    finishAll(status: "completed" | "failed" | "canceled"): AgentStreamEvent[];
    finish(id: string, status: "completed" | "failed" | "canceled"): AgentStreamEvent[];
    delete(toolUseId: string): void;
    clear(): void;
    private extractSubAgentTimelineItems;
    private extractSubAgentToolResults;
    private updateSubAgentContextFromTaskInput;
    private normalizeSubAgentText;
    private extractAssistantMessageActions;
    private extractStreamEventActions;
    private extractSubAgentActionCandidates;
    private extractToolActionCandidates;
    private appendSubAgentAction;
    private trimSubAgentTail;
    private rebuildSubAgentActionIndex;
    private deriveSubAgentActionSummary;
}
//# sourceMappingURL=sidechain-tracker.d.ts.map