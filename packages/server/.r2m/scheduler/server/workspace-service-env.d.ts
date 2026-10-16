export interface WorkspaceServicePeer {
    scriptName: string;
    port: number;
}
export interface BuildWorkspaceServiceEnvOptions {
    scriptName: string;
    projectSlug: string;
    branchName: string | null;
    daemonPort: number | null | undefined;
    daemonListenHost: string | null | undefined;
    serviceProxyPublicBaseUrl?: string | null;
    peers: readonly WorkspaceServicePeer[];
}
export declare function normalizeServiceEnvName(scriptName: string): string;
export declare function buildWorkspaceServiceEnv(options: BuildWorkspaceServiceEnvOptions): Record<string, string>;
export declare function resolveServiceBindHost(daemonListenHost: string | null | undefined): string;
export declare function assertNoServiceEnvNameCollisions(scriptNames: readonly string[]): void;
//# sourceMappingURL=workspace-service-env.d.ts.map