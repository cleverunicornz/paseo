import type { Logger } from "pino";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { runWorktreeSetupCommands, type WorktreeConfig, type WorktreeSetupCommandResult } from "../utils/worktree.js";
import type { ServiceProxySubsystem } from "./service-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import type { AgentTimelineItem, ToolCallDetail } from "./agent/agent-sdk-types.js";
import type { PaseoServicePortAllocation } from "@getpaseo/protocol/paseo-config-schema";
export interface WorktreeBootstrapTerminalResult {
    name: string | null;
    command: string;
    status: "started" | "failed";
    terminalId: string | null;
    error: string | null;
}
export interface RunAsyncWorktreeBootstrapOptions {
    agentId: string;
    workspaceId: string;
    worktree: WorktreeConfig;
    workspaceCwd?: string;
    shouldBootstrap?: boolean;
    terminalManager: TerminalManager | null;
    appendTimelineItem: (item: AgentTimelineItem) => Promise<boolean>;
    emitLiveTimelineItem?: (item: AgentTimelineItem) => Promise<boolean>;
    logger?: Logger;
}
interface MiddleTruncationAccumulator {
    totalBytes: number;
    head: string;
    tail: string;
    truncated: boolean;
}
export type WorktreeSetupOutputAccumulator = MiddleTruncationAccumulator;
export interface WorktreeSetupProgressAccumulator {
    resultsByIndex: Map<number, WorktreeSetupCommandResult>;
    outputAccumulatorsByIndex: Map<number, WorktreeSetupOutputAccumulator>;
}
export declare function createWorktreeSetupOutputAccumulator(): WorktreeSetupOutputAccumulator;
export declare function appendWorktreeSetupOutputAccumulator(accumulator: WorktreeSetupOutputAccumulator, chunk: string): void;
export declare function createWorktreeSetupProgressAccumulator(): WorktreeSetupProgressAccumulator;
export declare function applyWorktreeSetupProgressEvent(accumulator: WorktreeSetupProgressAccumulator, event: Parameters<NonNullable<Parameters<typeof runWorktreeSetupCommands>[0]["onEvent"]>>[0]): void;
export declare function getWorktreeSetupProgressResults(accumulator: WorktreeSetupProgressAccumulator): WorktreeSetupCommandResult[];
export declare function buildWorktreeSetupDetail(input: {
    worktree: WorktreeConfig;
    results: WorktreeSetupCommandResult[];
    outputAccumulatorsByIndex?: Map<number, WorktreeSetupOutputAccumulator>;
}): Extract<ToolCallDetail, {
    type: "worktree_setup";
}>;
export declare function runWorktreeAutoTerminals(options: {
    workspaceId: string;
    worktree: WorktreeConfig;
    workspaceCwd: string;
    terminalManager: TerminalManager | null;
    logger?: Logger;
}): Promise<void>;
export declare function runAsyncWorktreeBootstrap(options: RunAsyncWorktreeBootstrapOptions): Promise<void>;
export interface WorktreeScriptResult {
    scriptName: string;
    hostname: string | null;
    port: number | null;
    terminalId: string;
}
export interface SpawnWorkspaceScriptOptions {
    repoRoot: string;
    workspaceId: string;
    projectSlug: string;
    branchName: string | null;
    scriptName: string;
    daemonPort?: number | null;
    daemonListenHost?: string | null;
    serviceProxyPublicBaseUrl?: string | null;
    serviceProxy: ServiceProxySubsystem;
    runtimeStore: WorkspaceScriptRuntimeStore;
    terminalManager: TerminalManager;
    globalServicePorts?: PaseoServicePortAllocation;
    logger?: Logger;
    onLifecycleChanged?: () => void;
}
export declare function spawnWorkspaceScript(options: SpawnWorkspaceScriptOptions): Promise<WorktreeScriptResult>;
export declare function teardownWorktreeScripts(options: {
    hostnames: string[];
    serviceProxy: Pick<ServiceProxySubsystem, "removeServiceRoutesByHostnames">;
    logger: Logger;
}): void;
export {};
//# sourceMappingURL=worktree-bootstrap.d.ts.map