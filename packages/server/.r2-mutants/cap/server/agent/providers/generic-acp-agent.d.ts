import type { Logger } from "pino";
import { ACPAgentClient, type ACPCatalogModelResolver, type ACPClientCapabilityMeta, type ACPConfigFeatureOption, type ACPExtensionCommandsParser } from "./acp-agent.js";
interface GenericACPAgentClientOptions {
    logger: Logger;
    command: [string, ...string[]];
    env?: Record<string, string>;
    providerId?: string;
    label?: string;
    waitForInitialCommands?: boolean;
    initialCommandsWaitTimeoutMs?: number;
    diagnosticPhaseTimeoutMs?: number;
    clientCapabilityMeta?: ACPClientCapabilityMeta;
    configFeatureOptions?: ACPConfigFeatureOption[];
    extensionCommandsParser?: ACPExtensionCommandsParser;
    catalogModelResolver?: ACPCatalogModelResolver;
    now?: () => number;
}
export declare class GenericACPAgentClient extends ACPAgentClient {
    private readonly command;
    private readonly providerId?;
    private readonly label?;
    private readonly diagnosticPhaseTimeoutMs?;
    constructor(options: GenericACPAgentClientOptions);
    protected resolveLaunchCommand(): Promise<{
        command: string;
        args: string[];
    }>;
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
    private resolveConfiguredLaunch;
    private getACPProbeRowsForDiagnostic;
}
export interface CommandInvocation {
    command: string;
    args: string[];
}
export declare function buildVersionProbeCommand(command: [string, ...string[]]): CommandInvocation;
export {};
//# sourceMappingURL=generic-acp-agent.d.ts.map