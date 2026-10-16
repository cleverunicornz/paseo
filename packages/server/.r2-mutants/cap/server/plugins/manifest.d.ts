import { z } from "zod";
declare const PluginManifestSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodString>;
    media: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodURL]>>>;
    requirements: z.ZodOptional<z.ZodObject<{
        paseo: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    build: z.ZodOptional<z.ZodArray<z.ZodArray<z.ZodString>>>;
}, z.core.$strip>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export declare function readPluginManifest(directory: string): Promise<PluginManifest>;
export {};
//# sourceMappingURL=manifest.d.ts.map