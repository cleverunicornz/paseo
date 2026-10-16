import type { Logger } from "pino";
import type { AgentModelDefinition } from "../agent-sdk-types.js";
import { type ACPCatalogModelResolverContext } from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
interface KimiACPAgentClientOptions {
    logger: Logger;
    command: [string, ...string[]];
    env?: Record<string, string>;
    providerId?: string;
    label?: string;
}
export declare function resolveKimiCatalogModels({ connection, sessionId, models, configOptions, runRequest, transformConfigOptions, logger, provider, }: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]>;
export declare class KimiACPAgentClient extends GenericACPAgentClient {
    constructor(options: KimiACPAgentClientOptions);
}
export {};
//# sourceMappingURL=kimi-acp-agent.d.ts.map