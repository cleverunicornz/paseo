import type { Logger } from "pino";
import { type ProviderRegistration } from "@getpaseo/plugin/server/provider";
import type { AgentClient } from "./agent-sdk-types.js";
import type { RegisteredProviderDefinition } from "./provider-registry.js";
/** Owns the complete plugin-provider adaptation behind the existing core provider boundary. */
export declare class PluginAgentClientRegistry {
    private readonly logger;
    private readonly providers;
    constructor(logger: Logger);
    replace(registrations: readonly ProviderRegistration[]): void;
    definitions(): Record<string, RegisteredProviderDefinition>;
    clients(): Record<string, AgentClient>;
    has(provider: string): boolean;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=plugin-provider.d.ts.map