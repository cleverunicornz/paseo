export interface BuildStringCommandShellInvocationOptions {
    command: string;
    platform?: NodeJS.Platform;
    windowsShell?: "powershell" | "cmd";
}
export interface StringCommandShellInvocation {
    shell: string;
    args: string[];
}
export declare function createStringCommandShellEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function createStringCommandShellEnvOverlay(): Record<string, string | undefined>;
export declare function buildStringCommandShellInvocation(options: BuildStringCommandShellInvocationOptions): StringCommandShellInvocation;
//# sourceMappingURL=string-command-shell.d.ts.map