import { isAbsolute } from "node:path";
import { ProviderOptionsValidationError, ToolPolicyUnsupportedError, } from "../agent/provider-options.js";
export class HubExecutionController {
    constructor(options) {
        this.unsubscribe = null;
        this.pendingCreates = new Set();
        this.pendingControls = new Set();
        this.pendingValidations = new Set();
        this.cleanupPromise = null;
        this.closed = false;
        this.agents = options.agents;
        this.validateAgentConfiguration = options.validateAgentConfiguration;
        this.send = options.send;
    }
    get isObserving() {
        return this.unsubscribe !== null;
    }
    setObserving(observing) {
        if (observing && !this.closed)
            this.unsubscribe ?? (this.unsubscribe = this.agents.subscribe((event) => this.sendOwnedEvent(event)));
        else {
            this.unsubscribe?.();
            this.unsubscribe = null;
        }
    }
    cleanup() {
        this.cleanupPromise ?? (this.cleanupPromise = this.cleanupOnce());
        return this.cleanupPromise;
    }
    async cleanupOnce() {
        this.closed = true;
        this.setObserving(false);
        await Promise.allSettled([
            ...this.pendingCreates,
            ...this.pendingControls,
            ...this.pendingValidations,
        ]);
    }
    async validateAgent(message) {
        if (this.closed)
            return;
        const validation = this.validateAgentWithResponse(message);
        this.pendingValidations.add(validation);
        try {
            await validation;
        }
        finally {
            this.pendingValidations.delete(validation);
        }
    }
    async validateAgentWithResponse(message) {
        let issues = [];
        let error = null;
        try {
            issues = await this.validateAgentConfiguration({
                provider: message.provider,
                model: message.model,
                modeId: message.modeId,
                thinkingOptionId: message.thinkingOptionId,
                providerOptions: message.providerOptions,
            });
        }
        catch (validationError) {
            error = validationError instanceof Error ? validationError.message : String(validationError);
        }
        if (this.closed)
            return;
        this.send({
            type: "hub.execution.agent.validate.response",
            payload: {
                requestId: message.requestId,
                valid: error === null && issues.length === 0,
                issues,
                error,
            },
        });
    }
    async controlExecution(message) {
        if (this.closed)
            return;
        const control = this.controlExecutionWithResponse(message);
        this.pendingControls.add(control);
        try {
            await control;
        }
        finally {
            this.pendingControls.delete(control);
        }
    }
    async controlExecutionWithResponse(message) {
        let error = null;
        try {
            requireNonBlankHubAgentField("executionId", message.executionId);
            await this.agents.control({
                requestId: message.requestId,
                executionId: message.executionId,
                action: message.action,
            });
        }
        catch (controlError) {
            error = controlError instanceof Error ? controlError.message : String(controlError);
        }
        if (this.closed)
            return;
        this.send({
            type: "hub.execution.control.response",
            payload: {
                requestId: message.requestId,
                executionId: message.executionId,
                action: message.action,
                success: error === null,
                error,
            },
        });
    }
    async createAgent(message) {
        if (this.closed)
            return;
        const create = this.createAgentWithResponse(message);
        this.pendingCreates.add(create);
        try {
            await create;
        }
        finally {
            this.pendingCreates.delete(create);
        }
    }
    async createAgentWithResponse(message) {
        try {
            requireNonBlankHubAgentField("executionId", message.executionId);
            requireNonBlankHubAgentField("prompt", message.prompt);
            requireNonBlankHubAgentField("cwd", message.cwd);
            if (!isAbsolute(message.cwd))
                throw new Error("Hub agent cwd must be absolute");
            const result = await this.agents.create({
                executionId: message.executionId,
                provider: message.provider,
                cwd: message.cwd,
                prompt: message.prompt,
                model: message.model,
                modeId: message.modeId,
                thinkingOptionId: message.thinkingOptionId,
                featureValues: message.featureValues,
                providerOptions: message.providerOptions,
                toolPolicy: message.toolPolicy,
                env: message.env,
                mcpServers: message.mcpServers,
                worktree: message.worktree,
            });
            if (this.closed)
                return;
            this.send({
                type: "hub.execution.agent.create.response",
                payload: {
                    requestId: message.requestId,
                    executionId: message.executionId,
                    agentId: result.agent.id,
                    agent: result.agent,
                    success: true,
                    ...(message.toolPolicy ? { toolPolicyApplied: true } : {}),
                    error: null,
                },
            });
        }
        catch (error) {
            if (this.closed)
                return;
            this.send({
                type: "hub.execution.agent.create.response",
                payload: {
                    requestId: message.requestId,
                    executionId: message.executionId,
                    agentId: null,
                    agent: null,
                    success: false,
                    error: toHubCreateError(error),
                },
            });
        }
    }
    sendOwnedEvent(event) {
        if (this.closed)
            return;
        if (event.type === "update") {
            this.send({
                type: "hub.execution.agent.update",
                payload: {
                    executionId: event.executionId,
                    agentId: event.agent.id,
                    agent: event.agent,
                },
            });
            return;
        }
        this.send({
            type: "hub.execution.agent.stream",
            payload: {
                executionId: event.executionId,
                agentId: event.agentId,
                event: event.event,
            },
        });
    }
}
function toHubCreateError(error) {
    if (error instanceof ProviderOptionsValidationError) {
        return {
            code: error.code,
            provider: error.provider,
            issues: error.issues,
            message: error.message,
        };
    }
    if (error instanceof ToolPolicyUnsupportedError) {
        return {
            code: error.code,
            provider: error.provider,
            message: error.message,
        };
    }
    return {
        code: "create_failed",
        message: error instanceof Error ? error.message : String(error),
    };
}
function requireNonBlankHubAgentField(field, value) {
    if (value.trim().length === 0) {
        throw new Error(`Hub agent ${field} cannot be blank`);
    }
}
//# sourceMappingURL=execution-controller.js.map