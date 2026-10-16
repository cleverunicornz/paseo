export interface ScriptRuntimeEntry {
    workspaceId: string;
    scriptName: string;
    type: "script" | "service";
    lifecycle: "running" | "stopped";
    terminalId: string;
    exitCode: number | null;
}
interface RuntimeEntryKey {
    workspaceId: string;
    scriptName: string;
}
export declare class WorkspaceScriptRuntimeStore {
    private readonly entries;
    private readonly scriptsByWorkspace;
    get(key: RuntimeEntryKey): ScriptRuntimeEntry | null;
    set(entry: ScriptRuntimeEntry): void;
    remove(key: RuntimeEntryKey): void;
    listForWorkspace(workspaceId: string): ScriptRuntimeEntry[];
    removeForWorkspace(workspaceId: string): void;
    isRunning(key: RuntimeEntryKey): boolean;
    private addScriptToWorkspaceIndex;
    private removeScriptFromWorkspaceIndex;
    private toEntryKey;
    private toWorkspaceKey;
}
export {};
//# sourceMappingURL=workspace-script-runtime-store.d.ts.map