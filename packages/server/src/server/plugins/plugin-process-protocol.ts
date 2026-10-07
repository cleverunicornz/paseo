import type {
  ProviderConnectRequest,
  ProviderCatalogOptions,
  ProviderEvent,
  ProviderInput,
} from "@getpaseo/plugin/server/provider";
import { ProviderEventSchema, ProviderInputSchema } from "@getpaseo/plugin/server/provider";
import type { PluginStopContext } from "@getpaseo/plugin/server";
import { z } from "zod";

export interface PluginProviderMetadata {
  hasCatalogCacheKey?: boolean;
  id: string;
  label: string;
  description?: string;
  iconPath?: string;
}

/** Which stop-readiness parts a plugin's server entry provides. */
export interface PluginStopReadinessCapabilities {
  timeline: boolean;
  wip: boolean;
  beginStopping: boolean;
}

/** The stop context as it crosses the process boundary; the child adds its own `paseo`. */
export type PluginStopContextPayload = Omit<PluginStopContext, "paseo">;

export type PluginProcessRequest =
  | {
      type: "initialize";
      pluginId: string;
      bundle: string;
      appVersion: string;
      settingsDirectory?: string;
    }
  | {
      type: "provider.catalog_key";
      requestId: string;
      providerId: string;
      options: ProviderCatalogOptions;
    }
  | { type: "hook"; requestId: string; kind: "event" | "before"; name: string; input: unknown }
  | { type: "hook.cancel"; requestId: string }
  | { type: "invoke"; requestId: string; method: string; input: unknown }
  | {
      type: "stop_readiness";
      requestId: string;
      part: "timeline" | "wip";
      context: PluginStopContextPayload;
    }
  | { type: "begin_stopping"; requestId: string; context: PluginStopContextPayload }
  | {
      type: "provider.connect";
      providerId: string;
      connectionId: string;
      request: ProviderConnectRequest;
    }
  | {
      type: "provider.send";
      connectionId: string;
      acceptanceId: string;
      input: ProviderInput;
    }
  | { type: "provider.close"; connectionId: string }
  | { type: "shutdown" }
  | { type: "paseo_frame"; data: string | Uint8Array; isBinary: boolean }
  | { type: "paseo_close" };

export type PluginProcessMessage =
  | { type: "settings.changed"; settingsId: string }
  | { type: "hooks.changed"; hooks: { events: string[]; before: string[] } }
  | {
      type: "ready";
      methods: string[];
      providers: PluginProviderMetadata[];
      hooks?: { events: string[]; before: string[] };
      stopReadiness?: PluginStopReadinessCapabilities;
    }
  | { type: "result"; requestId: string; output: unknown }
  | { type: "error"; requestId: string; error: string }
  | { type: "fatal"; error: string }
  | {
      type: "provider.connected";
      connectionId: string;
      version: number;
      capabilities: readonly string[];
    }
  | { type: "provider.connect_failed"; connectionId: string; error: string }
  | { type: "provider.accepted"; connectionId: string; acceptanceId: string }
  | {
      type: "provider.rejected";
      connectionId: string;
      acceptanceId: string;
      error: string;
    }
  | { type: "provider.event"; connectionId: string; event: ProviderEvent }
  | { type: "provider.closed"; connectionId: string; error?: string }
  | { type: "paseo_frame"; data: string | Uint8Array; isBinary: boolean }
  | { type: "paseo_close" };

const hooksSchema = z.object({ events: z.array(z.string()), before: z.array(z.string()) }).strict();

const providerMetadataSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    iconPath: z.string().optional(),
    hasCatalogCacheKey: z.boolean().optional(),
  })
  .strict();
const providerConnectRequestSchema = z
  .object({
    versions: z.array(z.number().int().positive()),
    capabilities: z.array(z.string()),
  })
  .strict();
const stopContextSchema = z
  .object({
    stopping: z.boolean(),
    timeline: z.array(
      z
        .object({
          agentId: z.string(),
          epoch: z.string(),
          emittedThrough: z.number().int(),
          deliveredThrough: z.number().int(),
          pending: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
const stopReadinessCapabilitiesSchema = z
  .object({ timeline: z.boolean(), wip: z.boolean(), beginStopping: z.boolean() })
  .strict();
const frameFields = {
  data: z.union([z.string(), z.instanceof(Uint8Array)]),
  isBinary: z.boolean(),
};

export const PluginProcessRequestSchema: z.ZodType<PluginProcessRequest> = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        type: z.literal("initialize"),
        pluginId: z.string().min(1),
        bundle: z.string(),
        appVersion: z.string(),
        settingsDirectory: z.string().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("provider.catalog_key"),
        requestId: z.string().min(1),
        providerId: z.string().min(1),
        options: z.discriminatedUnion("scope", [
          z.object({ scope: z.literal("global"), force: z.boolean().optional() }).strict(),
          z
            .object({
              scope: z.literal("workspace"),
              cwd: z.string(),
              force: z.boolean().optional(),
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
        type: z.literal("stop_readiness"),
        requestId: z.string().min(1),
        part: z.enum(["timeline", "wip"]),
        context: stopContextSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("begin_stopping"),
        requestId: z.string().min(1),
        context: stopContextSchema,
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
  ],
);

export const PluginProcessMessageSchema: z.ZodType<PluginProcessMessage> = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("settings.changed"), settingsId: z.string() }).strict(),
    z.object({ type: z.literal("hooks.changed"), hooks: hooksSchema }).strict(),
    z
      .object({
        type: z.literal("ready"),
        methods: z.array(z.string()),
        providers: z.array(providerMetadataSchema),
        hooks: hooksSchema.optional(),
        stopReadiness: stopReadinessCapabilitiesSchema.optional(),
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
  ],
);
