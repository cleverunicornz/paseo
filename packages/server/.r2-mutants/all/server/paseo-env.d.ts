export type PaseoNodeEnv = "development" | "production" | "test";
export type ProcessEnvRecord = Record<string, string | undefined>;
export type ExternalProcessEnv = NodeJS.ProcessEnv & Record<string, string>;
export declare function createPaseoInternalEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function createExternalProcessEnv(baseEnv: ProcessEnvRecord, ...overlays: ProcessEnvRecord[]): ExternalProcessEnv;
export declare function createExternalCommandProcessEnv(_command: string, baseEnv: ProcessEnvRecord, ...overlays: ProcessEnvRecord[]): ExternalProcessEnv;
export declare function buildSelfNodeCommand(args: string[], envOverlay?: ProcessEnvRecord): {
    command: string;
    args: string[];
    env: ExternalProcessEnv;
};
export declare function resolvePaseoNodeEnv(env: NodeJS.ProcessEnv): PaseoNodeEnv | undefined;
//# sourceMappingURL=paseo-env.d.ts.map