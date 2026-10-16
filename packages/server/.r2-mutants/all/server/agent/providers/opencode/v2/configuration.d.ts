import type { SessionInfo, PermissionRuleset } from "@opencode/client";
import type { V2Api } from "./api.js";
import type { AgentFeature, AgentLaunchContext, AgentSessionConfig } from "../../../agent-sdk-types.js";
export declare function features(config: AgentSessionConfig): AgentFeature[];
export declare function permissionRules(config: AgentSessionConfig): PermissionRuleset;
export declare function applyResumeOverrides(client: V2Api, info: SessionInfo, overrides?: Partial<AgentSessionConfig>): Promise<void>;
export declare function requiresDedicatedV2Server(config: AgentSessionConfig, launch?: AgentLaunchContext): boolean;
//# sourceMappingURL=configuration.d.ts.map