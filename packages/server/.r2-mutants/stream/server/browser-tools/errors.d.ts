import type { BrowserAutomationErrorCode, BrowserAutomationExecuteResponse } from "@getpaseo/protocol/browser-automation/rpc-schemas";
export type BrowserToolsResponsePayload = BrowserAutomationExecuteResponse["payload"];
export type BrowserToolsErrorPayload = Extract<BrowserToolsResponsePayload, {
    ok: false;
}>["error"];
export declare class BrowserToolsRequestError extends Error {
    readonly code: BrowserAutomationErrorCode;
    readonly retryable: boolean;
    constructor(error: BrowserToolsErrorPayload);
}
export declare function browserToolsFailure(params: {
    requestId: string;
    code: BrowserAutomationErrorCode;
    message: string;
    retryable?: boolean;
}): BrowserToolsResponsePayload;
export declare function createBrowserToolsRequestError(params: {
    code: BrowserAutomationErrorCode;
    message: string;
    retryable?: boolean;
}): BrowserToolsRequestError;
//# sourceMappingURL=errors.d.ts.map