import type { Logger } from "pino";
import type { AgentModelDefinition } from "../agent-sdk-types.js";
import { type ACPCatalogModelResolverContext, type ACPConfigFeatureOption } from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
interface CursorACPAgentClientOptions {
    logger: Logger;
    command: [string, ...string[]];
    env?: Record<string, string>;
    providerId?: string;
    label?: string;
}
export declare const CURSOR_FAST_FEATURE_OPTION: ACPConfigFeatureOption;
export declare function resolveCursorCatalogModels({ connection, models, provider, runRequest, }: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]>;
export declare class CursorACPAgentClient extends GenericACPAgentClient {
    constructor(options: CursorACPAgentClientOptions);
}
export {};
//# sourceMappingURL=cursor-acp-agent.d.ts.map