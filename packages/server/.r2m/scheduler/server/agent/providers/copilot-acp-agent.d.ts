import type { Logger } from "pino";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AgentMode } from "../agent-sdk-types.js";
import { type ProviderRuntimeSettings } from "../provider-launch-config.js";
import { ACPAgentClient, type ACPConfigFeatureOption, type ACPBeforeModeWriteResult, type ACPProviderModeWriteResult, type ACPProviderModeWriterContext, type SessionStateResponse } from "./acp-agent.js";
export declare const COPILOT_ALLOW_ALL_MODE_ID = "allow-all";
export declare const COPILOT_AGENT_FEATURE_OPTION: ACPConfigFeatureOption;
export declare const COPILOT_MODES: AgentMode[];
interface CopilotACPAgentClientOptions {
    logger: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
}
export declare class CopilotACPAgentClient extends ACPAgentClient {
    constructor(options: CopilotACPAgentClientOptions);
    isAvailable(): Promise<boolean>;
    getDiagnostic(): Promise<{
        diagnostic: string;
    }>;
}
export declare function transformCopilotSessionResponse(response: SessionStateResponse): SessionStateResponse;
export declare function transformCopilotConfigOptions(configOptions: SessionConfigOption[]): SessionConfigOption[];
export declare function transformCopilotModeId(modeId: string): string | null;
export declare function writeCopilotProviderMode(context: ACPProviderModeWriterContext): Promise<ACPProviderModeWriteResult>;
export declare function beforeCopilotModeWriter(context: ACPProviderModeWriterContext): Promise<ACPBeforeModeWriteResult>;
export {};
//# sourceMappingURL=copilot-acp-agent.d.ts.map