import { z } from "zod";
interface ResolvePackageVersionParams {
    moduleUrl?: string;
    packageName: string;
}
export declare const packageJsonSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type PackageJson = z.infer<typeof packageJsonSchema>;
export declare class PackageVersionResolutionError extends Error {
    constructor(params: {
        moduleUrl: string;
        packageName: string;
    });
}
export declare function resolvePackageVersion(params: ResolvePackageVersionParams): string;
export {};
//# sourceMappingURL=package-version.d.ts.map