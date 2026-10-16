export interface ClaudeProjectDirOptions {
    configDir?: string;
}
export declare function claudeProjectDir(cwd: string, options?: ClaudeProjectDirOptions): Promise<string>;
export declare function claudeProjectDirSync(cwd: string, options?: ClaudeProjectDirOptions): string;
export declare function claudeTranscriptPathSync(input: {
    cwd: string;
    sessionId: string;
    configDir?: string;
}): string;
export declare function claudeConfigDir(env: NodeJS.ProcessEnv): string;
//# sourceMappingURL=project-dir.d.ts.map