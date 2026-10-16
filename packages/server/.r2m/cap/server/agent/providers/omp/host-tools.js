import { addModelVisibleStructuredContent, serializePaseoToolInputParameters, } from "../../tools/paseo-tool-serialization.js";
import { OmpRpcHostToolCallRequestSchema, OmpRpcHostToolCancelRequestSchema, OmpRpcHostToolUpdateSchema, } from "./rpc-types.js";
export function serializeOmpHostTools(catalog) {
    return [...catalog.tools.values()].map((tool) => {
        const definition = {
            name: tool.name,
            description: tool.description,
            loadMode: "essential",
            parameters: serializePaseoToolInputParameters(tool),
        };
        if (tool.title) {
            definition.label = tool.title;
        }
        return definition;
    });
}
export function handleOmpHostToolRuntimeEvent(event, router, runtimeSession, logger) {
    if (!isRecord(event) || typeof event.type !== "string" || !isOmpHostToolEventType(event.type)) {
        return false;
    }
    const call = OmpRpcHostToolCallRequestSchema.safeParse(event);
    if (call.success) {
        if (!router) {
            sendMissingCatalogResult(runtimeSession, call.data);
            return true;
        }
        router.handleCall(call.data);
        return true;
    }
    const cancel = OmpRpcHostToolCancelRequestSchema.safeParse(event);
    if (cancel.success) {
        router?.handleCancel(cancel.data.targetId);
        return true;
    }
    const update = OmpRpcHostToolUpdateSchema.safeParse(event);
    if (update.success) {
        logger.debug({ id: update.data.id }, "Ignoring unexpected inbound OMP host tool update");
        return true;
    }
    logger.debug({ event }, "Dropped malformed OMP host tool frame");
    return true;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sendMissingCatalogResult(runtimeSession, request) {
    runtimeSession.sendHostToolResult(toOmpHostToolErrorResult(request.id, `Host tool "${request.toolName}" was called before Paseo tools were registered`));
}
function isOmpHostToolEventType(type) {
    return type === "host_tool_call" || type === "host_tool_cancel" || type === "host_tool_update";
}
export class OmpHostToolRouter {
    constructor(input) {
        this.pendingCalls = new Map();
        this.idleWaiters = new Set();
        this.runtimeSession = input.runtimeSession;
        this.catalog = input.catalog;
        this.bridge = input.bridge;
        this.logger = input.logger;
    }
    async register() {
        return await this.runtimeSession.setHostTools([
            ...(this.catalog ? serializeOmpHostTools(this.catalog) : []),
            ...(this.bridge?.definitions ?? []),
        ]);
    }
    handleCall(request) {
        const entry = {
            controller: new AbortController(),
            canceled: false,
        };
        this.pendingCalls.set(request.id, entry);
        void this.executeCall(request, entry).catch((error) => {
            this.logger.warn({ err: error, toolName: request.toolName }, "OMP host tool call failed");
        });
    }
    handleCancel(targetId) {
        const pending = this.pendingCalls.get(targetId);
        if (!pending) {
            return;
        }
        pending.canceled = true;
        pending.controller.abort(new Error(`OMP host tool call ${targetId} cancelled`));
    }
    clear() {
        for (const pending of this.pendingCalls.values()) {
            pending.canceled = true;
            pending.controller.abort(new Error("OMP session closed"));
        }
        this.pendingCalls.clear();
        this.resolveIdleWaiters();
    }
    async close() {
        this.clear();
        await this.bridge?.close();
    }
    waitForIdle() {
        if (this.pendingCalls.size === 0)
            return Promise.resolve();
        return new Promise((resolve) => this.idleWaiters.add(resolve));
    }
    async executeCall(request, entry) {
        try {
            const result = this.bridge?.tool(request.toolName)
                ? await this.bridge.execute(request.toolName, request.arguments, entry.controller.signal)
                : ((await this.catalog?.executeTool(request.toolName, request.arguments, {
                    signal: entry.controller.signal,
                    sendUpdate: (update) => {
                        if (entry.canceled || entry.controller.signal.aborted) {
                            return;
                        }
                        this.sendUpdate(request.id, update);
                    },
                })) ?? {
                    content: [{ type: "text", text: `Unknown host tool: ${request.toolName}` }],
                    isError: true,
                });
            if (entry.canceled || entry.controller.signal.aborted) {
                return;
            }
            this.runtimeSession.sendHostToolResult(toOmpHostToolResult(request.id, result));
        }
        catch (error) {
            if (entry.canceled || entry.controller.signal.aborted) {
                return;
            }
            this.runtimeSession.sendHostToolResult(toOmpHostToolErrorResult(request.id, error));
        }
        finally {
            this.pendingCalls.delete(request.id);
            this.resolveIdleWaiters();
        }
    }
    resolveIdleWaiters() {
        if (this.pendingCalls.size > 0)
            return;
        for (const resolve of this.idleWaiters)
            resolve();
        this.idleWaiters.clear();
    }
    sendUpdate(callId, result) {
        const update = {
            type: "host_tool_update",
            id: callId,
            partialResult: toOmpAgentToolResult(addModelVisibleStructuredContent(result)),
        };
        this.runtimeSession.sendHostToolUpdate(update);
    }
}
function toOmpHostToolResult(id, result) {
    const modelVisibleResult = addModelVisibleStructuredContent(result);
    const mappedResult = toOmpAgentToolResult(modelVisibleResult);
    return {
        type: "host_tool_result",
        id,
        result: mappedResult,
        ...(modelVisibleResult.isError !== undefined ? { isError: modelVisibleResult.isError } : {}),
    };
}
function toOmpHostToolErrorResult(id, error) {
    return {
        type: "host_tool_result",
        id,
        result: {
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
            details: {},
            isError: true,
        },
        isError: true,
    };
}
function toOmpAgentToolResult(result) {
    const mapped = {
        content: result.content.map((item) => ({ ...item })),
    };
    if (result.structuredContent !== undefined) {
        mapped.details = result.structuredContent;
    }
    if (result.isError !== undefined) {
        mapped.isError = result.isError;
    }
    return mapped;
}
//# sourceMappingURL=host-tools.js.map