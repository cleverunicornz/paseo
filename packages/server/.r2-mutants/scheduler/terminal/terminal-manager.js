import { createTerminal, } from "./terminal.js";
import { captureTerminalLines } from "./terminal-capture.js";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import { assertAbsolutePath, isSameOrDescendantPath } from "../server/path-utils.js";
import { deriveTerminalActivityStatusBucket } from "@getpaseo/protocol/terminal-activity";
function createActivityToken() {
    return randomBytes(32).toString("base64url");
}
export function createTerminalManager(managerOptions = {}) {
    const terminalsByCwd = new Map();
    const terminalsById = new Map();
    const terminalExitUnsubscribeById = new Map();
    const terminalTitleUnsubscribeById = new Map();
    const terminalActivityUnsubscribeById = new Map();
    const terminalActivityTokenById = new Map();
    const terminalsChangedListeners = new Set();
    const terminalActivityListeners = new Set();
    const terminalWorkspaceContributionChangedListeners = new Set();
    const defaultEnvByRootCwd = new Map();
    function removeSessionById(id, options) {
        const session = terminalsById.get(id);
        if (!session) {
            return;
        }
        const unsubscribeExit = terminalExitUnsubscribeById.get(id);
        if (unsubscribeExit) {
            unsubscribeExit();
            terminalExitUnsubscribeById.delete(id);
        }
        const unsubscribeTitle = terminalTitleUnsubscribeById.get(id);
        if (unsubscribeTitle) {
            unsubscribeTitle();
            terminalTitleUnsubscribeById.delete(id);
        }
        const unsubscribeActivity = terminalActivityUnsubscribeById.get(id);
        if (unsubscribeActivity) {
            unsubscribeActivity();
            terminalActivityUnsubscribeById.delete(id);
        }
        terminalsById.delete(id);
        terminalActivityTokenById.delete(id);
        const terminals = terminalsByCwd.get(session.cwd);
        if (terminals) {
            const index = terminals.findIndex((terminal) => terminal.id === id);
            if (index !== -1) {
                terminals.splice(index, 1);
            }
            if (terminals.length === 0) {
                terminalsByCwd.delete(session.cwd);
            }
        }
        if (options.kill) {
            session.kill();
        }
        const previousActivity = session.getActivity();
        const previousBucket = deriveTerminalActivityStatusBucket(previousActivity);
        if (previousBucket !== null) {
            emitTerminalWorkspaceContributionChanged({
                terminalId: session.id,
                cwd: session.cwd,
                workspaceId: session.workspaceId,
            });
        }
        emitTerminalsChanged({ cwd: session.cwd });
    }
    function resolveDefaultEnvForCwd(cwd) {
        const normalizedCwd = resolve(cwd);
        let bestMatchRoot = null;
        for (const rootCwd of defaultEnvByRootCwd.keys()) {
            const matches = normalizedCwd === rootCwd || normalizedCwd.startsWith(`${rootCwd}${sep}`);
            if (!matches) {
                continue;
            }
            if (!bestMatchRoot || rootCwd.length > bestMatchRoot.length) {
                bestMatchRoot = rootCwd;
            }
        }
        return bestMatchRoot ? defaultEnvByRootCwd.get(bestMatchRoot) : undefined;
    }
    function registerSession(session) {
        terminalsById.set(session.id, session);
        const unsubscribeExit = session.onExit(() => {
            removeSessionById(session.id, { kill: false });
        });
        const unsubscribeTitle = session.onTitleChange(() => {
            emitTerminalsChanged({ cwd: session.cwd });
        });
        const unsubscribeActivity = session.onActivityChange((transition) => {
            emitTerminalActivityTransition({ session, transition });
            emitTerminalsChanged({ cwd: session.cwd });
            const previousBucket = deriveTerminalActivityStatusBucket(transition.previous);
            const nextBucket = deriveTerminalActivityStatusBucket(transition.activity);
            if (previousBucket !== nextBucket) {
                emitTerminalWorkspaceContributionChanged({
                    terminalId: session.id,
                    cwd: session.cwd,
                    workspaceId: session.workspaceId,
                });
            }
        });
        terminalExitUnsubscribeById.set(session.id, unsubscribeExit);
        terminalTitleUnsubscribeById.set(session.id, unsubscribeTitle);
        terminalActivityUnsubscribeById.set(session.id, unsubscribeActivity);
        return session;
    }
    function toTerminalListItem(input) {
        return {
            id: input.session.id,
            name: input.session.name,
            cwd: input.session.cwd,
            workspaceId: input.session.workspaceId,
            title: input.session.getTitle(),
            activity: input.session.getActivity(),
        };
    }
    function emitTerminalsChanged(input) {
        if (terminalsChangedListeners.size === 0) {
            return;
        }
        const terminals = (terminalsByCwd.get(input.cwd) ?? []).map((session) => toTerminalListItem({ session }));
        const event = {
            cwd: input.cwd,
            terminals,
        };
        for (const listener of terminalsChangedListeners) {
            try {
                listener(event);
            }
            catch {
                // no-op
            }
        }
    }
    function emitTerminalActivityTransition(input) {
        if (terminalActivityListeners.size === 0) {
            return;
        }
        const event = {
            terminalId: input.session.id,
            name: input.session.name,
            cwd: input.session.cwd,
            workspaceId: input.session.workspaceId,
            activity: input.transition.activity,
            previous: input.transition.previous,
        };
        for (const listener of terminalActivityListeners) {
            try {
                listener(event);
            }
            catch {
                // no-op
            }
        }
    }
    function emitTerminalWorkspaceContributionChanged(event) {
        for (const listener of terminalWorkspaceContributionChangedListeners) {
            try {
                listener(event);
            }
            catch {
                // no-op
            }
        }
    }
    return {
        async getTerminals(cwd, options) {
            assertAbsolutePath(cwd);
            // Terminals are bucketed by exact cwd, but an agent can open a terminal in
            // a subdirectory of the workspace. A query for the workspace root must
            // surface those too, so aggregate every bucket at or below `cwd`.
            const sessions = [];
            for (const [bucketCwd, bucketSessions] of terminalsByCwd) {
                if (isSameOrDescendantPath(cwd, bucketCwd)) {
                    sessions.push(...bucketSessions);
                }
            }
            // When the query carries a workspaceId, two workspaces sharing a cwd must
            // not see each other's terminals. A missing owner is not workspace
            // membership; unscoped callers can still list those legacy terminals.
            if (options?.workspaceId !== undefined) {
                return sessions.filter((session) => session.workspaceId === options.workspaceId);
            }
            return sessions;
        },
        async createTerminal(options) {
            assertAbsolutePath(options.cwd);
            const terminals = terminalsByCwd.get(options.cwd) ?? [];
            const defaultName = `Terminal ${terminals.length + 1}`;
            const inheritedEnv = resolveDefaultEnvForCwd(options.cwd);
            const mergedEnv = inheritedEnv || options.env ? { ...inheritedEnv, ...options.env } : undefined;
            const terminalId = options.id ?? randomUUID();
            const activityToken = options.activityToken ?? createActivityToken();
            const terminalActivityUrl = options.activityUrl === undefined
                ? (managerOptions.getTerminalActivityUrl?.() ?? null)
                : options.activityUrl;
            const activityEnv = {
                PASEO_TERMINAL_ID: terminalId,
                PASEO_ACTIVITY_TOKEN: activityToken,
                ...(terminalActivityUrl ? { PASEO_TERMINAL_ACTIVITY_URL: terminalActivityUrl } : {}),
            };
            terminalActivityTokenById.set(terminalId, activityToken);
            let session;
            try {
                session = registerSession(await createTerminal({
                    id: terminalId,
                    cwd: options.cwd,
                    workspaceId: options.workspaceId,
                    name: options.name ?? defaultName,
                    ...(options.title ? { title: options.title } : {}),
                    ...(options.command ? { command: options.command } : {}),
                    ...(options.args ? { args: options.args } : {}),
                    ...(options.rows !== undefined ? { rows: options.rows } : {}),
                    ...(options.cols !== undefined ? { cols: options.cols } : {}),
                    ...(mergedEnv ? { env: mergedEnv } : {}),
                    activityEnv,
                }));
            }
            catch (error) {
                terminalActivityTokenById.delete(terminalId);
                throw error;
            }
            terminals.push(session);
            terminalsByCwd.set(options.cwd, terminals);
            emitTerminalsChanged({ cwd: options.cwd });
            return session;
        },
        registerCwdEnv(options) {
            assertAbsolutePath(options.cwd);
            defaultEnvByRootCwd.set(resolve(options.cwd), { ...options.env });
        },
        validateTerminalActivityToken(terminalId, token) {
            const expected = terminalActivityTokenById.get(terminalId);
            if (!expected) {
                return "unknown";
            }
            return expected === token ? "valid" : "invalid";
        },
        getTerminal(id) {
            return terminalsById.get(id);
        },
        async getTerminalState(id, options) {
            return terminalsById.get(id)?.getStateSnapshot(options) ?? null;
        },
        setTerminalTitle(id, title) {
            const session = terminalsById.get(id);
            if (!session) {
                return false;
            }
            session.setTitle(title);
            return true;
        },
        async setTerminalActivity(id, state) {
            const session = terminalsById.get(id);
            if (!session) {
                return false;
            }
            session.setActivity(state);
            return true;
        },
        async clearTerminalAttention(id) {
            const session = terminalsById.get(id);
            if (!session) {
                return false;
            }
            return session.clearActivityAttention();
        },
        killTerminal(id) {
            removeSessionById(id, { kill: true });
        },
        async killTerminalAndWait(id, options) {
            const session = terminalsById.get(id);
            if (!session) {
                return;
            }
            try {
                await session.killAndWait(options);
            }
            finally {
                removeSessionById(id, { kill: false });
            }
        },
        async captureTerminal(id, options) {
            const session = terminalsById.get(id);
            if (!session) {
                return {
                    lines: [],
                    totalLines: 0,
                };
            }
            return captureTerminalLines(session, options);
        },
        listDirectories() {
            return Array.from(terminalsByCwd.keys());
        },
        killAll() {
            for (const id of Array.from(terminalsById.keys())) {
                removeSessionById(id, { kill: true });
            }
        },
        subscribeTerminalsChanged(listener) {
            terminalsChangedListeners.add(listener);
            return () => {
                terminalsChangedListeners.delete(listener);
            };
        },
        subscribeTerminalActivity(listener) {
            terminalActivityListeners.add(listener);
            return () => {
                terminalActivityListeners.delete(listener);
            };
        },
        subscribeTerminalWorkspaceContributionChanged(listener) {
            terminalWorkspaceContributionChangedListeners.add(listener);
            return () => {
                terminalWorkspaceContributionChangedListeners.delete(listener);
            };
        },
    };
}
//# sourceMappingURL=terminal-manager.js.map