import type { AgentPermissionRequest, AgentPermissionResponse, AgentProvider } from "../../agent-sdk-types.js";
import type { OmpRuntimeEvent } from "./rpc-types.js";
export type OmpRpcUiPermissionClassification = {
    kind: "tool";
    request: AgentPermissionRequest;
} | {
    kind: "passthrough";
};
type ExtensionUiRequestEvent = Extract<OmpRuntimeEvent, {
    type: "extension_ui_request";
}>;
export declare function classifyOmpRpcUiPermissionRequest(event: ExtensionUiRequestEvent, options?: {
    provider?: AgentProvider;
}): OmpRpcUiPermissionClassification;
export declare function mapOmpRpcUiPermissionRequest(event: ExtensionUiRequestEvent, options?: {
    provider?: AgentProvider;
}): AgentPermissionRequest | null;
export declare function buildOmpRpcUiPermissionResponse(request: AgentPermissionRequest, response: AgentPermissionResponse): {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
} | null;
export {};
//# sourceMappingURL=rpc-ui-permission-mapper.d.ts.map