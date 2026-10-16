import type { Logger } from "pino";
import type { AgentPermissionRequest, AgentPermissionResponse, AgentStreamEvent } from "../../../agent-sdk-types.js";
import type { PiAgentMessage } from "../rpc-types.js";
import { mapPiChildSession } from "./child-session.js";
import type { PiExtension, PiExtensionCustomMapping, PiExtensionDialog, PiExtensionDialogMapping, PiExtensionToolCall, PiExtensionToolMapping, PiExtensionUiReply } from "./contract.js";
export type PiExtensionOutput<T> = T & {
    events: AgentStreamEvent[];
    hydration: Promise<AgentStreamEvent[]>;
};
export type PiExtensionEventOutput = PiExtensionOutput<PiExtensionToolMapping | PiExtensionCustomMapping>;
export declare class PiExtensionHost {
    private readonly logger?;
    private readonly readChildSession;
    private readonly sessions;
    private remainingHydrationBytes;
    private readonly followers;
    private onFollowEvent?;
    private followTimer?;
    private pollingExtensions;
    constructor(extensions: readonly PiExtension[], logger?: Pick<Logger, "warn"> | undefined, hydrationByteBudget?: number, readChildSession?: typeof mapPiChildSession);
    /** Live sessions follow child files and adapter polls; replay hosts read each file once. */
    follow(onEvent: (event: AgentStreamEvent) => void): void;
    close(): void;
    private readFollower;
    private pollExtensions;
    private safe;
    mapToolCall(call: PiExtensionToolCall): PiExtensionOutput<PiExtensionToolMapping> | undefined;
    mapCustomMessage(message: Extract<PiAgentMessage, {
        role: "custom";
    }>): PiExtensionOutput<PiExtensionCustomMapping> | undefined;
    mapRuntimeNotification(message: string): PiExtensionOutput<PiExtensionCustomMapping> | undefined;
    private prepare;
    private followChildren;
    private readChildren;
    onToolStart(call: PiExtensionToolCall, provider?: string): AgentPermissionRequest | undefined;
    onToolEnd(call: PiExtensionToolCall): void;
    mapDialog(dialog: PiExtensionDialog, provider: string): PiExtensionDialogMapping | undefined;
    respondToPermission(request: AgentPermissionRequest, response: AgentPermissionResponse): PiExtensionUiReply | undefined;
}
//# sourceMappingURL=host.d.ts.map