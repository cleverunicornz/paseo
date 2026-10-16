import { type UsageScope } from "@getpaseo/plugin/server/usage";
import type { ProviderConnectRequest, ProviderCatalogOptions, ProviderEvent, ProviderInput, ProviderStatusRequest } from "@getpaseo/plugin/server/provider";
import { z } from "zod";
export interface PluginProviderMetadata {
    hasCatalogCacheKey?: boolean;
    hasStatus?: boolean;
    command?: readonly [string, ...string[]];
    id: string;
    label: string;
    description?: string;
    iconPath?: string;
}
export interface PluginUsageSourceMetadata {
    id: string;
    label: string;
    icon?: string;
}
export type PluginProcessRequest = {
    type: "provider.status";
    requestId: string;
    providerId: string;
    request: ProviderStatusRequest;
} | {
    type: "initialize";
    pluginId: string;
    bundle: string;
    appVersion: string;
    pluginDirectory: string;
    settingsDirectory?: string;
} | {
    type: "provider.catalog_key";
    requestId: string;
    providerId: string;
    options: ProviderCatalogOptions;
} | {
    type: "hook";
    requestId: string;
    kind: "event" | "before";
    name: string;
    input: unknown;
} | {
    type: "hook.cancel";
    requestId: string;
} | {
    type: "usage.fetch";
    requestId: string;
    sourceId: string;
    input: unknown;
} | {
    type: "usage.discover";
    requestId: string;
    sourceId: string;
    scope: UsageScope;
} | {
    type: "invoke";
    requestId: string;
    method: string;
    input: unknown;
} | {
    type: "provider.connect";
    providerId: string;
    connectionId: string;
    request: ProviderConnectRequest;
} | {
    type: "provider.send";
    connectionId: string;
    acceptanceId: string;
    input: ProviderInput;
} | {
    type: "provider.close";
    connectionId: string;
} | {
    type: "shutdown";
} | {
    type: "paseo_frame";
    data: string | Uint8Array;
    isBinary: boolean;
} | {
    type: "paseo_close";
};
export type PluginProcessMessage = {
    type: "settings.changed";
    settingsId: string;
} | {
    type: "hooks.changed";
    hooks: {
        events: string[];
        before: string[];
    };
} | {
    type: "ready";
    methods: string[];
    providers: PluginProviderMetadata[];
    usageSources?: PluginUsageSourceMetadata[];
    hooks?: {
        events: string[];
        before: string[];
    };
} | {
    type: "result";
    requestId: string;
    output: unknown;
} | {
    type: "error";
    requestId: string;
    error: string;
} | {
    type: "fatal";
    error: string;
} | {
    type: "provider.connected";
    connectionId: string;
    version: number;
    capabilities: readonly string[];
} | {
    type: "provider.connect_failed";
    connectionId: string;
    error: string;
} | {
    type: "provider.accepted";
    connectionId: string;
    acceptanceId: string;
} | {
    type: "provider.rejected";
    connectionId: string;
    acceptanceId: string;
    error: string;
} | {
    type: "provider.event";
    connectionId: string;
    event: ProviderEvent;
} | {
    type: "provider.closed";
    connectionId: string;
    error?: string;
} | {
    type: "paseo_frame";
    data: string | Uint8Array;
    isBinary: boolean;
} | {
    type: "paseo_close";
};
export declare const PluginProcessRequestSchema: z.ZodType<PluginProcessRequest>;
export declare const PluginProcessMessageSchema: z.ZodType<PluginProcessMessage>;
//# sourceMappingURL=plugin-process-protocol.d.ts.map