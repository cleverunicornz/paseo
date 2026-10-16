export class WorkspaceScriptRuntimeStore {
    constructor() {
        this.entries = new Map();
        this.scriptsByWorkspace = new Map();
    }
    get(key) {
        const entry = this.entries.get(this.toEntryKey(key));
        return entry ? { ...entry } : null;
    }
    set(entry) {
        const workspaceKey = this.toWorkspaceKey(entry.workspaceId);
        const entryKey = this.toEntryKey(entry);
        const previous = this.entries.get(entryKey);
        if (previous) {
            this.removeScriptFromWorkspaceIndex(previous.workspaceId, previous.scriptName);
        }
        this.entries.set(entryKey, { ...entry });
        this.addScriptToWorkspaceIndex(workspaceKey, entry.scriptName);
    }
    remove(key) {
        const entryKey = this.toEntryKey(key);
        const existing = this.entries.get(entryKey);
        if (!existing) {
            return;
        }
        this.entries.delete(entryKey);
        this.removeScriptFromWorkspaceIndex(existing.workspaceId, existing.scriptName);
    }
    listForWorkspace(workspaceId) {
        const scriptNames = this.scriptsByWorkspace.get(this.toWorkspaceKey(workspaceId));
        if (!scriptNames) {
            return [];
        }
        const entries = [];
        for (const scriptName of scriptNames) {
            const entry = this.entries.get(this.toEntryKey({
                workspaceId,
                scriptName,
            }));
            if (entry) {
                entries.push({ ...entry });
            }
        }
        return entries;
    }
    removeForWorkspace(workspaceId) {
        for (const entry of this.listForWorkspace(workspaceId)) {
            this.entries.delete(this.toEntryKey(entry));
        }
        this.scriptsByWorkspace.delete(this.toWorkspaceKey(workspaceId));
    }
    isRunning(key) {
        return this.get(key)?.lifecycle === "running";
    }
    addScriptToWorkspaceIndex(workspaceKey, scriptName) {
        const scripts = this.scriptsByWorkspace.get(workspaceKey) ?? new Set();
        scripts.add(scriptName);
        this.scriptsByWorkspace.set(workspaceKey, scripts);
    }
    removeScriptFromWorkspaceIndex(workspaceId, scriptName) {
        const workspaceKey = this.toWorkspaceKey(workspaceId);
        const scripts = this.scriptsByWorkspace.get(workspaceKey);
        if (!scripts) {
            return;
        }
        scripts.delete(scriptName);
        if (scripts.size === 0) {
            this.scriptsByWorkspace.delete(workspaceKey);
        }
    }
    toEntryKey(key) {
        return `${this.toWorkspaceKey(key.workspaceId)}::${key.scriptName}`;
    }
    toWorkspaceKey(workspaceId) {
        return workspaceId;
    }
}
//# sourceMappingURL=workspace-script-runtime-store.js.map