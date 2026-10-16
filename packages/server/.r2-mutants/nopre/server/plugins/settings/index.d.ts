import { z, type ZodType } from "zod";
import { type SettingsDefinition } from "@getpaseo/plugin";
import type { PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
type SettingsWriteState<Schema extends ZodType> = {
    status: "saved";
    revision: string;
    values: z.output<Schema>;
} | {
    status: "conflict";
    error: string;
} | {
    status: "invalid";
    error: string;
};
/** One instance per installation. The subprocess lifetime gives writes a single owner. */
export declare class PluginSettingsStore {
    private readonly definitions;
    private queue;
    private readonly directory;
    private readonly changed;
    constructor(directory: string, changed: (id: string) => void);
    register<Schema extends ZodType>(definition: SettingsDefinition<Schema>): {
        settings: PluginSettings<Schema>;
        read: {
            contract: import("@getpaseo/plugin").PluginRpcContract<z.ZodObject<{}, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                status: z.ZodLiteral<"ready">;
                revision: z.ZodString;
                values: z.ZodJSONSchema;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"invalid">;
                revision: z.ZodString;
                error: z.ZodString;
            }, z.core.$strip>], "status">>;
            handle: () => Promise<PluginSettingsState<Schema>>;
        };
        write: {
            contract: import("@getpaseo/plugin").PluginRpcContract<z.ZodObject<{
                revision: z.ZodString;
                values: z.ZodJSONSchema;
            }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                status: z.ZodLiteral<"saved">;
                revision: z.ZodString;
                values: z.ZodJSONSchema;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"conflict">;
                error: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"invalid">;
                error: z.ZodString;
            }, z.core.$strip>], "status">>;
            handle: (input: z.output<z.ZodObject<{
                revision: z.ZodString;
                values: z.ZodJSONSchema;
            }, z.core.$strip>>) => Promise<SettingsWriteState<Schema>>;
        };
        reset: {
            contract: import("@getpaseo/plugin").PluginRpcContract<z.ZodObject<{
                revision: z.ZodString;
            }, z.core.$strip>, z.ZodDiscriminatedUnion<[z.ZodObject<{
                status: z.ZodLiteral<"saved">;
                revision: z.ZodString;
                values: z.ZodJSONSchema;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"conflict">;
                error: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                status: z.ZodLiteral<"invalid">;
                error: z.ZodString;
            }, z.core.$strip>], "status">>;
            handle: (input: z.output<z.ZodObject<{
                revision: z.ZodString;
            }, z.core.$strip>>) => Promise<SettingsWriteState<Schema>>;
        };
    };
    private serial;
    private stored;
    private read;
    private write;
    private persist;
}
export {};
//# sourceMappingURL=index.d.ts.map