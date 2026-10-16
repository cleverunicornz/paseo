import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { assertAbsolutePath, isSameOrDescendantPath } from "../server/path-utils.js";
import { deriveTerminalActivityStatusBucket } from "@getpaseo/protocol/terminal-activity";
const REQUEST_TIMEOUT_MS = 10000;
function requiredWorkspaceId(workspaceId) {
    if (workspaceId === undefined) {
        throw new Error("workspaceId is required");
    }
    return workspaceId;
}
function asRequiredWorkerTerminalInfo(info) {
    requiredWorkspaceId(info.workspaceId);
    return info;
}
function createActivityToken() {
    return randomBytes(32).toString("base64url");
}
function resolveWorkerUrl() {
    const currentUrl = import.meta.url;
    if (currentUrl.endsWith(".ts")) {
        return new URL("./terminal-worker-process.ts", currentUrl);
    }
    return new URL("./terminal-worker-process.js", currentUrl);
}
function resolveWorkerExecArgv() {
    if (!import.meta.url.endsWith(".ts")) {
        return [];
    }
    const loaderUrl = new URL("./terminal-ts-loader.mjs", import.meta.url).href;
    const importSource = [
        'import { register } from "node:module";',
        'import { pathToFileURL } from "node:url";',
        `register(${JSON.stringify(loaderUrl)}, pathToFileURL("./"));`,
    ].join(" ");
    return [
        "--experimental-strip-types",
        "--import",
        `data:text/javascript,${encodeURIComponent(importSource)}`,
    ];
}
function isResponse(message) {
    return message.type === "response";
}
function cloneTerminalInfo(info) {
    return {
        id: info.id,
        name: info.name,
        cwd: info.cwd,
        workspaceId: info.workspaceId,
        ...(info.title ? { title: info.title } : {}),
        activity: info.activity,
    };
}
function forkTerminalWorker() {
    return fork(fileURLToPath(resolveWorkerUrl()), [], {
        execArgv: resolveWorkerExecArgv(),
        serialization: "advanced",
        stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
}
export function createWorkerTerminalManager(managerOptions = {}) {
    const worker = managerOptions.forkWorker ? managerOptions.forkWorker() : forkTerminalWorker();
    const requestTimeoutMs = managerOptions.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    const pendingRequests = new Map();
    const recordsById = new Map();
    const terminalIdsByCwd = new Map();
    const terminalActivityTokenById = new Map();
    const terminalsChangedListeners = new Set();
    const terminalActivityListeners = new Set();
    const terminalWorkspaceContributionChangedListeners = new Set();
    let workerExited = false;
    let workerShutdownTimer = null;
    function emitTerminalsChanged(event) {
        for (const listener of Array.from(terminalsChangedListeners)) {
            try {
                listener(event);
            }
            catch {
                // no-op
            }
        }
    }
    function emitTerminalWorkspaceContributionChanged(event) {
        for (const listener of Array.from(terminalWorkspaceContributionChangedListeners)) {
            try {
                listener(event);
            }
            catch {
                // no-op
            }
        }
    }
    function emitTerminalActivityTransition(event) {
        for (const listener of Array.from(terminalActivityListeners)) {
            try {
                listener(event);
            }
            catch {
                // no-op
            }
        }
    }
    function listTerminalItemsForCwd(cwd) {
        const terminalIds = terminalIdsByCwd.get(cwd);
        if (!terminalIds) {
            return [];
        }
        const terminals = [];
        for (const terminalId of terminalIds) {
            const record = recordsById.get(terminalId);
            if (!record) {
                continue;
            }
            terminals.push({
                id: record.info.id,
                name: record.info.name,
                cwd: record.info.cwd,
                workspaceId: record.info.workspaceId,
                ...(record.info.title ? { title: record.info.title } : {}),
                activity: record.activity,
            });
        }
        return terminals;
    }
    function registerRecord(input) {
        const existing = recordsById.get(input.info.id);
        if (existing) {
            existing.info = cloneTerminalInfo(input.info);
            existing.state = input.state;
            return existing.session;
        }
        const record = {
            info: cloneTerminalInfo(input.info),
            state: input.state,
            activity: input.info.activity,
            replayPreamble: "",
            exitInfo: null,
            messageListeners: new Set(),
            exitListeners: new Set(),
            commandFinishedListeners: new Set(),
            titleChangeListeners: new Set(),
            activityChangeListeners: new Set(),
            session: undefined,
        };
        const session = {
            get id() {
                return record.info.id;
            },
            get name() {
                return record.info.name;
            },
            get cwd() {
                return record.info.cwd;
            },
            get workspaceId() {
                return record.info.workspaceId;
            },
            send(message) {
                if (message.type === "resize") {
                    record.state = {
                        ...record.state,
                        rows: message.rows,
                        cols: message.cols,
                    };
                }
                sendBestEffortRequest({ type: "send", terminalId: record.info.id, message });
            },
            subscribe(listener, options) {
                record.messageListeners.add(listener);
                if (options?.initialSnapshot === "ready") {
                    queueMicrotask(() => {
                        if (record.messageListeners.has(listener)) {
                            listener({ type: "snapshotReady", revision: 0 });
                        }
                    });
                }
                return () => {
                    record.messageListeners.delete(listener);
                };
            },
            onExit(listener) {
                if (record.exitInfo) {
                    queueMicrotask(() => listener(record.exitInfo));
                    return () => { };
                }
                record.exitListeners.add(listener);
                return () => {
                    record.exitListeners.delete(listener);
                };
            },
            onCommandFinished(listener) {
                record.commandFinishedListeners.add(listener);
                return () => {
                    record.commandFinishedListeners.delete(listener);
                };
            },
            onTitleChange(listener) {
                record.titleChangeListeners.add(listener);
                if (record.info.title !== undefined) {
                    queueMicrotask(() => {
                        if (record.titleChangeListeners.has(listener)) {
                            listener(record.info.title);
                        }
                    });
                }
                return () => {
                    record.titleChangeListeners.delete(listener);
                };
            },
            onActivityChange(listener) {
                record.activityChangeListeners.add(listener);
                return () => {
                    record.activityChangeListeners.delete(listener);
                };
            },
            getActivity() {
                return record.activity;
            },
            setActivity(state) {
                record.activity = { state, changedAt: Date.now() };
                sendBestEffortRequest({ type: "setActivity", terminalId: record.info.id, state });
            },
            clearActivityAttention() {
                if (record.activity?.attentionReason == null) {
                    return false;
                }
                record.activity = { state: record.activity.state, changedAt: Date.now() };
                sendBestEffortRequest({ type: "clearAttention", terminalId: record.info.id });
                return true;
            },
            getSize() {
                return {
                    rows: record.state.rows,
                    cols: record.state.cols,
                };
            },
            getState() {
                return record.state;
            },
            getStateSnapshot(options) {
                const scrollbackLines = options?.scrollbackLines;
                const scrollback = typeof scrollbackLines === "number"
                    ? record.state.scrollback.slice(-scrollbackLines)
                    : record.state.scrollback;
                return {
                    state: { ...record.state, scrollback },
                    revision: 0,
                };
            },
            getReplayPreamble() {
                // Refreshed from every getTerminalState response, which the controller fetches
                // before every snapshot replay (legacy + visible-snapshot restore). The one
                // gap is restore.mode === "live", which replays without fetching state — there
                // this can be stale/empty. No client sends "live" today; revisit (ship the
                // preamble on the worker's snapshotReady) if one ever does.
                return record.replayPreamble;
            },
            getTitle() {
                return record.info.title;
            },
            setTitle(nextTitle) {
                const manualTitle = nextTitle.trim();
                if (!manualTitle) {
                    return;
                }
                record.info = { ...record.info, title: manualTitle };
                for (const listener of Array.from(record.titleChangeListeners)) {
                    listener(manualTitle);
                }
            },
            getExitInfo() {
                return record.exitInfo;
            },
            kill() {
                sendBestEffortRequest({ type: "killTerminal", terminalId: record.info.id });
            },
            killAndWait(options) {
                return sendRequest({
                    type: "killTerminalAndWait",
                    terminalId: record.info.id,
                    ...(options ? { options } : {}),
                }).then(() => undefined);
            },
        };
        record.session = session;
        recordsById.set(record.info.id, record);
        const terminalIds = terminalIdsByCwd.get(record.info.cwd) ?? new Set();
        terminalIds.add(record.info.id);
        terminalIdsByCwd.set(record.info.cwd, terminalIds);
        return session;
    }
    function removeRecord(terminalId) {
        const record = recordsById.get(terminalId);
        if (!record) {
            return undefined;
        }
        recordsById.delete(terminalId);
        terminalActivityTokenById.delete(terminalId);
        const terminalIds = terminalIdsByCwd.get(record.info.cwd);
        if (terminalIds) {
            terminalIds.delete(terminalId);
            if (terminalIds.size === 0) {
                terminalIdsByCwd.delete(record.info.cwd);
            }
        }
        return record;
    }
    function handleTerminalMessageEvent(message) {
        const record = recordsById.get(message.terminalId);
        if (!record) {
            return;
        }
        if (message.message.type === "snapshot") {
            record.state = message.message.state;
        }
        if (message.message.type === "snapshotReady" && message.message.replayPreamble !== undefined) {
            record.replayPreamble = message.message.replayPreamble;
        }
        for (const listener of Array.from(record.messageListeners)) {
            listener(message.message);
        }
    }
    function handleTerminalExitEvent(message) {
        const record = recordsById.get(message.terminalId);
        if (!record) {
            return;
        }
        record.exitInfo = message.info;
        for (const listener of Array.from(record.exitListeners)) {
            listener(message.info);
        }
        record.exitListeners.clear();
        const previousBucket = deriveTerminalActivityStatusBucket(record.activity);
        const removedRecord = removeRecord(message.terminalId);
        if (previousBucket !== null && removedRecord) {
            emitTerminalWorkspaceContributionChanged({
                terminalId: removedRecord.info.id,
                cwd: removedRecord.info.cwd,
                workspaceId: removedRecord.info.workspaceId,
            });
        }
        emitTerminalsChanged({
            cwd: record.info.cwd,
            terminals: listTerminalItemsForCwd(record.info.cwd),
        });
    }
    function handleTerminalTitleChangeEvent(message) {
        const record = recordsById.get(message.terminalId);
        if (!record) {
            return;
        }
        const nextState = { ...record.state };
        if (message.title) {
            nextState.title = message.title;
        }
        else {
            delete nextState.title;
        }
        record.info = {
            ...record.info,
            ...(message.title ? { title: message.title } : { title: undefined }),
        };
        record.state = nextState;
        for (const listener of Array.from(record.titleChangeListeners)) {
            listener(message.title);
        }
        emitTerminalsChanged({
            cwd: record.info.cwd,
            terminals: listTerminalItemsForCwd(record.info.cwd),
        });
    }
    function handleTerminalCommandFinishedEvent(message) {
        const record = recordsById.get(message.terminalId);
        if (!record) {
            return;
        }
        for (const listener of Array.from(record.commandFinishedListeners)) {
            listener(message.info);
        }
    }
    function handleTerminalActivityChangeEvent(message) {
        const record = recordsById.get(message.terminalId);
        if (!record) {
            return;
        }
        const previousActivity = record.activity;
        record.activity = message.activity;
        const transition = {
            activity: message.activity,
            previous: message.previous,
        };
        for (const listener of Array.from(record.activityChangeListeners)) {
            listener(transition);
        }
        emitTerminalActivityTransition({
            terminalId: record.info.id,
            name: record.info.name,
            cwd: record.info.cwd,
            workspaceId: record.info.workspaceId,
            activity: message.activity,
            previous: message.previous,
        });
        const previousBucket = deriveTerminalActivityStatusBucket(previousActivity);
        const nextBucket = deriveTerminalActivityStatusBucket(message.activity);
        if (previousBucket !== nextBucket) {
            emitTerminalWorkspaceContributionChanged({
                terminalId: record.info.id,
                cwd: record.info.cwd,
                workspaceId: record.info.workspaceId,
            });
        }
        emitTerminalsChanged({
            cwd: record.info.cwd,
            terminals: listTerminalItemsForCwd(record.info.cwd),
        });
    }
    function handleWorkerEvent(message) {
        switch (message.type) {
            case "terminalCreated": {
                registerRecord({
                    info: asRequiredWorkerTerminalInfo(message.terminal),
                    state: message.state,
                });
                emitTerminalsChanged({
                    cwd: message.terminal.cwd,
                    terminals: listTerminalItemsForCwd(message.terminal.cwd),
                });
                return;
            }
            case "terminalMessage": {
                handleTerminalMessageEvent(message);
                return;
            }
            case "terminalExit": {
                handleTerminalExitEvent(message);
                return;
            }
            case "terminalTitleChange": {
                handleTerminalTitleChangeEvent(message);
                return;
            }
            case "terminalCommandFinished": {
                handleTerminalCommandFinishedEvent(message);
                return;
            }
            case "terminalActivityChange": {
                handleTerminalActivityChangeEvent(message);
                return;
            }
        }
    }
    function rejectPendingRequests(error) {
        for (const [requestId, pending] of pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(error);
            pendingRequests.delete(requestId);
        }
    }
    worker.on("message", (message) => {
        if (isResponse(message)) {
            const pending = pendingRequests.get(message.requestId);
            if (!pending) {
                return;
            }
            clearTimeout(pending.timeout);
            pendingRequests.delete(message.requestId);
            if (message.ok) {
                pending.resolve(message.result);
            }
            else {
                pending.reject(new Error(message.error));
            }
            return;
        }
        handleWorkerEvent(message);
    });
    worker.on("exit", (code, signal) => {
        workerExited = true;
        if (workerShutdownTimer) {
            clearTimeout(workerShutdownTimer);
            workerShutdownTimer = null;
        }
        rejectPendingRequests(new Error(`Terminal worker exited (${signal ?? code ?? "unknown"})`));
    });
    function sendRequest(input) {
        if (workerExited || !worker.connected) {
            return Promise.reject(new Error("Terminal worker is not running"));
        }
        const requestId = randomUUID();
        const message = { ...input, requestId };
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingRequests.delete(requestId);
                reject(new Error(`Terminal worker request timed out: ${input.type}`));
            }, requestTimeoutMs);
            pendingRequests.set(requestId, { resolve, reject, timeout });
            worker.send(message, (error) => {
                if (!error) {
                    return;
                }
                clearTimeout(timeout);
                pendingRequests.delete(requestId);
                reject(error);
            });
        });
    }
    function sendBestEffortRequest(input) {
        void sendRequest(input).catch(() => {
            // The public terminal methods that call this are intentionally synchronous.
            // Worker failures are surfaced through awaitable manager methods and worker
            // lifecycle state; do not let fire-and-forget sends crash the daemon.
        });
    }
    return {
        async getTerminals(cwd, options) {
            assertAbsolutePath(cwd);
            // Served from the local mirror, exactly like every other parent read.
            // Terminals are bucketed by exact cwd, but an agent can open a terminal in
            // a subdirectory of the workspace. A query for the workspace root must
            // surface those too, so aggregate every bucket at or below `cwd`.
            const sessions = [];
            for (const [bucketCwd, terminalIds] of terminalIdsByCwd) {
                if (!isSameOrDescendantPath(cwd, bucketCwd)) {
                    continue;
                }
                for (const terminalId of terminalIds) {
                    const session = recordsById.get(terminalId)?.session;
                    if (session) {
                        sessions.push(session);
                    }
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
            const terminalId = options.id ?? randomUUID();
            const activityToken = createActivityToken();
            const terminalActivityUrl = managerOptions.getTerminalActivityUrl?.() ?? null;
            terminalActivityTokenById.set(terminalId, activityToken);
            let result;
            try {
                result = (await sendRequest({
                    type: "createTerminal",
                    options: {
                        ...options,
                        id: terminalId,
                        activityToken,
                        activityUrl: terminalActivityUrl,
                    },
                }));
            }
            catch (error) {
                terminalActivityTokenById.delete(terminalId);
                throw error;
            }
            const session = registerRecord({ info: result.terminal, state: result.state });
            return session;
        },
        registerCwdEnv(options) {
            sendBestEffortRequest({
                type: "registerCwdEnv",
                cwd: options.cwd,
                env: options.env,
            });
        },
        validateTerminalActivityToken(terminalId, token) {
            const expected = terminalActivityTokenById.get(terminalId);
            if (!expected) {
                return "unknown";
            }
            return expected === token ? "valid" : "invalid";
        },
        getTerminal(id) {
            return recordsById.get(id)?.session;
        },
        async getTerminalState(id, options) {
            const snapshot = (await sendRequest({
                type: "getTerminalState",
                terminalId: id,
                ...(options ? { options } : {}),
            }));
            if (snapshot && snapshot.replayPreamble !== undefined) {
                const record = recordsById.get(id);
                if (record) {
                    record.replayPreamble = snapshot.replayPreamble;
                }
            }
            return snapshot;
        },
        setTerminalTitle(id, title) {
            const session = recordsById.get(id)?.session;
            if (!session) {
                return false;
            }
            session.setTitle(title);
            return true;
        },
        async setTerminalActivity(id, state) {
            const record = recordsById.get(id);
            if (!record) {
                return false;
            }
            await sendRequest({ type: "setActivity", terminalId: id, state });
            return true;
        },
        async clearTerminalAttention(id) {
            const record = recordsById.get(id);
            if (!record || record.activity?.attentionReason == null) {
                return false;
            }
            await sendRequest({ type: "clearAttention", terminalId: id });
            return true;
        },
        killTerminal(id) {
            void sendRequest({ type: "killTerminal", terminalId: id }).catch(() => {
                // no-op; kill is intentionally best-effort and synchronous in the public interface.
            });
        },
        async killTerminalAndWait(id, options) {
            await sendRequest({
                type: "killTerminalAndWait",
                terminalId: id,
                ...(options ? { options } : {}),
            });
        },
        async captureTerminal(id, options) {
            return (await sendRequest({
                type: "captureTerminal",
                terminalId: id,
                ...(options?.start === undefined ? {} : { start: options.start }),
                ...(options?.end === undefined ? {} : { end: options.end }),
                ...(options?.stripAnsi === undefined ? {} : { stripAnsi: options.stripAnsi }),
            }));
        },
        listDirectories() {
            return Array.from(terminalIdsByCwd.keys());
        },
        killAll() {
            void sendRequest({ type: "killAll" })
                .catch(() => {
                // no-op
            })
                .finally(() => {
                if (worker.connected) {
                    worker.disconnect();
                }
                if (!worker.killed && !workerShutdownTimer) {
                    workerShutdownTimer = setTimeout(() => {
                        worker.kill();
                    }, 1000);
                }
            });
            for (const terminalId of Array.from(recordsById.keys())) {
                removeRecord(terminalId);
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
export function terminateWorkerTerminalManager(manager) {
    manager.killAll();
}
//# sourceMappingURL=worker-terminal-manager.js.map