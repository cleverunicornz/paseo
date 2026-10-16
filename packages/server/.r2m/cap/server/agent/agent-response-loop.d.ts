import { z } from "zod";
import type { AgentProvider, AgentSessionConfig } from "./agent-sdk-types.js";
import type { AgentManager } from "./agent-manager.js";
export interface StructuredGenerationLogger {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
}
export type JsonSchema = Record<string, unknown>;
export type AgentCaller = (prompt: string) => Promise<string>;
export declare class StructuredAgentResponseError extends Error {
    readonly lastResponse: string;
    readonly validationErrors: string[];
    constructor(message: string, options: {
        lastResponse: string;
        validationErrors: string[];
    });
}
export interface StructuredGenerationProvider {
    provider: AgentProvider;
    model?: string;
    thinkingOptionId?: string;
}
export interface StructuredGenerationAttempt {
    provider: AgentProvider;
    model: string | null;
    available: boolean;
    error: string | null;
}
export declare class StructuredAgentFallbackError extends Error {
    readonly attempts: StructuredGenerationAttempt[];
    constructor(attempts: StructuredGenerationAttempt[]);
}
export interface StructuredAgentResponseOptions<T> {
    caller: AgentCaller;
    prompt: string;
    schema: z.ZodType<T> | JsonSchema;
    maxRetries?: number;
    schemaName?: string;
}
export interface StructuredAgentGenerationOptions<T> {
    manager: AgentManager;
    agentConfig: AgentSessionConfig;
    agentId?: string;
    persistSession?: boolean;
    prompt: string;
    schema: z.ZodType<T> | JsonSchema;
    maxRetries?: number;
    schemaName?: string;
}
export interface StructuredAgentGenerationWithFallbackOptions<T> {
    manager: AgentManager;
    cwd: string;
    prompt: string;
    schema: z.ZodType<T> | JsonSchema;
    providers: readonly StructuredGenerationProvider[];
    agentConfigOverrides?: Omit<AgentSessionConfig, "provider" | "cwd" | "model" | "thinkingOptionId">;
    persistSession?: boolean;
    maxRetries?: number;
    schemaName?: string;
    logger?: StructuredGenerationLogger;
    runner?: <TResult>(options: StructuredAgentGenerationOptions<TResult>) => Promise<TResult>;
}
export { DEFAULT_STRUCTURED_GENERATION_PROVIDERS } from "./structured-generation-providers.js";
export declare function buildStructuredAgentResponsePrompt(options: {
    prompt: string;
    schema: z.ZodType | JsonSchema;
    schemaName?: string;
}): string;
export declare function getStructuredAgentResponse<T>(options: StructuredAgentResponseOptions<T>): Promise<T>;
export declare function generateStructuredAgentResponse<T>(options: StructuredAgentGenerationOptions<T>): Promise<T>;
export declare function generateStructuredAgentResponseWithFallback<T>(options: StructuredAgentGenerationWithFallbackOptions<T>): Promise<T>;
//# sourceMappingURL=agent-response-loop.d.ts.map