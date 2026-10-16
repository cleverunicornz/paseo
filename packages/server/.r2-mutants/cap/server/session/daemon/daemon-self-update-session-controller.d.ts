import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { type DaemonSelfUpdater } from "./daemon-self-updater.js";
interface DaemonSelfUpdateRestartIntent {
    type: "restart";
    clientId: string;
    requestId: string;
    reason: string;
}
export interface DaemonSelfUpdateSessionControllerOptions {
    clientId: string;
    daemonVersion: string | null;
    desktopManaged?: boolean;
    emit: (msg: SessionOutboundMessage) => void;
    emitLifecycleIntent: (intent: DaemonSelfUpdateRestartIntent) => void;
    sessionLogger: pino.Logger;
    updater?: Pick<DaemonSelfUpdater, "update">;
}
export declare class DaemonSelfUpdateSessionController {
    private readonly clientId;
    private readonly daemonVersion;
    private readonly desktopManaged;
    private readonly emit;
    private readonly emitLifecycleIntent;
    private readonly sessionLogger;
    private readonly updater;
    constructor(options: DaemonSelfUpdateSessionControllerOptions);
    dispatch(msg: SessionInboundMessage): Promise<void> | undefined;
    private handleDaemonUpdateRequest;
    private emitProgress;
    private emitResponse;
}
export {};
//# sourceMappingURL=daemon-self-update-session-controller.d.ts.map