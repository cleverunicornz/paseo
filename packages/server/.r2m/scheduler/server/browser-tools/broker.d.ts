import { type BrowserAutomationCommand, type BrowserAutomationCommandName, type BrowserAutomationExecuteRequest, type BrowserAutomationExecuteResponse } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import { type BrowserToolsResponsePayload } from "./errors.js";
export interface BrowserHostClient {
    id: string;
    hostKind: string;
    supportedCommands: readonly BrowserAutomationCommandName[];
    sendBrowserAutomationRequest(request: BrowserAutomationExecuteRequest): void | Promise<void>;
}
export interface BrowserToolsExecuteInput {
    command: BrowserAutomationCommand;
    agentId?: string;
    cwd?: string;
    workspaceId?: string;
    requestId?: string;
    timeoutMs?: number;
}
export interface BrowserToolsBrokerOptions {
    defaultTimeoutMs?: number;
    createRequestId?: () => string;
}
export declare class BrowserToolsBroker {
    private readonly defaultTimeoutMs;
    private readonly createRequestId;
    private readonly clients;
    private readonly pending;
    private readonly browserHostByBrowserId;
    private readonly strandedBrowserHostByBrowserId;
    private registrationSequence;
    constructor(options: BrowserToolsBrokerOptions);
    registerClient(client: BrowserHostClient): () => void;
    unregisterClient(clientId: string, registeredAt?: number): void;
    getPendingRequestCount(): number;
    getRegisteredClientCount(): number;
    execute(input: BrowserToolsExecuteInput): Promise<BrowserToolsResponsePayload>;
    receiveResponse(response: BrowserAutomationExecuteResponse, clientIds?: readonly string[]): boolean;
    private executeListTabs;
    private selectHostForCommand;
    private selectMostRecentlyRegisteredHost;
    private unsupportedCommandFailure;
    private noBrowserHostFailure;
    private strandedBrowserTabFailure;
    private rememberBrowserHostForPayload;
    private sendRequest;
}
//# sourceMappingURL=broker.d.ts.map