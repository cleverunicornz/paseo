import type { PluginRegistries } from "@getpaseo/protocol/plugin-registry";
import express from "express";
import type { Logger } from "pino";
export type ListenTarget = {
    type: "tcp";
    host: string;
    port: number;
} | {
    type: "socket";
    path: string;
} | {
    type: "pipe";
    path: string;
};
export declare function parseListenString(listen: string): ListenTarget;
export declare function formatListenTarget(listenTarget: ListenTarget | null): string | null;
export declare function fanOutReconciledWorkspaceUpdates(input: {
    sessions: Iterable<{
        syncWorkspaceGitObserversForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
        emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
    }>;
    workspaceIds: readonly string[];
    logger: Pick<Logger, "warn">;
}): Promise<void>;
import type { OpenAiSpeechProviderConfig } from "./speech/providers/openai/config.js";
import type { LocalSpeechProviderConfig } from "./speech/providers/local/config.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { type CliConfigOverrides } from "./config.js";
import { BrowserToolsBroker } from "./browser-tools/broker.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { PushNotificationSender } from "./push/index.js";
import type { AgentClient, AgentProvider } from "./agent/agent-sdk-types.js";
import type { AgentProfile, AgentSkillSelection, PluginSource, TerminalProfile } from "@getpaseo/protocol/messages";
import type { AgentProviderRuntimeSettingsMap, ProviderOverride } from "./agent/provider-launch-config.js";
import { type PersistedConfig } from "./persisted-config.js";
import { type ServiceProxySubsystem } from "./service-proxy.js";
import { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import { type ManagedProcessRegistry } from "./managed-processes/managed-processes.js";
import { type HostnamesConfig } from "./hostnames.js";
import { type DaemonAuthConfig } from "./auth.js";
import { type HubRelationshipClock, type HubRelationshipRetryPolicy } from "./hub/relationship-controller.js";
import { type HubRelationshipRemote } from "./hub/relationship-remote.js";
import { BuiltinPluginLoader } from "./plugins/builtin/index.js";
export declare function createTerminalActivityRouteHandler(terminalManager: TerminalManager): express.RequestHandler;
export type PaseoOpenAIConfig = OpenAiSpeechProviderConfig;
export type PaseoLocalSpeechConfig = LocalSpeechProviderConfig;
export interface PaseoSpeechSttLanguages {
    dictation: string;
    voice: string;
}
export interface PaseoSpeechConfig {
    providers: RequestedSpeechProviders;
    sttLanguages?: PaseoSpeechSttLanguages;
    local?: PaseoLocalSpeechConfig;
}
export type DaemonLifecycleIntent = {
    type: "shutdown";
    clientId: string;
    requestId: string;
    reason: string;
} | {
    type: "restart";
    clientId: string;
    requestId: string;
    reason: string;
};
export interface PaseoDaemonConfig {
    listen: string;
    paseoHome: string;
    daemonVersion?: string;
    desktopManaged?: boolean;
    worktreesRoot?: string;
    corsAllowedOrigins: string[];
    allowedHosts?: HostnamesConfig;
    hostnames?: HostnamesConfig;
    trustedProxies?: true | string[];
    mcpEnabled?: boolean;
    mcpInjectIntoAgents?: boolean;
    browserToolsEnabled?: boolean;
    git?: {
        maxProcessesPerSecond: number;
        maxProcessConcurrency: number;
        maxQueueDepth: number;
    };
    autoArchiveAfterMerge?: boolean;
    enableTerminalAgentHooks?: boolean;
    appendSystemPrompt?: string;
    terminalProfiles?: TerminalProfile[];
    agentProfiles?: AgentProfile[];
    skillSelection?: AgentSkillSelection;
    pluginsEnabled?: boolean;
    plugins?: Record<string, PluginSource>;
    pluginRegistries?: PluginRegistries;
    pluginRegistryUrl?: string;
    staticDir: string;
    mcpDebug: boolean;
    isDev?: boolean;
    agentClients: Partial<Record<AgentProvider, AgentClient>>;
    agentStoragePath: string;
    relayEnabled?: boolean;
    relayEnabledMutable?: boolean;
    relayEndpoint?: string;
    relayPublicEndpoint?: string;
    relayUseTls?: boolean;
    relayPublicUseTls?: boolean;
    serviceProxy?: {
        publicBaseUrl: string | null;
        standaloneListen: string | null;
    };
    webUi?: {
        enabled: boolean;
        distDir: string | null;
    };
    appBaseUrl?: string;
    auth?: DaemonAuthConfig;
    openai?: PaseoOpenAIConfig;
    speech?: PaseoSpeechConfig;
    voiceLlmProvider?: AgentProvider | null;
    voiceLlmProviderExplicit?: boolean;
    voiceLlmModel?: string | null;
    dictationFinalTimeoutMs?: number;
    downloadTokenTtlMs?: number;
    agentProviderSettings?: AgentProviderRuntimeSettingsMap;
    providerCatalogRefreshTimeoutMs?: number;
    metadataGeneration?: {
        providers?: Array<{
            provider: string;
            model?: string;
            thinkingOptionId?: string;
        }>;
    };
    providerOverrides?: Record<string, ProviderOverride>;
    log?: PersistedConfig["log"];
    onLifecycleIntent?: (intent: DaemonLifecycleIntent) => void;
    pushNotificationSender?: PushNotificationSender;
    managedProcesses?: ManagedProcessRegistry;
    configReload?: {
        env: NodeJS.ProcessEnv;
        cli?: CliConfigOverrides;
        overrideControlledPaths: string[];
        relayEnabledFallback: boolean;
        startupPersisted: PersistedConfig;
    };
}
export interface PaseoDaemon {
    config: PaseoDaemonConfig;
    agentManager: AgentManager;
    agentStorage: AgentStorage;
    terminalManager: TerminalManager;
    serviceProxy: ServiceProxySubsystem;
    scriptRuntimeStore: WorkspaceScriptRuntimeStore;
    browserToolsBroker: BrowserToolsBroker;
    start(): Promise<void>;
    stop(): Promise<void>;
    getListenTarget(): ListenTarget | null;
    getServerId(): string;
}
export interface PaseoDaemonDependencies {
    builtinPlugins?: BuiltinPluginLoader;
    hubRelationshipRemote?: HubRelationshipRemote;
    hubRelationshipClock?: HubRelationshipClock;
    hubRelationshipRetryPolicy?: HubRelationshipRetryPolicy;
    createHubDaemonId?: () => string;
    serverFeatureOverrides?: {
        daemonStatusRpc?: boolean;
        relayConfig?: boolean;
    };
}
export declare function createPaseoDaemon(config: PaseoDaemonConfig, rootLogger: Logger, dependencies?: PaseoDaemonDependencies): Promise<PaseoDaemon>;
//# sourceMappingURL=bootstrap.d.ts.map