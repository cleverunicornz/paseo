import { type AgentPromptInput, type AgentRunOptions, type AgentRunResult, type AgentStreamEvent, type AgentTimelineItem } from "../agent-sdk-types.js";
export type ProviderFinalTextReducer = (params: {
    current: string;
    item: AgentTimelineItem;
}) => string;
export interface ProviderTurnRunner {
    startTurn: (prompt: AgentPromptInput, options?: AgentRunOptions) => Promise<{
        turnId: string;
    }>;
    subscribe: (callback: (event: AgentStreamEvent) => void) => () => void;
    getSessionId: () => string | Promise<string>;
}
export interface RunProviderTurnOptions extends ProviderTurnRunner {
    prompt: AgentPromptInput;
    runOptions?: AgentRunOptions;
    reduceFinalText?: ProviderFinalTextReducer;
}
export declare function runProviderTurn({ prompt, runOptions, startTurn, subscribe, getSessionId, reduceFinalText, }: RunProviderTurnOptions): Promise<AgentRunResult>;
export declare function replaceFinalTextWithAssistantMessage({ current, item, }: {
    current: string;
    item: AgentTimelineItem;
}): string;
export declare function appendOrReplaceGrowingAssistantMessage({ current, item, }: {
    current: string;
    item: AgentTimelineItem;
}): string;
//# sourceMappingURL=provider-runner.d.ts.map