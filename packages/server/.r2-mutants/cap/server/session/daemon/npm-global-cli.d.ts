export declare const PASEO_CLI_PACKAGE = "@getpaseo/cli";
export interface CommandOptions {
    timeout?: number;
    maxBuffer?: number;
}
export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export interface NpmGlobalPaseoInstall {
    version: string;
    packagePath: string;
    globalRootPath: string | null;
    isLinked: boolean;
}
export interface NpmGlobalPaseoCli {
    inspect(options?: NpmGlobalOptions): Promise<NpmGlobalPaseoInstall>;
    installLatest(options?: NpmGlobalOptions): Promise<CommandResult>;
}
interface NpmGlobalOptions {
    prefix?: string;
}
export type CommandRunner = (command: string, args: string[], options?: CommandOptions) => Promise<CommandResult>;
export declare class DefaultNpmGlobalPaseoCli implements NpmGlobalPaseoCli {
    private readonly runCommand;
    constructor(runCommand?: CommandRunner);
    inspect(options?: NpmGlobalOptions): Promise<NpmGlobalPaseoInstall>;
    installLatest(options?: NpmGlobalOptions): Promise<CommandResult>;
}
export declare const npmGlobalPaseoCli: DefaultNpmGlobalPaseoCli;
export {};
//# sourceMappingURL=npm-global-cli.d.ts.map