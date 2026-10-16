import { UsageScopeSchema } from "@getpaseo/plugin/server/usage";
import { ProviderEventSchema, ProviderInputSchema, ProviderLaunchSchema, } from "@getpaseo/plugin/server/provider";
import { z } from "zod";
const hooksSchema = z.object({ events: z.array(z.string()), before: z.array(z.string()) }).strict();
const providerMetadataSchema = z
    .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    iconPath: z.string().optional(),
    hasCatalogCacheKey: z.boolean().optional(),
    hasStatus: z.boolean().optional(),
    command: z.tuple([z.string().min(1)], z.string()).optional(),
})
    .strict();
const usageSourceMetadataSchema = z
    .object({
    id: z.string().min(1),
    label: z.string().min(1),
    icon: z.string().optional(),
})
    .strict();
const providerConnectRequestSchema = z
    .object({
    launch: ProviderLaunchSchema.optional(),
    versions: z.array(z.number().int().positive()),
    capabilities: z.array(z.string()),
})
    .strict();
const frameFields = {
    data: z.union([z.string(), z.instanceof(Uint8Array)]),
    isBinary: z.boolean(),
};
export const PluginProcessRequestSchema = z.discriminatedUnion("type", [
    z
        .object({
        type: z.literal("provider.status"),
        requestId: z.string().min(1),
        providerId: z.string().min(1),
        request: z.object({ launch: ProviderLaunchSchema.optional() }).strict(),
    })
        .strict(),
    z
        .object({
        type: z.literal("initialize"),
        pluginId: z.string().min(1),
        bundle: z.string(),
        appVersion: z.string(),
        pluginDirectory: z.string(),
        settingsDirectory: z.string().optional(),
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.catalog_key"),
        requestId: z.string().min(1),
        providerId: z.string().min(1),
        options: z.discriminatedUnion("scope", [
            z
                .object({
                scope: z.literal("global"),
                force: z.boolean().optional(),
                launch: ProviderLaunchSchema.optional(),
            })
                .strict(),
            z
                .object({
                scope: z.literal("workspace"),
                cwd: z.string(),
                force: z.boolean().optional(),
                launch: ProviderLaunchSchema.optional(),
            })
                .strict(),
        ]),
    })
        .strict(),
    z
        .object({
        type: z.literal("hook"),
        requestId: z.string(),
        kind: z.enum(["event", "before"]),
        name: z.string(),
        input: z.unknown(),
    })
        .strict(),
    z.object({ type: z.literal("hook.cancel"), requestId: z.string() }).strict(),
    z
        .object({
        type: z.literal("usage.fetch"),
        requestId: z.string(),
        sourceId: z.string(),
        input: z.unknown(),
    })
        .strict(),
    z
        .object({
        type: z.literal("usage.discover"),
        requestId: z.string(),
        sourceId: z.string(),
        scope: UsageScopeSchema,
    })
        .strict(),
    z
        .object({
        type: z.literal("invoke"),
        requestId: z.string().min(1),
        method: z.string().min(1),
        input: z.unknown(),
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.connect"),
        providerId: z.string().min(1),
        connectionId: z.string().min(1),
        request: providerConnectRequestSchema,
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.send"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
        input: ProviderInputSchema,
    })
        .strict(),
    z.object({ type: z.literal("provider.close"), connectionId: z.string().min(1) }).strict(),
    z.object({ type: z.literal("shutdown") }).strict(),
    z.object({ type: z.literal("paseo_frame"), ...frameFields }).strict(),
    z.object({ type: z.literal("paseo_close") }).strict(),
]);
export const PluginProcessMessageSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("settings.changed"), settingsId: z.string() }).strict(),
    z.object({ type: z.literal("hooks.changed"), hooks: hooksSchema }).strict(),
    z
        .object({
        type: z.literal("ready"),
        methods: z.array(z.string()),
        providers: z.array(providerMetadataSchema),
        usageSources: z.array(usageSourceMetadataSchema).optional(),
        hooks: hooksSchema.optional(),
    })
        .strict(),
    z
        .object({ type: z.literal("result"), requestId: z.string().min(1), output: z.unknown() })
        .strict(),
    z
        .object({ type: z.literal("error"), requestId: z.string().min(1), error: z.string() })
        .strict(),
    z.object({ type: z.literal("fatal"), error: z.string() }).strict(),
    z
        .object({
        type: z.literal("provider.connected"),
        connectionId: z.string().min(1),
        version: z.number().int().positive(),
        capabilities: z.array(z.string()),
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.connect_failed"),
        connectionId: z.string().min(1),
        error: z.string(),
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.accepted"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.rejected"),
        connectionId: z.string().min(1),
        acceptanceId: z.string().min(1),
        error: z.string(),
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.event"),
        connectionId: z.string().min(1),
        event: ProviderEventSchema,
    })
        .strict(),
    z
        .object({
        type: z.literal("provider.closed"),
        connectionId: z.string().min(1),
        error: z.string().optional(),
    })
        .strict(),
    z.object({ type: z.literal("paseo_frame"), ...frameFields }).strict(),
    z.object({ type: z.literal("paseo_close") }).strict(),
]);
//# sourceMappingURL=plugin-process-protocol.js.map