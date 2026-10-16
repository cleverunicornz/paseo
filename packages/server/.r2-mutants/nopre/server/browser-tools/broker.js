import { randomUUID } from "node:crypto";
import { BrowserAutomationExecuteRequestSchema, BrowserAutomationExecuteResponseSchema, } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import { browserToolsFailure } from "./errors.js";
const DEFAULT_BROWSER_TOOLS_TIMEOUT_MS = 15000;
export class BrowserToolsBroker {
    constructor(options) {
        this.clients = new Map();
        this.pending = new Map();
        this.browserHostByBrowserId = new Map();
        this.strandedBrowserHostByBrowserId = new Map();
        this.registrationSequence = 0;
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BROWSER_TOOLS_TIMEOUT_MS;
        this.createRequestId = options.createRequestId ?? (() => `browser_${randomUUID()}`);
    }
    registerClient(client) {
        this.unregisterClient(client.id);
        const registeredAt = ++this.registrationSequence;
        this.clients.set(client.id, {
            client,
            registeredAt,
            supportedCommands: new Set(client.supportedCommands),
        });
        return () => this.unregisterClient(client.id, registeredAt);
    }
    unregisterClient(clientId, registeredAt) {
        const current = this.clients.get(clientId);
        if (!current || (registeredAt !== undefined && current.registeredAt !== registeredAt)) {
            return;
        }
        this.clients.delete(clientId);
        for (const [browserId, ownerClientId] of this.browserHostByBrowserId) {
            if (ownerClientId !== clientId) {
                continue;
            }
            this.browserHostByBrowserId.delete(browserId);
            this.strandedBrowserHostByBrowserId.set(browserId, clientId);
        }
        for (const [requestId, pending] of this.pending) {
            if (pending.clientId !== clientId) {
                continue;
            }
            this.pending.delete(requestId);
            clearTimeout(pending.timeout);
            pending.resolve(browserToolsFailure({
                requestId,
                code: "browser_no_host",
                message: "The browser automation host disconnected before responding.",
                retryable: true,
            }));
        }
    }
    getPendingRequestCount() {
        return this.pending.size;
    }
    getRegisteredClientCount() {
        return this.clients.size;
    }
    async execute(input) {
        const requestId = input.requestId ?? this.createRequestId();
        const request = BrowserAutomationExecuteRequestSchema.safeParse({
            type: "browser.automation.execute.request",
            requestId,
            ...(input.agentId ? { agentId: input.agentId } : {}),
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
            command: input.command,
        });
        if (!request.success) {
            return browserToolsFailure({
                requestId,
                code: "browser_unknown_error",
                message: formatBrowserAutomationValidationError(request.error.issues[0]?.message),
            });
        }
        if (request.data.command.command === "list_tabs") {
            return this.executeListTabs({
                request: request.data,
                timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
            });
        }
        const host = this.selectHostForCommand(request.data.command, requestId);
        if (!host.ok) {
            return host.payload;
        }
        const unsupported = this.unsupportedCommandFailure({
            host: host.value,
            commandName: request.data.command.command,
            requestId,
        });
        if (unsupported) {
            return unsupported;
        }
        return this.sendRequest({
            host: host.value,
            request: request.data,
            timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
        });
    }
    receiveResponse(response, clientIds) {
        const parsed = BrowserAutomationExecuteResponseSchema.safeParse(response);
        if (!parsed.success) {
            const requestId = getBrowserAutomationResponseRequestId(response);
            if (!requestId) {
                return false;
            }
            const pending = this.pending.get(requestId);
            if (!pending || (clientIds && !clientIds.includes(pending.clientId))) {
                return false;
            }
            this.pending.delete(requestId);
            clearTimeout(pending.timeout);
            pending.resolve(browserToolsFailure({
                requestId,
                code: "browser_unknown_error",
                message: formatBrowserAutomationResponseValidationError(parsed.error.issues[0]?.message),
            }));
            return true;
        }
        const pending = this.pending.get(parsed.data.payload.requestId);
        if (!pending || (clientIds && !clientIds.includes(pending.clientId))) {
            return false;
        }
        this.pending.delete(parsed.data.payload.requestId);
        clearTimeout(pending.timeout);
        if (pending.rememberAffinity) {
            this.rememberBrowserHostForPayload(pending.clientId, parsed.data.payload);
        }
        pending.resolve(parsed.data.payload);
        return true;
    }
    async executeListTabs(params) {
        const hosts = Array.from(this.clients.values());
        if (hosts.length === 0) {
            return this.noBrowserHostFailure(params.request.requestId);
        }
        for (const host of hosts) {
            const unsupported = this.unsupportedCommandFailure({
                host,
                commandName: "list_tabs",
                requestId: params.request.requestId,
            });
            if (unsupported) {
                return unsupported;
            }
        }
        if (hosts.length === 1) {
            return this.sendRequest({
                host: hosts[0],
                request: params.request,
                timeoutMs: params.timeoutMs,
            });
        }
        const hostResponses = await Promise.all(hosts.map(async (host) => ({
            host,
            payload: await this.sendRequest({
                host,
                request: {
                    ...params.request,
                    requestId: `${params.request.requestId}:${host.client.id}`,
                },
                rememberAffinity: false,
                timeoutMs: params.timeoutMs,
            }),
        })));
        const failed = hostResponses.find(({ payload }) => !payload.ok);
        if (failed) {
            return withBrowserToolsRequestId(failed.payload, params.request.requestId);
        }
        for (const { host, payload } of hostResponses) {
            this.rememberBrowserHostForPayload(host.client.id, payload);
        }
        return {
            requestId: params.request.requestId,
            ok: true,
            result: {
                command: "list_tabs",
                tabs: hostResponses.flatMap(({ payload }) => payload.ok && payload.result.command === "list_tabs" ? payload.result.tabs : []),
            },
        };
    }
    selectHostForCommand(command, requestId) {
        if (command.command === "new_tab") {
            const host = this.selectMostRecentlyRegisteredHost();
            return host
                ? { ok: true, value: host }
                : { ok: false, payload: this.noBrowserHostFailure(requestId) };
        }
        const browserId = getBrowserIdForCommand(command);
        if (!browserId) {
            const host = this.selectMostRecentlyRegisteredHost();
            return host
                ? { ok: true, value: host }
                : { ok: false, payload: this.noBrowserHostFailure(requestId) };
        }
        const ownerClientId = this.browserHostByBrowserId.get(browserId);
        if (ownerClientId) {
            const host = this.clients.get(ownerClientId);
            if (host) {
                return { ok: true, value: host };
            }
            return {
                ok: false,
                payload: this.strandedBrowserTabFailure({ requestId, browserId }),
            };
        }
        const strandedOwnerClientId = this.strandedBrowserHostByBrowserId.get(browserId);
        if (strandedOwnerClientId) {
            const reconnectedHost = this.clients.get(strandedOwnerClientId);
            if (reconnectedHost) {
                this.strandedBrowserHostByBrowserId.delete(browserId);
                this.browserHostByBrowserId.set(browserId, strandedOwnerClientId);
                return { ok: true, value: reconnectedHost };
            }
            return {
                ok: false,
                payload: this.strandedBrowserTabFailure({ requestId, browserId }),
            };
        }
        if (this.clients.size === 1) {
            const host = this.selectMostRecentlyRegisteredHost();
            if (host) {
                return { ok: true, value: host };
            }
        }
        if (this.clients.size === 0) {
            return { ok: false, payload: this.noBrowserHostFailure(requestId) };
        }
        return {
            ok: false,
            payload: browserToolsFailure({
                requestId,
                code: "browser_tab_not_found",
                message: `Browser tab ${browserId} is not associated with a connected browser automation host. Call browser_list_tabs and use one of the returned browserId values.`,
            }),
        };
    }
    selectMostRecentlyRegisteredHost() {
        let selected = null;
        for (const host of this.clients.values()) {
            selected = host;
        }
        return selected;
    }
    unsupportedCommandFailure(params) {
        if (params.host.supportedCommands.has(params.commandName)) {
            return null;
        }
        return browserToolsFailure({
            requestId: params.requestId,
            code: "browser_unsupported",
            message: `Browser automation command "${params.commandName}" is not supported by the ${describeBrowserHost(params.host)}.`,
        });
    }
    noBrowserHostFailure(requestId) {
        return browserToolsFailure({
            requestId,
            code: "browser_no_host",
            message: "No browser automation host is connected.",
            retryable: true,
        });
    }
    strandedBrowserTabFailure(params) {
        return browserToolsFailure({
            requestId: params.requestId,
            code: "browser_no_host",
            message: `The app hosting browser tab ${params.browserId} disconnected.`,
            retryable: true,
        });
    }
    rememberBrowserHostForPayload(clientId, payload) {
        if (!payload.ok) {
            return;
        }
        if (payload.result.command === "list_tabs") {
            for (const tab of payload.result.tabs) {
                this.browserHostByBrowserId.set(tab.browserId, clientId);
                this.strandedBrowserHostByBrowserId.delete(tab.browserId);
            }
            return;
        }
        if (payload.result.command === "close_tab") {
            this.browserHostByBrowserId.delete(payload.result.browserId);
            this.strandedBrowserHostByBrowserId.delete(payload.result.browserId);
            return;
        }
        if ("browserId" in payload.result) {
            this.browserHostByBrowserId.set(payload.result.browserId, clientId);
            this.strandedBrowserHostByBrowserId.delete(payload.result.browserId);
        }
    }
    sendRequest(params) {
        const { host, request, timeoutMs } = params;
        const client = host.client;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!this.pending.delete(request.requestId)) {
                    return;
                }
                resolve(browserToolsFailure({
                    requestId: request.requestId,
                    code: "browser_timeout",
                    message: `Browser automation timed out after ${timeoutMs}ms.`,
                    retryable: true,
                }));
            }, timeoutMs);
            this.pending.set(request.requestId, {
                clientId: client.id,
                rememberAffinity: params.rememberAffinity ?? true,
                timeout,
                resolve,
            });
            try {
                Promise.resolve(client.sendBrowserAutomationRequest(request)).catch((error) => {
                    resolveSendFailure({
                        requestId: request.requestId,
                        pending: this.pending,
                        timeout,
                        resolve,
                        error,
                    });
                });
            }
            catch (error) {
                resolveSendFailure({
                    requestId: request.requestId,
                    pending: this.pending,
                    timeout,
                    resolve,
                    error,
                });
            }
        });
    }
}
function getBrowserIdForCommand(command) {
    if (command.command === "list_tabs" || command.command === "new_tab") {
        return null;
    }
    return command.args.browserId;
}
function describeBrowserHost(host) {
    const hostKind = host.client.hostKind.trim();
    return hostKind || "browser host";
}
function withBrowserToolsRequestId(payload, requestId) {
    return { ...payload, requestId };
}
function resolveSendFailure(params) {
    if (!params.pending.delete(params.requestId)) {
        return;
    }
    clearTimeout(params.timeout);
    params.resolve(browserToolsFailure({
        requestId: params.requestId,
        code: "browser_unknown_error",
        message: formatBrowserAutomationSendError(params.error),
    }));
}
function formatBrowserAutomationValidationError(message) {
    if (!message) {
        return "Browser automation request is invalid.";
    }
    return `Browser automation request is invalid: ${message}.`;
}
function formatBrowserAutomationResponseValidationError(message) {
    if (!message) {
        return "Browser automation response is invalid.";
    }
    return `Browser automation response is invalid: ${message}.`;
}
function formatBrowserAutomationSendError(error) {
    if (error instanceof Error && error.message) {
        return `Browser automation request failed to send: ${error.message}`;
    }
    return `Browser automation request failed to send: ${String(error)}`;
}
function getBrowserAutomationResponseRequestId(response) {
    if (!isRecord(response)) {
        return null;
    }
    const payload = response.payload;
    if (!isRecord(payload) || typeof payload.requestId !== "string") {
        return null;
    }
    return payload.requestId;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
//# sourceMappingURL=broker.js.map