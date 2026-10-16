import type { HubExecutionAgentCreateRequest, HubExecutionAgentValidateRequest, HubExecutionAgentValidationIssue, HubExecutionControlRequest, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { HubExecutionAgents } from "./daemon-executions.js";
interface HubExecutionControllerOptions {
    agents: HubExecutionAgents;
    validateAgentConfiguration: (input: Omit<HubExecutionAgentValidateRequest, "type" | "requestId">) => Promise<HubExecutionAgentValidationIssue[]>;
    send: (message: SessionOutboundMessage) => void;
}
export declare class HubExecutionController {
    private readonly agents;
    private readonly send;
    private readonly validateAgentConfiguration;
    private unsubscribe;
    private readonly pendingCreates;
    private readonly pendingControls;
    private readonly pendingValidations;
    private cleanupPromise;
    private closed;
    constructor(options: HubExecutionControllerOptions);
    get isObserving(): boolean;
    setObserving(observing: boolean): void;
    cleanup(): Promise<void>;
    private cleanupOnce;
    validateAgent(message: HubExecutionAgentValidateRequest): Promise<void>;
    private validateAgentWithResponse;
    controlExecution(message: HubExecutionControlRequest): Promise<void>;
    private controlExecutionWithResponse;
    createAgent(message: HubExecutionAgentCreateRequest): Promise<void>;
    private createAgentWithResponse;
    private sendOwnedEvent;
}
export {};
//# sourceMappingURL=execution-controller.d.ts.map