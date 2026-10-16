import type { PiAgentMessage, PiModel, PiPromptAck, PiRpcSlashCommand, PiRuntimeEvent, PiSessionState, PiSessionStats } from "./rpc-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
export interface PiRuntimeLaunch {
    cwd: string;
    argv: string[];
    env?: Record<string, string>;
    protocolMode?: "rpc" | "rpc-ui";
    model?: string;
    thinkingOptionId?: string;
    modeId?: string;
    session?: string;
    noSession?: boolean;
    mcpConfigPath?: string;
    extensionPaths?: string[];
    extraArgs?: string[];
}
export interface PiStartSessionInput {
    cwd: string;
    signal?: AbortSignal;
    env?: Record<string, string>;
    protocolMode?: "rpc" | "rpc-ui";
    model?: string;
    thinkingOptionId?: string;
    modeId?: string;
    session?: string;
    noSession?: boolean;
    mcpConfigPath?: string;
    extensionPaths?: string[];
    extraArgs?: string[];
}
export interface PiRuntimeSession {
    readonly environment: Record<string, string>;
    onEvent(callback: (event: PiRuntimeEvent) => void): () => void;
    prompt(message: string, images?: Array<{
        type: "image";
        data: string;
        mimeType: string;
    }>): Promise<PiPromptAck>;
    steer(message: string, images?: Array<{
        type: "image";
        data: string;
        mimeType: string;
    }>): Promise<void>;
    clearQueue(): Promise<void>;
    compact(customInstructions?: string): Promise<void>;
    setAutoCompaction(enabled: boolean): Promise<void>;
    abort(): Promise<void>;
    getState(): Promise<PiSessionState>;
    getMessages(): Promise<PiAgentMessage[]>;
    getAvailableModels(timeoutMs?: number | null): Promise<PiModel[]>;
    setModel(provider: string, modelId: string): Promise<PiModel>;
    setThinkingLevel(level: string): Promise<void>;
    getSessionStats(): Promise<PiSessionStats>;
    getCommands(): Promise<PiRpcSlashCommand[]>;
    request(command: {
        type: string;
        [key: string]: unknown;
    }, timeoutMs?: number | null): Promise<unknown>;
    sendRawFrame(frame: object & {
        type: string;
    }): void;
    respondToExtensionUiRequest(id: string, response: {
        value?: string;
        confirmed?: boolean;
        cancelled?: boolean;
    }): void;
    cancelExtensionUiRequest(id: string): void;
    close(): Promise<void>;
}
export interface PiRuntime {
    startSession(input: PiStartSessionInput): Promise<PiRuntimeSession>;
}
export declare function buildPiLaunch(input: {
    command: [string, ...string[]];
    runtimeSettings?: ProviderRuntimeSettings;
    session: PiStartSessionInput;
}): PiRuntimeLaunch;
//# sourceMappingURL=runtime.d.ts.map