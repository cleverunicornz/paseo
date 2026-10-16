import { type PaseoConfigRaw, type PaseoConfigRevision, type ProjectConfigRpcError } from "@getpaseo/protocol/paseo-config-schema";
export { PaseoConfigRevisionSchema, ProjectConfigRpcErrorSchema, type PaseoConfigRevision, type ProjectConfigRpcError, } from "@getpaseo/protocol/paseo-config-schema";
export declare const PASEO_CONFIG_FILE_NAME = "paseo.json";
export type ReadPaseoConfigForEditResult = {
    ok: true;
    config: PaseoConfigRaw | null;
    revision: PaseoConfigRevision | null;
} | {
    ok: false;
    error: ProjectConfigRpcError;
};
export type WritePaseoConfigForEditResult = {
    ok: true;
    config: PaseoConfigRaw;
    revision: PaseoConfigRevision;
} | {
    ok: false;
    error: ProjectConfigRpcError;
};
export interface WritePaseoConfigForEditInput {
    repoRoot: string;
    config: PaseoConfigRaw;
    expectedRevision: PaseoConfigRevision | null;
}
export declare function resolvePaseoConfigPath(repoRoot: string): string;
export declare function statPaseoConfigPath(repoRoot: string): PaseoConfigRevision | null;
export declare function readPaseoConfigJson(repoRoot: string): unknown;
export declare function readPaseoConfigForEdit(repoRoot: string): ReadPaseoConfigForEditResult;
export declare function writePaseoConfigForEdit(input: WritePaseoConfigForEditInput): WritePaseoConfigForEditResult;
//# sourceMappingURL=paseo-config-file.d.ts.map