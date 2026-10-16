import type { ChildProcess } from "node:child_process";
import type { Logger } from "pino";
import { type SpawnProcessOptions } from "../../../../utils/spawn.js";
import { type ProcessTerminator } from "../../../../utils/tree-kill.js";
import type { ManagedProcessRegistry } from "../../../managed-processes/managed-processes.js";
import { type ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { OpenCodeEventConsumer, type OpenCodeEventConsumerFactory, type OpenCodeEventSource } from "./event-consumer.js";
/** Budget for the OpenCode HTTP server to become usable after spawn. */
export declare const OPENCODE_SERVER_STARTUP_TIMEOUT_MS = 30000;
/** One stalled SSE attempt plus enough time for the consumer's retry. */
export declare const OPENCODE_EVENT_STREAM_READY_TIMEOUT_MS = 45000;
export interface OpenCodeServerAcquisition {
    environment: Record<string, string>;
    server: {
        port: number;
        url: string;
    };
    events: OpenCodeEventSource;
    release: () => Promise<void>;
}
export interface OpenCodeServerManagerLike {
    acquireCurrent(signal?: AbortSignal): Promise<OpenCodeServerAcquisition>;
    acquireNew(signal?: AbortSignal): Promise<OpenCodeServerAcquisition>;
    acquireDedicated(env: Record<string, string>): Promise<OpenCodeServerAcquisition>;
    acquireExisting(url: string): OpenCodeServerAcquisition | null;
    shutdown(): Promise<void>;
}
export interface OpenCodeServerGeneration {
    environment: Record<string, string>;
    process: ChildProcess;
    port: number;
    url: string;
    refCount: number;
    retired: boolean;
    ready: Promise<void>;
    events: OpenCodeEventConsumer;
    managedProcessId?: string;
    managedProcessRecord?: Promise<{
        id: string;
    } | null>;
}
export type OpenCodePortAllocator = () => Promise<number>;
export type OpenCodeCommandPrefixResolver = () => Promise<{
    command: string;
    args: string[];
}>;
export type OpenCodeServerProcessSpawner = (command: string, args: string[], options: SpawnProcessOptions) => ChildProcess;
export interface OpenCodeServerManagerOptions {
    logger: Logger;
    baseEnv?: SpawnProcessOptions["baseEnv"];
    runtimeSettings?: ProviderRuntimeSettings;
    managedProcesses?: ManagedProcessRegistry;
    terminateProcess?: ProcessTerminator;
    portAllocator?: OpenCodePortAllocator;
    resolveCommandPrefix?: OpenCodeCommandPrefixResolver;
    resolveHomeDir?: () => string;
    spawnServerProcess?: OpenCodeServerProcessSpawner;
    createEventSource?: OpenCodeEventConsumerFactory;
    decorateServerEnv?: (env: Record<string, string>) => Record<string, string>;
}
export declare class OpenCodeServerManager implements OpenCodeServerManagerLike {
    private static instance;
    private static exitHandlerRegistered;
    private currentServer;
    private retiredServers;
    private startPromise;
    private newServerPromise;
    private readonly logger;
    private readonly baseEnv?;
    private readonly runtimeSettings?;
    private readonly runtimeSettingsKey;
    private readonly managedProcesses?;
    private readonly terminateProcess;
    private readonly portAllocator;
    private readonly resolveCommandPrefix;
    private readonly resolveHomeDir;
    private readonly spawnServerProcess;
    private readonly createEventSource;
    private readonly decorateServerEnv?;
    constructor(options: OpenCodeServerManagerOptions);
    static getInstance(logger: Logger, runtimeSettings?: ProviderRuntimeSettings, options?: Omit<OpenCodeServerManagerOptions, "logger" | "runtimeSettings">): OpenCodeServerManager;
    private static registerExitHandler;
    acquireCurrent(signal?: AbortSignal): Promise<OpenCodeServerAcquisition>;
    acquireNew(signal?: AbortSignal): Promise<OpenCodeServerAcquisition>;
    acquireDedicated(env: Record<string, string>): Promise<OpenCodeServerAcquisition>;
    acquireExisting(url: string): OpenCodeServerAcquisition | null;
    private findLiveServerByUrl;
    private isServerLive;
    private acquireServer;
    private releaseServer;
    private getNewServer;
    private getCurrentServer;
    private rotateCurrentServer;
    private startServer;
    shutdown(): Promise<void>;
    private cleanupRetiredServers;
    private killServer;
    private recordManagedServerProcess;
    private removeManagedProcessRecordWhenResolved;
    private removeManagedServerRecord;
    private removeManagedProcessId;
}
//# sourceMappingURL=server-manager.d.ts.map