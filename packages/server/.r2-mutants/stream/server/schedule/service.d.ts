import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { type AgentRunController } from "../agent/agent-prompt.js";
import { type BoundCreateAgentCommand } from "../agent/create-agent/create.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../worktree-session.js";
import type { CreateScheduleInput, ScheduleExecutionResult, ScheduleRun, StoredSchedule, UpdateScheduleInput } from "@getpaseo/protocol/schedule/types";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";
export declare class ScheduleTargetGoneError extends Error {
    constructor(message: string);
}
type ScheduleAgentManager = Pick<AgentRunController, "getAgent" | "reloadAgentSession" | "tryRunOutOfBand" | "hasInFlightRun" | "replaceAgentRun" | "steerOrReplaceActiveTurn" | "streamAgent"> & Pick<AgentManager, "createAgent" | "getRegisteredProviderIds" | "hydrateTimelineFromProvider" | "resumeAgentFromPersistence" | "runAgent" | "waitForAgentEvent" | "waitForAgentClose">;
interface ScheduleWorkspaceCreateInput {
    cwd: string;
    firstAgentContext: FirstAgentContext;
}
export interface ScheduleServiceOptions {
    paseoHome: string;
    logger: Logger;
    agentManager: ScheduleAgentManager;
    agentStorage: AgentStorage;
    createAgent: BoundCreateAgentCommand;
    createDirectoryWorkspace: (input: ScheduleWorkspaceCreateInput) => Promise<PersistedWorkspaceRecord>;
    createPaseoWorktreeWorkspace: (input: ScheduleWorkspaceCreateInput) => Promise<CreatePaseoWorktreeWorkflowResult>;
    archiveWorkspace: (workspaceId: string) => Promise<void>;
    now?: () => Date;
    runner?: (schedule: StoredSchedule, runId: string) => Promise<ScheduleExecutionResult>;
}
export declare class ScheduleService {
    private readonly store;
    private readonly logger;
    private readonly agentManager;
    private readonly agentStorage;
    private readonly createAgent;
    private readonly createDirectoryWorkspace;
    private readonly createPaseoWorktreeWorkspace;
    private readonly archiveWorkspace;
    private readonly now;
    private readonly runner;
    private readonly runningScheduleIds;
    private tickTimer;
    constructor(options: ScheduleServiceOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    create(input: CreateScheduleInput): Promise<StoredSchedule>;
    private createScheduleRecord;
    private buildScheduleRecord;
    createOrReplace(input: CreateScheduleInput): Promise<StoredSchedule>;
    list(): Promise<StoredSchedule[]>;
    inspect(id: string): Promise<StoredSchedule>;
    logs(id: string): Promise<ScheduleRun[]>;
    pause(id: string): Promise<StoredSchedule>;
    resume(id: string): Promise<StoredSchedule>;
    update(input: UpdateScheduleInput): Promise<StoredSchedule>;
    delete(id: string): Promise<void>;
    completeForAgent(agentId: string): Promise<number>;
    private completeScheduleForAgent;
    runOnce(id: string): Promise<StoredSchedule>;
    tick(): Promise<void>;
    private completeScheduleIfDue;
    private recoverInterruptedRuns;
    private recoverInterruptedSchedule;
    private sweepOrphanedSchedules;
    private sweepOrphanedSchedule;
    private runSchedule;
    private appendRunningRun;
    private finishRun;
    private recordRunWorkspace;
    private executeSchedule;
    private createScheduleRunWorkspace;
    private assertNewAgentCwdDirectory;
}
export {};
//# sourceMappingURL=service.d.ts.map