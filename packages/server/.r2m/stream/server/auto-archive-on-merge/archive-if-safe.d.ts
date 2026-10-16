import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import { archiveByScope, type ActiveWorkspaceRef, killTerminalsForWorkspace } from "../workspace-archive-service.js";
import type { WorkspaceGitRuntimeSnapshot, WorkspaceGitServiceImpl } from "../workspace-git-service.js";
import type { ForgeService } from "../../services/forge-service.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { isPaseoOwnedWorktreeCwd } from "../../utils/worktree.js";
import type { WorkspaceArchiveContext } from "../workspace-registry.js";
export interface AutoArchiveArchiveOptions {
    paseoHome: string;
    paseoWorktreesBaseRoot?: string;
    daemonConfigStore: DaemonConfigStore;
    workspaceGitService: WorkspaceGitServiceImpl;
    github: ForgeService;
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    terminalManager: TerminalManager;
    findWorkspaceIdForCwd: (cwd: string) => Promise<string | null>;
    listActiveWorkspaces: () => Promise<ActiveWorkspaceRef[]>;
    getAutoArchivedChangeRequestUrl: (workspaceId: string) => Promise<string | null>;
    archiveWorkspaceRecord: (workspaceId: string, context?: WorkspaceArchiveContext) => Promise<void>;
    markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
    clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
    emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
}
export interface ArchiveIfSafeDependencies {
    archiveByScope: typeof archiveByScope;
    isPaseoOwnedWorktreeCwd: typeof isPaseoOwnedWorktreeCwd;
    killTerminalsForWorkspace: typeof killTerminalsForWorkspace;
}
export declare function archiveIfSafe(input: {
    workspaceId: string;
    snapshot: WorkspaceGitRuntimeSnapshot;
    options: AutoArchiveArchiveOptions;
    log: Logger;
    deps?: ArchiveIfSafeDependencies;
}): Promise<void>;
//# sourceMappingURL=archive-if-safe.d.ts.map