import type { UsageScope } from "@getpaseo/plugin/server/usage";
import { type ProviderStatus, type ProviderStatusRequest } from "@getpaseo/plugin/server/provider";
import type { PluginBeforeRequests, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type pino from "pino";
import { type ProviderConnectRequest, type ProviderCatalogOptions, type ProviderConnection } from "@getpaseo/plugin/server/provider";
import type { PluginLogEntry } from "@getpaseo/protocol/messages";
import type { PluginRequirements } from "@getpaseo/protocol/messages";
import type { PluginProcessRequest, PluginProviderMetadata, PluginUsageSourceMetadata } from "./plugin-process-protocol.js";
import { PluginSessionSocket } from "./session-socket.js";
interface PluginOutputStream {
    on(event: "data", listener: (chunk: Buffer | string) => void): this;
}
interface PluginChild {
    connected: boolean;
    killed: boolean;
    stdout?: PluginOutputStream | null;
    stderr?: PluginOutputStream | null;
    send(message: PluginProcessRequest, callback?: (error: Error | null) => void): boolean;
    kill(signal?: NodeJS.Signals): boolean;
    disconnect(): void;
    on(event: "message", listener: (message: unknown) => void): this;
    on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}
interface PluginRuntimeDependencies {
    settingsDirectory?: string;
    onSettingsChanged?: (pluginId: string, settingsId: string) => void;
    spawnChild?: () => PluginChild;
    sessionHost?: PluginPaseoSessionHost;
}
export interface PluginPaseoSessionHost {
    attachPluginSocket(pluginId: string, socket: PluginSessionSocket): Promise<{
        closed: Promise<void>;
    }>;
}
export declare class PluginRuntime {
    private readonly daemonVersion;
    private readonly dependencies;
    private readonly plugins;
    private readonly pendingEvents;
    private readonly logTails;
    private readonly logger;
    private readonly spawnChild;
    private sessionHost;
    private readonly listeners;
    constructor(logger: pino.Logger, daemonVersion: string, dependencies?: PluginRuntimeDependencies);
    bindPaseoSessionHost(sessionHost: PluginPaseoSessionHost): void;
    subscribe(listener: (pluginId: string, error?: string) => void): () => void;
    startPlugin(pluginId: string, configuredPath: string, canPublish?: () => boolean): Promise<void>;
    startBuiltinPlugin(input: {
        id: string;
        directory: string;
    }): Promise<void>;
    validatePlugin(configuredPath: string): Promise<void>;
    stopPluginById(pluginId: string): Promise<boolean>;
    catalog(): Array<{
        id: string;
        clientBundle: string;
        requirements?: PluginRequirements;
    }>;
    getProviderRegistrations(pluginId: string): readonly PluginProviderMetadata[];
    getUsageSourceRegistrations(pluginId: string): readonly PluginUsageSourceMetadata[];
    fetchUsage(pluginId: string, sourceId: string, input: unknown): Promise<unknown>;
    discoverUsage(pluginId: string, sourceId: string, scope: UsageScope): Promise<unknown>;
    getProviderStatus(pluginId: string, providerId: string, request: ProviderStatusRequest): Promise<ProviderStatus>;
    connectProvider(pluginId: string, providerId: string, request: ProviderConnectRequest): Promise<ProviderConnection>;
    getLogs(pluginId: string): PluginLogEntry[];
    clearLogs(pluginId: string): void;
    invoke(pluginId: string, method: string, input: unknown): Promise<unknown>;
    emit<Name extends keyof PluginLifecycleEvents>(name: Name, event: PluginLifecycleEvents[Name]): void;
    drainEvents(): Promise<void>;
    before<Name extends keyof PluginBeforeRequests>(name: Name, input: PluginBeforeRequests[Name]): Promise<PluginBeforeRequests[Name]>;
    getProviderCatalogCacheKey(pluginId: string, providerId: string, options: ProviderCatalogOptions): Promise<string | undefined>;
    private request;
    stopAll(): Promise<void>;
    private loadDirectoryPlugin;
    private launchPlugin;
    /**
     * Frames still in flight belong to the closed session; only a fresh hello
     * means the child redialled and wants a new one. Attaching on the close
     * instead would leave a socket nobody speaks to until the host's hello
     * timeout closed it, and that close would attach another.
     */
    private routePluginFrame;
    private reattachPluginSession;
    /**
     * A published plugin whose process is still up. Anything else is either still
     * loading or being torn down, and must not get a new session.
     */
    private canReattachPluginSession;
    private handleChildMessage;
    private handleProviderMessage;
    private finishProviderConnect;
    private abandonProviderConnect;
    private sendProviderInput;
    private closeProviderConnection;
    private publishProviderEvent;
    private failProviderConnection;
    private trackAcceptedProviderInput;
    private handleMalformedChildMessage;
    private failRemoteProviderConnection;
    private rejectProviderSends;
    private handleChildClose;
    private stopPlugin;
    private rejectPending;
    private appendLog;
    private notify;
}
export {};
//# sourceMappingURL=runtime.d.ts.map