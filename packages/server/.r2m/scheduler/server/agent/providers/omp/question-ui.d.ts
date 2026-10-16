import type { AgentPermissionRequest, AgentPermissionResponse, AgentProvider } from "../../agent-sdk-types.js";
import type { OmpAgentMessage, OmpRuntimeEvent } from "./rpc-types.js";
type UiRequest = Extract<OmpRuntimeEvent, {
    type: "extension_ui_request";
}>;
interface UiResponse {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
}
type SendResponse = (id: string, response: UiResponse) => void;
/** Owns OMP question mapping and the ask tool's multi-RPC answer sequence. */
export declare class OmpQuestionUi {
    private questions;
    private pending;
    observeMessage(message: OmpAgentMessage): void;
    start(toolName: string, args: unknown): void;
    finish(toolName: string): void;
    handleRequest(event: UiRequest, provider: AgentProvider, send: SendResponse): AgentPermissionRequest | null;
    private mapAsk;
    respond(request: AgentPermissionRequest, response: AgentPermissionResponse, send: SendResponse): void;
    consume(event: UiRequest, send: SendResponse): boolean;
}
export {};
//# sourceMappingURL=question-ui.d.ts.map