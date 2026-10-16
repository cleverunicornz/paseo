import { z } from "zod";
import type { AgentProviderRuntimeSettingsMap } from "./agent/provider-launch-config.js";
export declare const LogLevelSchema: z.ZodEnum<{
    error: "error";
    info: "info";
    fatal: "fatal";
    warn: "warn";
    debug: "debug";
    trace: "trace";
}>;
export declare const LogFormatSchema: z.ZodEnum<{
    json: "json";
    pretty: "pretty";
}>;
export declare const PersistedConfigSchema: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodLiteral<1>>;
    daemon: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        listen: z.ZodOptional<z.ZodString>;
        hostnames: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<true>, z.ZodArray<z.ZodString>]>>;
        allowedHosts: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<true>, z.ZodArray<z.ZodString>]>>;
        trustedProxies: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<true>, z.ZodArray<z.ZodString>]>>;
        mcp: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            injectIntoAgents: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>;
        browserTools: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>;
        git: z.ZodOptional<z.ZodObject<{
            maxProcessesPerSecond: z.ZodOptional<z.ZodNumber>;
            maxProcessConcurrency: z.ZodOptional<z.ZodNumber>;
            maxQueueDepth: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        autoArchiveAfterMerge: z.ZodOptional<z.ZodBoolean>;
        enableTerminalAgentHooks: z.ZodOptional<z.ZodBoolean>;
        appendSystemPrompt: z.ZodOptional<z.ZodString>;
        terminalProfiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            command: z.ZodString;
            args: z.ZodOptional<z.ZodArray<z.ZodString>>;
            icon: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>>;
        agentProfiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            icon: z.ZodOptional<z.ZodString>;
            color: z.ZodOptional<z.ZodString>;
            provider: z.ZodString;
            model: z.ZodOptional<z.ZodString>;
            modeId: z.ZodOptional<z.ZodString>;
            thinkingOptionId: z.ZodOptional<z.ZodString>;
            featureValues: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            notes: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>>;
        cors: z.ZodOptional<z.ZodObject<{
            allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>;
        relay: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            endpoint: z.ZodOptional<z.ZodString>;
            publicEndpoint: z.ZodOptional<z.ZodString>;
            useTls: z.ZodOptional<z.ZodBoolean>;
            publicUseTls: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>;
        serviceProxy: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            listen: z.ZodOptional<z.ZodString>;
            publicBaseUrl: z.ZodOptional<z.ZodURL>;
        }, z.core.$strict>>;
        auth: z.ZodOptional<z.ZodObject<{
            password: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodTransform<{
        listen?: string | undefined;
        hostnames?: true | string[] | undefined;
        trustedProxies?: true | string[] | undefined;
        mcp?: {
            [x: string]: unknown;
            enabled?: boolean | undefined;
            injectIntoAgents?: boolean | undefined;
        } | undefined;
        browserTools?: {
            [x: string]: unknown;
            enabled?: boolean | undefined;
        } | undefined;
        git?: {
            maxProcessesPerSecond?: number | undefined;
            maxProcessConcurrency?: number | undefined;
            maxQueueDepth?: number | undefined;
        } | undefined;
        autoArchiveAfterMerge?: boolean | undefined;
        enableTerminalAgentHooks?: boolean | undefined;
        appendSystemPrompt?: string | undefined;
        terminalProfiles?: {
            [x: string]: unknown;
            id: string;
            name: string;
            command: string;
            args?: string[] | undefined;
            icon?: string | undefined;
        }[] | undefined;
        agentProfiles?: {
            [x: string]: unknown;
            id: string;
            name: string;
            provider: string;
            icon?: string | undefined;
            color?: string | undefined;
            model?: string | undefined;
            modeId?: string | undefined;
            thinkingOptionId?: string | undefined;
            featureValues?: Record<string, unknown> | undefined;
            notes?: string | undefined;
        }[] | undefined;
        cors?: {
            allowedOrigins?: string[] | undefined;
        } | undefined;
        relay?: {
            enabled?: boolean | undefined;
            endpoint?: string | undefined;
            publicEndpoint?: string | undefined;
            useTls?: boolean | undefined;
            publicUseTls?: boolean | undefined;
        } | undefined;
        serviceProxy?: {
            enabled?: boolean | undefined;
            listen?: string | undefined;
            publicBaseUrl?: string | undefined;
        } | undefined;
        auth?: {
            password?: string | undefined;
        } | undefined;
    }, {
        listen?: string | undefined;
        hostnames?: true | string[] | undefined;
        allowedHosts?: true | string[] | undefined;
        trustedProxies?: true | string[] | undefined;
        mcp?: {
            [x: string]: unknown;
            enabled?: boolean | undefined;
            injectIntoAgents?: boolean | undefined;
        } | undefined;
        browserTools?: {
            [x: string]: unknown;
            enabled?: boolean | undefined;
        } | undefined;
        git?: {
            maxProcessesPerSecond?: number | undefined;
            maxProcessConcurrency?: number | undefined;
            maxQueueDepth?: number | undefined;
        } | undefined;
        autoArchiveAfterMerge?: boolean | undefined;
        enableTerminalAgentHooks?: boolean | undefined;
        appendSystemPrompt?: string | undefined;
        terminalProfiles?: {
            [x: string]: unknown;
            id: string;
            name: string;
            command: string;
            args?: string[] | undefined;
            icon?: string | undefined;
        }[] | undefined;
        agentProfiles?: {
            [x: string]: unknown;
            id: string;
            name: string;
            provider: string;
            icon?: string | undefined;
            color?: string | undefined;
            model?: string | undefined;
            modeId?: string | undefined;
            thinkingOptionId?: string | undefined;
            featureValues?: Record<string, unknown> | undefined;
            notes?: string | undefined;
        }[] | undefined;
        cors?: {
            allowedOrigins?: string[] | undefined;
        } | undefined;
        relay?: {
            enabled?: boolean | undefined;
            endpoint?: string | undefined;
            publicEndpoint?: string | undefined;
            useTls?: boolean | undefined;
            publicUseTls?: boolean | undefined;
        } | undefined;
        serviceProxy?: {
            enabled?: boolean | undefined;
            listen?: string | undefined;
            publicBaseUrl?: string | undefined;
        } | undefined;
        auth?: {
            password?: string | undefined;
        } | undefined;
    }>>>;
    app: z.ZodOptional<z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    providers: z.ZodOptional<z.ZodObject<{
        openai: z.ZodOptional<z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            baseUrl: z.ZodOptional<z.ZodString>;
            stt: z.ZodOptional<z.ZodObject<{
                apiKey: z.ZodOptional<z.ZodString>;
                baseUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            tts: z.ZodOptional<z.ZodObject<{
                apiKey: z.ZodOptional<z.ZodString>;
                baseUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        local: z.ZodOptional<z.ZodObject<{
            modelsDir: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    pluginRegistries: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        authorization: z.ZodString;
    }, z.core.$strip>>>;
    pluginsEnabled: z.ZodOptional<z.ZodBoolean>;
    plugins: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
        source: z.ZodLiteral<"directory">;
        path: z.ZodString;
        enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>], "source">>>;
    worktrees: z.ZodOptional<z.ZodObject<{
        root: z.ZodOptional<z.ZodString>;
        servicePorts: z.ZodOptional<z.ZodObject<{
            range: z.ZodOptional<z.ZodString>;
            portScript: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    agents: z.ZodOptional<z.ZodObject<{
        providers: z.ZodOptional<z.ZodPreprocess<z.ZodRecord<z.ZodString, z.ZodObject<{
            extends: z.ZodOptional<z.ZodString>;
            label: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            command: z.ZodOptional<z.ZodArray<z.ZodString>>;
            env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            models: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                label: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
                isDefault: z.ZodOptional<z.ZodBoolean>;
                thinkingOptions: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    label: z.ZodString;
                    description: z.ZodOptional<z.ZodString>;
                    isDefault: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strip>>>;
            }, z.core.$strip>>>;
            additionalModels: z.ZodOptional<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                label: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
                isDefault: z.ZodOptional<z.ZodBoolean>;
                thinkingOptions: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    label: z.ZodString;
                    description: z.ZodOptional<z.ZodString>;
                    isDefault: z.ZodOptional<z.ZodBoolean>;
                }, z.core.$strip>>>;
            }, z.core.$strip>>>;
            disallowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
            paseoTools: z.ZodOptional<z.ZodObject<{
                enabled: z.ZodOptional<z.ZodBoolean>;
                disabledTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
            enabled: z.ZodOptional<z.ZodBoolean>;
            order: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>>>;
        catalogRefreshTimeoutMs: z.ZodOptional<z.ZodNumber>;
        metadataGeneration: z.ZodOptional<z.ZodObject<{
            providers: z.ZodOptional<z.ZodArray<z.ZodObject<{
                provider: z.ZodString;
                model: z.ZodOptional<z.ZodString>;
                thinkingOptionId: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        skills: z.ZodOptional<z.ZodObject<{
            selection: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                mode: z.ZodLiteral<"all">;
            }, z.core.$strict>, z.ZodObject<{
                mode: z.ZodLiteral<"custom">;
                skills: z.ZodArray<z.ZodString>;
            }, z.core.$strict>], "mode">>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    features: z.ZodOptional<z.ZodObject<{
        dictation: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            stt: z.ZodOptional<z.ZodObject<{
                provider: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodEnum<{
                    local: "local";
                    openai: "openai";
                }>>>;
                model: z.ZodOptional<z.ZodString>;
                language: z.ZodOptional<z.ZodString>;
                confidenceThreshold: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        voiceMode: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            llm: z.ZodOptional<z.ZodObject<{
                provider: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            stt: z.ZodOptional<z.ZodObject<{
                provider: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodEnum<{
                    local: "local";
                    openai: "openai";
                }>>>;
                model: z.ZodOptional<z.ZodString>;
                language: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            turnDetection: z.ZodOptional<z.ZodObject<{
                provider: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodEnum<{
                    local: "local";
                    openai: "openai";
                }>>>;
            }, z.core.$strict>>;
            tts: z.ZodOptional<z.ZodObject<{
                provider: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodEnum<{
                    local: "local";
                    openai: "openai";
                }>>>;
                model: z.ZodOptional<z.ZodString>;
                voice: z.ZodOptional<z.ZodEnum<{
                    alloy: "alloy";
                    echo: "echo";
                    fable: "fable";
                    onyx: "onyx";
                    nova: "nova";
                    shimmer: "shimmer";
                }>>;
                speakerId: z.ZodOptional<z.ZodNumber>;
                speed: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        webUi: z.ZodOptional<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            distDir: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    log: z.ZodOptional<z.ZodObject<{
        level: z.ZodOptional<z.ZodEnum<{
            error: "error";
            info: "info";
            fatal: "fatal";
            warn: "warn";
            debug: "debug";
            trace: "trace";
        }>>;
        format: z.ZodOptional<z.ZodEnum<{
            json: "json";
            pretty: "pretty";
        }>>;
        console: z.ZodOptional<z.ZodObject<{
            level: z.ZodOptional<z.ZodEnum<{
                error: "error";
                info: "info";
                fatal: "fatal";
                warn: "warn";
                debug: "debug";
                trace: "trace";
            }>>;
            format: z.ZodOptional<z.ZodEnum<{
                json: "json";
                pretty: "pretty";
            }>>;
        }, z.core.$strict>>;
        file: z.ZodOptional<z.ZodObject<{
            level: z.ZodOptional<z.ZodEnum<{
                error: "error";
                info: "info";
                fatal: "fatal";
                warn: "warn";
                debug: "debug";
                trace: "trace";
            }>>;
            path: z.ZodOptional<z.ZodString>;
            rotate: z.ZodOptional<z.ZodObject<{
                maxSize: z.ZodOptional<z.ZodString>;
                maxFiles: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
type PersistedConfigSchemaOutput = z.infer<typeof PersistedConfigSchema>;
export type PersistedConfig = Omit<PersistedConfigSchemaOutput, "agents"> & {
    agents?: Omit<NonNullable<PersistedConfigSchemaOutput["agents"]>, "providers"> & {
        providers?: AgentProviderRuntimeSettingsMap;
    };
};
interface LoggerLike {
    child(bindings: Record<string, unknown>): LoggerLike;
    info(...args: unknown[]): void;
}
export declare function loadPersistedConfig(paseoHome: string, logger?: LoggerLike): PersistedConfig;
/** Observe the file without initializing a home, identity, or default configuration. */
export declare function readPersistedConfig(paseoHome: string, options?: {
    defaultsIfMissing?: boolean;
}): PersistedConfig;
export declare function getPersistedConfigValue(config: PersistedConfig, field: string): unknown;
export declare function editPersistedConfig(paseoHome: string, field: string, edit: {
    value: unknown;
} | {
    unset: true;
}): PersistedConfig;
export declare function savePersistedConfig(paseoHome: string, config: PersistedConfig, logger?: LoggerLike): void;
export {};
//# sourceMappingURL=persisted-config.d.ts.map