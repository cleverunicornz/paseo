import type { ImportKind } from "esbuild";
export type PluginImportKind = ImportKind | "type-reference";
interface ModuleImport {
    specifier: string;
    kind: PluginImportKind;
    typeOnly: boolean;
}
export declare function createPluginImportReader(directory: string): {
    resolve(specifier: string, importer: string, kind: PluginImportKind): string | undefined;
    read(file: string): ModuleImport[];
};
export {};
//# sourceMappingURL=compiler-imports.d.ts.map