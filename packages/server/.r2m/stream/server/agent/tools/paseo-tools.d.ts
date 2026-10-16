import type { Logger } from "pino";
import type { AgentManager } from "../agent-manager.js";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
import type { AgentStorage } from "../agent-storage.js";
import { type ArchiveDependencies } from "../../workspace-archive-service.js";
import type { VoiceCallerContext, VoiceSpeakHandler } from "../../voice-types.js";
import type { FirstAgentContext } from "../../messages.js";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { CreatePaseoWorktreeWorkflowFn } from "../../worktree-session.js";
import type { ScheduleService } from "../../schedule/service.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import type { ForgeService } from "../../../services/forge-service.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { PersistedWorkspaceRecord, ProjectRegistry, WorkspaceRegistry } from "../../workspace-registry.js";
import type { WorkspaceScriptsService } from "../../session/workspace-scripts/workspace-scripts-service.js";
import type { BrowserToolsBroker } from "../../browser-tools/broker.js";
import type { PaseoToolCatalog } from "./types.js";
import type { ProviderPaseoToolsPolicy } from "@getpaseo/protocol/provider-config";
export interface PaseoToolHostDependencies {
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    terminalManager?: TerminalManager | null;
    getDaemonTcpPort?: () => number | null;
    scheduleService?: ScheduleService | null;
    providerSnapshotManager: ProviderSnapshotManager;
    daemonConfigStore?: Pick<DaemonConfigStore, "get">;
    github?: ForgeService;
    workspaceGitService?: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees" | "resolveRepoRoot">;
    findWorkspaceIdForCwd?: ArchiveDependencies["findWorkspaceIdForCwd"];
    listActiveWorkspaces?: ArchiveDependencies["listActiveWorkspaces"];
    archiveWorkspaceRecord?: ArchiveDependencies["archiveWorkspaceRecord"];
    emitWorkspaceUpdatesForWorkspaceIds?: ArchiveDependencies["emitWorkspaceUpdatesForWorkspaceIds"];
    workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "list" | "upsert">;
    projectRegistry?: Pick<ProjectRegistry, "get" | "list">;
    createDirectoryWorkspace?: (cwd: string, title?: string | null, projectId?: string) => Promise<PersistedWorkspaceRecord>;
    workspaceScripts?: Pick<WorkspaceScriptsService, "list" | "launch" | "stop">;
    markWorkspaceArchiving?: ArchiveDependencies["markWorkspaceArchiving"];
    clearWorkspaceArchiving?: ArchiveDependencies["clearWorkspaceArchiving"];
    createPaseoWorktree?: CreatePaseoWorktreeWorkflowFn;
    ensureWorkspaceForCreate?: (cwd: string, firstAgentContext?: FirstAgentContext) => Promise<string>;
    browserToolsEnabled?: boolean;
    browserToolsBroker?: BrowserToolsBroker | null;
    paseoToolPolicy?: ProviderPaseoToolsPolicy;
    paseoHome?: string;
    worktreesRoot?: string;
    /**
     * ID of the agent that is using this tool catalog.
     * Used for cwd/mode inheritance when agents spawn child agents.
     */
    callerAgentId?: string;
    /**
     * Optional resolver for session-bound speak handlers.
     * Used by hidden voice agents to narrate through daemon-managed TTS.
     */
    resolveSpeakHandler?: (callerAgentId: string) => VoiceSpeakHandler | null;
    resolveCallerContext?: (callerAgentId: string) => VoiceCallerContext | null;
    enableVoiceTools?: boolean;
    voiceOnly?: boolean;
    logger: Logger;
}
export declare function createPaseoToolCatalog(options: PaseoToolHostDependencies): PaseoToolCatalog;
//# sourceMappingURL=paseo-tools.d.ts.map