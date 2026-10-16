import type { Logger } from "pino";
import type { AgentManager } from "./agent/agent-manager.js";
import type { AgentStorage } from "./agent/agent-storage.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import type { ForgeService } from "../services/forge-service.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { PersistedWorkspaceRecord, WorkspaceArchiveContext, WorkspaceRegistry } from "./workspace-registry.js";
export type ActiveWorkspaceRef = Pick<PersistedWorkspaceRecord, "workspaceId" | "cwd" | "kind" | "worktreeRoot" | "isPaseoOwnedWorktree" | "mainRepoRoot">;
export interface ArchiveDependencies {
    paseoHome?: string;
    paseoWorktreesBaseRoot?: string;
    github: ForgeService;
    workspaceGitService: Pick<WorkspaceGitService, "getSnapshot">;
    agentManager: Pick<AgentManager, "listAgents" | "getAgent" | "archiveAgent" | "archiveSnapshot">;
    agentStorage: Pick<AgentStorage, "listByWorkspace">;
    findWorkspaceIdForCwd: (cwd: string) => Promise<string | null>;
    getWorkspace?: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
    listActiveWorkspaces: () => Promise<ActiveWorkspaceRef[]>;
    archiveWorkspaceRecord: (workspaceId: string) => Promise<void>;
    emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
    markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
    clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
    killTerminalsForWorkspace: (workspaceId: string) => Promise<void>;
    stopWorkspaceSetup?: (workspaceId: string) => Promise<void>;
    assertWorkspaceAutomationAllowed?: (workspaceId: string) => Promise<void>;
    sessionLogger?: Logger;
}
export interface KillTerminalsForWorkspaceDependencies {
    detachTerminalStream?: (terminalId: string, options: {
        emitExit: boolean;
    }) => void;
    sessionLogger: Logger;
    terminalManager: TerminalManager | null;
}
export type ArchiveScope = {
    kind: "workspace";
    workspaceId: string;
} | {
    kind: "worktree";
    targetPath: string;
};
export interface ArchiveResult {
    archivedAgentIds: string[];
    archivedWorkspaceIds: string[];
    removedDirectory: boolean;
}
export interface ArchiveByScopeRequest {
    scope: ArchiveScope;
    requestId: string;
}
export declare function requireActiveWorkspaceForArchive(dependencies: Pick<ArchiveDependencies, "listActiveWorkspaces">, workspaceId: string): Promise<ActiveWorkspaceRef>;
export declare function resolveWorkspaceIdAtPath(dependencies: Pick<ArchiveDependencies, "findWorkspaceIdForCwd" | "listActiveWorkspaces">, targetPath: string): Promise<string | null>;
export declare function archiveByScope(dependencies: ArchiveDependencies, request: ArchiveByScopeRequest): Promise<ArchiveResult>;
export type ArchiveWorkspaceContentsDependencies = Pick<ArchiveDependencies, "agentManager" | "agentStorage" | "killTerminalsForWorkspace" | "sessionLogger">;
export declare function archiveWorkspaceContents(dependencies: ArchiveWorkspaceContentsDependencies, workspaceId: string): Promise<Set<string>>;
export declare function killTerminalsForWorkspace(dependencies: KillTerminalsForWorkspaceDependencies, workspaceId: string): Promise<void>;
export declare function archivePersistedWorkspaceRecord(input: {
    workspaceId: string;
    workspaceRegistry: Pick<WorkspaceRegistry, "get" | "archive">;
    archivedAt?: string;
    context?: WorkspaceArchiveContext;
}): Promise<PersistedWorkspaceRecord | null>;
//# sourceMappingURL=workspace-archive-service.d.ts.map