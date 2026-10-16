import type { Logger } from "pino";
import type { SessionOutboundMessage, WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import type { PaseoConfig } from "@getpaseo/protocol/paseo-config-schema";
import type { ScriptHealthEntry, ScriptHealthState } from "./script-health-monitor.js";
import type { ServiceProxySubsystem } from "./service-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
interface SessionEmitter {
    emit(message: SessionOutboundMessage): void;
}
interface BuildWorkspaceScriptPayloadsOptions {
    workspaceId: string;
    workspaceDirectory: string;
    paseoConfig: PaseoConfig | null;
    serviceProxy: ServiceProxySubsystem;
    runtimeStore: WorkspaceScriptRuntimeStore;
    daemonPort: number | null;
    serviceProxyPublicBaseUrl?: string | null;
    gitMetadata?: {
        projectSlug: string;
        currentBranch: string | null;
    };
    resolveHealth?: (hostname: string) => ScriptHealthState | null;
}
export declare function readPaseoConfigForProjection(workspaceDirectory: string, logger: Logger): PaseoConfig | null;
export declare function buildWorkspaceScriptPayloads(options: BuildWorkspaceScriptPayloadsOptions): WorkspaceScriptPayload[];
export declare function createScriptStatusEmitter({ sessions, serviceProxy, runtimeStore, daemonPort, serviceProxyPublicBaseUrl, resolveWorkspaceDirectory, logger, }: {
    sessions: () => SessionEmitter[];
    serviceProxy: ServiceProxySubsystem;
    runtimeStore: WorkspaceScriptRuntimeStore;
    daemonPort: number | null | (() => number | null);
    serviceProxyPublicBaseUrl?: string | null;
    resolveWorkspaceDirectory: (workspaceId: string) => string | null | Promise<string | null>;
    logger: Logger;
}): (workspaceId: string, scripts: ScriptHealthEntry[]) => void;
export {};
//# sourceMappingURL=script-status-projection.d.ts.map