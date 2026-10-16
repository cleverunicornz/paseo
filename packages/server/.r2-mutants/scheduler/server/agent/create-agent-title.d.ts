import type { FirstAgentContext } from "@getpaseo/protocol/messages";
export declare function resolveCreateAgentTitles(options: {
    configTitle?: string | null;
    initialPrompt?: string | null;
}): {
    explicitTitle: string | null;
    provisionalTitle: string | null;
};
export declare function resolveFirstAgentPromptTitle(firstAgentContext?: FirstAgentContext): string | null;
//# sourceMappingURL=create-agent-title.d.ts.map