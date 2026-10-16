import type { OmpAgentMessage, OmpModel, OmpPromptAck, OmpRpcHostToolDefinition, OmpRpcHostToolResult, OmpRpcHostToolUpdate, OmpRpcSlashCommand, OmpRuntimeEvent, OmpSessionState, OmpSessionStats, OmpSubagentSubscriptionLevel, OmpThinkingLevel } from "./rpc-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
export interface OmpRuntimeLaunch {
    cwd: string;
    argv: string[];
    env?: Record<string, string>;
    protocolMode?: "rpc" | "rpc-ui";
    model?: string;
    thinkingOptionId?: string;
    modeId?: string;
    session?: string;
    noSession?: boolean;
    systemPrompt?: string;
    extraArgs?: string[];
}
export interface OmpStartSessionInput {
    cwd: string;
    signal?: AbortSignal;
    env?: Record<string, string>;
    protocolMode?: "rpc" | "rpc-ui";
    model?: string;
    thinkingOptionId?: string;
    modeId?: string;
    session?: string;
    noSession?: boolean;
    systemPrompt?: string;
    extraArgs?: string[];
}
export interface OmpRuntimeSession {
    readonly environment: Record<string, string>;
    onEvent(callback: (event: OmpRuntimeEvent) => void): () => void;
    prompt(message: string, images?: Array<{
        type: "image";
        data: string;
        mimeType: string;
    }>): Promise<OmpPromptAck>;
    compact(customInstructions?: string): Promise<void>;
    setAutoCompaction(enabled: boolean): Promise<void>;
    abort(): Promise<void>;
    getState(): Promise<OmpSessionState>;
    setFastMode(enabled: boolean): Promise<{
        enabled: boolean;
        active: boolean;
    }>;
    getMessages(): Promise<OmpAgentMessage[]>;
    getAvailableModels(timeoutMs?: number | null): Promise<OmpModel[]>;
    setModel(provider: string, modelId: string): Promise<OmpModel>;
    setThinkingLevel(level: OmpThinkingLevel): Promise<void>;
    getSessionStats(): Promise<OmpSessionStats>;
    getCommands(): Promise<OmpRpcSlashCommand[]>;
    setSubagentSubscription(level: OmpSubagentSubscriptionLevel): Promise<void>;
    setHostTools(tools: OmpRpcHostToolDefinition[]): Promise<string[]>;
    sendHostToolResult(result: OmpRpcHostToolResult): void;
    sendHostToolUpdate(update: OmpRpcHostToolUpdate): void;
    branch(entryId: string): Promise<{
        text: string;
    }>;
    getBranchMessages(): Promise<Array<{
        entryId: string;
        text: string;
    }>>;
    activeBranchEntryId?: string;
    steer(message: string, images?: Array<{
        type: "image";
        data: string;
        mimeType: string;
    }>): Promise<void>;
    followUp(message: string, images?: Array<{
        type: "image";
        data: string;
        mimeType: string;
    }>): void;
    handoff(customInstructions?: string): Promise<void>;
    respondToExtensionUiRequest(id: string, response: {
        value?: string;
        confirmed?: boolean;
        cancelled?: boolean;
    }): void;
    cancelExtensionUiRequest(id: string): void;
    close(): Promise<void>;
}
export interface OmpRuntime {
    startSession(input: OmpStartSessionInput): Promise<OmpRuntimeSession>;
}
export declare function buildOmpLaunch(input: {
    command: [string, ...string[]];
    runtimeSettings?: ProviderRuntimeSettings;
    session: OmpStartSessionInput;
}): OmpRuntimeLaunch;
//# sourceMappingURL=runtime.d.ts.map