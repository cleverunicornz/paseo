import { type RegistryOptions } from "./managed-source/registry.js";
import { z } from "zod";
import { type PluginInstallation, type PluginSourceStatusItem, type PluginUpdatePreview, type PluginUpdateProposal, type PluginUpdateSelection, type PluginUpdateTarget } from "@getpaseo/protocol/messages";
import { type PluginManifest } from "./manifest.js";
declare const ManagedPluginRecordSchema: z.ZodUnion<readonly [z.ZodObject<{
    kind: z.ZodDefault<z.ZodLiteral<"git">>;
    remote: z.ZodString;
    registry: z.ZodOptional<z.ZodObject<{
        url: z.ZodString;
        id: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"npm">;
    registry: z.ZodOptional<z.ZodObject<{
        url: z.ZodString;
        id: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>]>;
export type ManagedPluginRecord = z.infer<typeof ManagedPluginRecordSchema>;
export interface ManagedPluginCandidate {
    build: PluginManifest["build"];
    defaultId: string;
    directory: string;
    record: ManagedPluginRecord;
    versionRoot: string;
    target?: PluginUpdateTarget;
}
interface InstallInput {
    source: string;
    ref?: string;
    pluginPath?: string;
}
export declare class ManagedPluginSources {
    private readonly registryOptions;
    private readonly root;
    private readonly metadataPath;
    private readonly records;
    constructor(paseoHome: string, registryOptions?: RegistryOptions);
    private locate;
    describe(pluginId: string, configuredPath: string): Promise<PluginInstallation>;
    private revision;
    prepareInstall(input: InstallInput, target?: PluginUpdateTarget): Promise<ManagedPluginCandidate>;
    place(pluginId: string, candidate: ManagedPluginCandidate): Promise<ManagedPluginCandidate>;
    preview(pluginId: string, configuredPath: string, selection?: PluginUpdateSelection): Promise<PluginUpdatePreview>;
    assertCurrent(proposal: PluginUpdateProposal, configuredPath: string): Promise<void>;
    prepareUpdate(proposal: PluginUpdateProposal, configuredPath: string): Promise<ManagedPluginCandidate>;
    verifyCandidate(pluginId: string, candidate: ManagedPluginCandidate, target?: PluginUpdateTarget): Promise<void>;
    status(pluginId: string, configuredPath: string): Promise<PluginSourceStatusItem>;
    commit(pluginId: string, record: ManagedPluginRecord): void;
    discard(candidate: ManagedPluginCandidate): Promise<void>;
    removeVersion(pluginId: string, configuredPath: string): Promise<void>;
    remove(pluginId: string): Promise<void>;
    private createStagingRoot;
    private writeRecords;
}
export {};
//# sourceMappingURL=managed-source.d.ts.map