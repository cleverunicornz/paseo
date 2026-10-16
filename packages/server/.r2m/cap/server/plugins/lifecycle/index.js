import { z } from "zod";
import { CreateAgentRequestMessageSchema } from "@getpaseo/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { WorkspaceCreateRequestSchema } from "@getpaseo/protocol/messages";
export const lifecycleEventNames = [
    "agent.created",
    "agent.closed",
    "agent.turn_started",
    "agent.turn_ended",
    "agent.permission_requested",
    "agent.permission_resolved",
    "agent.archived",
    "workspace.created",
    "workspace.archived",
];
export const beforeHookNames = ["agent.create", "agent.session_open", "workspace.create"];
const beforeSchemas = {
    "agent.create": CreateAgentRequestMessageSchema.pick({ config: true, env: true }).strict(),
    "agent.session_open": z
        .object({
        agentId: z.string(),
        workspaceId: z.string().nullable(),
        provider: z.string(),
        cwd: z.string(),
        reason: z.enum(["create", "resume", "refresh", "import"]),
        purpose: z.enum(["interactive", "history"]),
        env: z.record(z.string(), z.string()),
    })
        .strict(),
    "workspace.create": WorkspaceCreateRequestSchema.omit({ type: true, requestId: true }).strict(),
};
export function validateBeforeRequest(name, value) {
    return beforeSchemas[name].parse(value);
}
export function describeHookWorkspace(workspace) {
    return {
        id: workspace.workspaceId,
        projectId: workspace.projectId,
        cwd: workspace.cwd,
        name: workspace.title,
        archivedAt: workspace.archivedAt,
    };
}
export function describeHookAgent(agent) {
    return {
        id: agent.id,
        workspaceId: agent.workspaceId ?? null,
        parentAgentId: agent.labels[PARENT_AGENT_ID_LABEL] ?? null,
        provider: agent.provider,
        cwd: agent.cwd,
        title: agent.title ?? null,
    };
}
export function publishAgentStream(lifecycle, agent, event, timeline) {
    if (event.type === "turn_started") {
        lifecycle.emit("agent.turn_started", { agent, turnId: event.turnId ?? null });
    }
    else if (event.type === "turn_completed") {
        lifecycle.emit("agent.turn_ended", {
            agent,
            turnId: event.turnId ?? null,
            timeline,
            outcome: { kind: "completed" },
        });
    }
    else if (event.type === "turn_failed") {
        lifecycle.emit("agent.turn_ended", {
            agent,
            turnId: event.turnId ?? null,
            timeline,
            outcome: { kind: "failed", error: { message: event.error, code: event.code } },
        });
    }
    else if (event.type === "turn_canceled") {
        lifecycle.emit("agent.turn_ended", {
            agent,
            turnId: event.turnId ?? null,
            timeline,
            outcome: { kind: "canceled", reason: event.reason },
        });
    }
    else if (event.type === "permission_requested") {
        lifecycle.emit("agent.permission_requested", { agent, request: event.request });
    }
    else if (event.type === "permission_resolved") {
        lifecycle.emit("agent.permission_resolved", {
            agent,
            requestId: event.requestId,
            resolution: event.resolution,
        });
    }
}
export function validateBeforeResult(name, input, output) {
    const result = validateBeforeRequest(name, output);
    if (name === "agent.session_open") {
        const previous = beforeSchemas["agent.session_open"].parse(input);
        const next = beforeSchemas["agent.session_open"].parse(result);
        if (previous.agentId !== next.agentId ||
            previous.workspaceId !== next.workspaceId ||
            previous.provider !== next.provider ||
            previous.cwd !== next.cwd ||
            previous.reason !== next.reason ||
            previous.purpose !== next.purpose) {
            throw new Error("agent.session_open hooks can only change env");
        }
    }
    if (name === "agent.create") {
        const previous = beforeSchemas["agent.create"].parse(input);
        const next = beforeSchemas["agent.create"].parse(result);
        if (previous.config.cwd !== next.config.cwd) {
            throw new Error("agent.create hooks cannot change the workspace directory");
        }
    }
    return result;
}
export class PluginHookHandlers {
    constructor(changed) {
        this.events = new Map();
        this.transforms = new Map();
        this.active = new Map();
        this.on = (name, handler) => {
            if (!lifecycleEventNames.includes(name)) {
                throw new Error(`Unknown lifecycle event: ${name}`);
            }
            return this.register(this.events, name, handler);
        };
        this.before = (name, handler) => {
            if (!beforeHookNames.includes(name)) {
                throw new Error(`Unknown before hook: ${name}`);
            }
            return this.register(this.transforms, name, handler);
        };
        this.changed = changed;
    }
    catalog() {
        return { events: [...this.events.keys()], before: [...this.transforms.keys()] };
    }
    async invoke(id, kind, name, input, paseo) {
        const controller = new AbortController();
        this.active.set(id, controller);
        try {
            if (kind === "before") {
                if (!beforeHookNames.includes(name)) {
                    throw new Error(`Unknown before hook: ${name}`);
                }
                const hookName = name;
                let request = validateBeforeRequest(hookName, input);
                for (const handler of this.transforms.get(name) ?? []) {
                    controller.signal.throwIfAborted();
                    const result = await handler({ request: structuredClone(request) }, { paseo, signal: controller.signal });
                    if (result !== undefined) {
                        request = validateBeforeResult(hookName, request, result);
                    }
                }
                return request;
            }
            for (const handler of this.events.get(name) ?? []) {
                controller.signal.throwIfAborted();
                try {
                    await handler(structuredClone(input), { paseo, signal: controller.signal });
                }
                catch (error) {
                    console.error(`Lifecycle hook ${name} failed`, error);
                }
            }
            return null;
        }
        finally {
            this.active.delete(id);
        }
    }
    cancel(id) {
        this.active.get(id)?.abort();
    }
    close() {
        for (const controller of this.active.values()) {
            controller.abort();
        }
        this.events.clear();
        this.transforms.clear();
    }
    register(registry, name, handler) {
        let handlers = registry.get(name);
        if (!handlers) {
            handlers = new Set();
            registry.set(name, handlers);
        }
        handlers.add(handler);
        this.changed();
        return () => {
            if (!handlers.delete(handler)) {
                return;
            }
            if (handlers.size === 0) {
                registry.delete(name);
            }
            this.changed();
        };
    }
}
//# sourceMappingURL=index.js.map