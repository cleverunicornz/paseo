import type { Logger } from "pino";
import { GenericACPAgentClient } from "./generic-acp-agent.js";
interface TraeACPAgentClientOptions {
    logger: Logger;
    command: [string, ...string[]];
    env?: Record<string, string>;
    providerId?: string;
    label?: string;
}
export declare class TraeACPAgentClient extends GenericACPAgentClient {
    constructor(options: TraeACPAgentClientOptions);
}
export {};
//# sourceMappingURL=trae-acp-agent.d.ts.map