import type pino from "pino";
import type { ScriptStatusUpdateMessage, SessionOutboundMessage, StartWorkspaceScriptRequest, WorkspaceDescriptorPayload, WorkspaceScriptPayload } from "../../messages.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { ServiceProxySubsystem } from "../../service-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "../../workspace-script-runtime-store.js";
import type { ScriptHealthState } from "../../script-health-monitor.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord, ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import type { SpawnWorkspaceScriptOptions, WorktreeScriptResult } from "../../worktree-bootstrap.js";
import type { PaseoServicePortAllocation } from "@getpaseo/protocol/paseo-config-schema";
type WorkspaceScriptsPayload = WorkspaceDescriptorPayload["scripts"];
/**
 * The service-proxy-backed scripts a workspace exposes: build the scripts payload
 * snapshot, publish a script_status_update to every client, and start a script.
 *
 * The workspace descriptor builder, the script-status emission path, and the
 * start-script RPC all funnel through one assembly of buildWorkspaceScriptPayloads'
 * inputs and one "scripts available on this daemon?" guard, instead of duplicating
 * that assembly and guard across the session.
 */
export interface WorkspaceScriptsService {
    buildSnapshot(workspace: PersistedWorkspaceRecord, project?: PersistedProjectRecord | null): WorkspaceScriptsPayload;
    emitStatusUpdate(workspaceId: string, workspaceDirectory: string): Promise<void>;
    list(workspaceId: string): Promise<WorkspaceScriptPayload[]>;
    launch(input: {
        workspaceId: string;
        scriptName: string;
    }): Promise<WorkspaceScriptPayload>;
    stop(input: {
        workspaceId: string;
        scriptName: string;
    }): Promise<WorkspaceScriptPayload>;
    start(request: StartWorkspaceScriptRequest): Promise<void>;
}
type WorkspaceScriptsGitSource = Pick<WorkspaceGitService, "peekSnapshot">;
export declare function createWorkspaceScriptsService(deps: {
    serviceProxy: ServiceProxySubsystem | null;
    scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
    terminalManager: TerminalManager | null;
    workspaceRegistry: Pick<WorkspaceRegistry, "get">;
    projectRegistry: Pick<ProjectRegistry, "get">;
    workspaceGitService: WorkspaceScriptsGitSource;
    getDaemonTcpPort: (() => number | null) | null;
    getDaemonTcpHost: (() => string | null) | null;
    serviceProxyPublicBaseUrl: string | null;
    resolveScriptHealth: ((hostname: string) => ScriptHealthState | null) | null;
    globalServicePorts?: PaseoServicePortAllocation;
    logger: pino.Logger;
    emit: (message: SessionOutboundMessage) => void;
    publishStatusUpdate: (message: ScriptStatusUpdateMessage) => void;
    spawnWorkspaceScript: (options: SpawnWorkspaceScriptOptions) => Promise<WorktreeScriptResult>;
    assertAutomationAllowed: (workspaceId: string) => Promise<void>;
}): WorkspaceScriptsService;
export {};
//# sourceMappingURL=workspace-scripts-service.d.ts.map