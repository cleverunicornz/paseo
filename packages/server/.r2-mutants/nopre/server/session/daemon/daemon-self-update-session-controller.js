import { daemonSelfUpdater, DaemonSelfUpdateInProgressError, } from "./daemon-self-updater.js";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
const DAEMON_SELF_UPDATE_MESSAGE_TYPES = new Set([
    "daemon.update.request",
]);
function isDaemonSelfUpdateMessage(msg) {
    return DAEMON_SELF_UPDATE_MESSAGE_TYPES.has(msg.type);
}
export class DaemonSelfUpdateSessionController {
    constructor(options) {
        this.clientId = options.clientId;
        this.daemonVersion = options.daemonVersion;
        this.desktopManaged = options.desktopManaged === true;
        this.emit = options.emit;
        this.emitLifecycleIntent = options.emitLifecycleIntent;
        this.sessionLogger = options.sessionLogger;
        this.updater = options.updater ?? daemonSelfUpdater;
    }
    dispatch(msg) {
        if (!isDaemonSelfUpdateMessage(msg)) {
            return undefined;
        }
        return this.handleDaemonUpdateRequest(msg);
    }
    async handleDaemonUpdateRequest(msg) {
        const previousVersion = this.daemonVersion;
        try {
            const result = await this.updater.update({
                daemonVersion: previousVersion,
                desktopManaged: this.desktopManaged,
                onProgress: (phase) => this.emitProgress(msg.requestId, phase),
                logger: this.sessionLogger,
            });
            this.emitResponse({
                requestId: msg.requestId,
                success: result.success,
                error: result.error,
                previousVersion,
                newVersion: result.newVersion,
            });
            if (!result.success) {
                return;
            }
            this.emitLifecycleIntent({
                type: "restart",
                clientId: this.clientId,
                requestId: msg.requestId,
                reason: "daemon_update",
            });
        }
        catch (error) {
            if (error instanceof DaemonSelfUpdateInProgressError) {
                this.emit({
                    type: "rpc_error",
                    payload: {
                        requestId: msg.requestId,
                        requestType: "daemon.update.request",
                        error: error.message,
                        code: "already_updating",
                    },
                });
                return;
            }
            this.sessionLogger.error({ err: error }, "Daemon update failed with exception");
            this.emitResponse({
                requestId: msg.requestId,
                success: false,
                error: getErrorMessage(error),
                previousVersion,
                newVersion: null,
            });
        }
    }
    emitProgress(requestId, phase) {
        this.emit({
            type: "daemon.update.progress",
            payload: {
                requestId,
                phase,
            },
        });
    }
    emitResponse(payload) {
        this.emit({
            type: "daemon.update.response",
            payload,
        });
    }
}
//# sourceMappingURL=daemon-self-update-session-controller.js.map