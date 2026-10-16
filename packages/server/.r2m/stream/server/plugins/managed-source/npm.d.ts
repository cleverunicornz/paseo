export declare function isNpmSource(source: string): boolean;
export declare function acquireNpm(source: string, installRoot: string, target?: NpmArtifact): Promise<{
    version: string;
    resolved: string;
    integrity: string;
    packageName: string;
}>;
export interface NpmArtifact {
    version: string;
    resolved: string;
    integrity: string;
}
export declare function readNpmArtifact(installRoot: string, packageName: string): Promise<NpmArtifact>;
export declare function resolveNpm(packageName: string, selector: string, cwd: string): Promise<NpmArtifact>;
//# sourceMappingURL=npm.d.ts.map