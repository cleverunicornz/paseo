import type { Logger } from "pino";
import type { ACPExtensionCommandsParser } from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
interface KiroACPAgentClientOptions {
    logger: Logger;
    command: [string, ...string[]];
    env?: Record<string, string>;
    providerId?: string;
    label?: string;
}
export declare const parseKiroExtensionCommands: ACPExtensionCommandsParser;
export declare class KiroACPAgentClient extends GenericACPAgentClient {
    constructor(options: KiroACPAgentClientOptions);
}
export {};
//# sourceMappingURL=kiro-acp-agent.d.ts.map