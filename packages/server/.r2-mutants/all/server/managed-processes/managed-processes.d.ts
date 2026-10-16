import type { Logger } from "pino";
import type { ProcessTerminator, TreeKillTarget } from "../../utils/tree-kill.js";
export interface ManagedProcessSnapshot {
    pid: number;
    commandLine: string | null;
    startedAt: string | null;
}
export type ManagedProcessInspection = {
    status: "alive";
    snapshot: ManagedProcessSnapshot;
} | {
    status: "not-found";
} | {
    status: "error";
    error: unknown;
};
export interface ManagedProcessTable {
    inspect(pid: number): Promise<ManagedProcessInspection>;
}
export interface ManagedProcessCommandRunner {
    exec(command: string, args: string[]): Promise<{
        stdout: string;
        stderr: string;
    }>;
}
export interface ManagedProcessOwner {
    provider: string;
    kind: string;
}
export interface ManagedProcessRecordInput {
    owner: ManagedProcessOwner;
    pid: number;
    command: string;
    args: string[];
    metadata?: Record<string, unknown>;
}
export interface ManagedProcessRecord extends ManagedProcessRecordInput {
    id: string;
    metadata: Record<string, unknown>;
    identity: {
        commandLine: string | null;
        startedAt: string | null;
    };
    createdAt: string;
}
export interface ManagedProcessReapResult {
    checked: number;
    dead: number;
    mismatched: number;
    removed: number;
    terminated: number;
    errors: Array<{
        id: string;
        message: string;
    }>;
}
export interface ManagedProcessRegistry {
    record(input: ManagedProcessRecordInput): Promise<ManagedProcessRecord>;
    remove(id: string): Promise<void>;
    list(): Promise<ManagedProcessRecord[]>;
    reapStale(): Promise<ManagedProcessReapResult>;
}
interface ManagedProcessRegistryOptions {
    paseoHome: string;
    processTable: ManagedProcessTable;
    terminateProcess: ProcessTerminator;
    logger: Logger;
}
export declare function createManagedProcessRegistry(options: ManagedProcessRegistryOptions): ManagedProcessRegistry;
export declare function createSystemManagedProcessTable(options?: {
    platform?: NodeJS.Platform;
    commandRunner?: ManagedProcessCommandRunner;
}): ManagedProcessTable;
export declare function createPidTarget(pid: number): TreeKillTarget;
export {};
//# sourceMappingURL=managed-processes.d.ts.map