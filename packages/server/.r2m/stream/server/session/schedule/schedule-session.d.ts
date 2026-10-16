import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ScheduleService } from "../../schedule/service.js";
export interface ScheduleSessionHost {
    emit(msg: SessionOutboundMessage): void;
}
export interface ScheduleSessionOptions {
    host: ScheduleSessionHost;
    scheduleService: ScheduleService;
    logger: pino.Logger;
}
export declare class ScheduleSession {
    private readonly host;
    private readonly scheduleService;
    private readonly logger;
    constructor(options: ScheduleSessionOptions);
    private toScheduleSummary;
    private emitScheduleRpcError;
    handleScheduleCreateRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/create";
    }>): Promise<void>;
    handleScheduleListRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/list";
    }>): Promise<void>;
    handleScheduleInspectRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/inspect";
    }>): Promise<void>;
    handleScheduleLogsRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/logs";
    }>): Promise<void>;
    handleSchedulePauseRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/pause";
    }>): Promise<void>;
    handleScheduleResumeRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/resume";
    }>): Promise<void>;
    handleScheduleDeleteRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/delete";
    }>): Promise<void>;
    handleScheduleRunOnceRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/run-once";
    }>): Promise<void>;
    handleScheduleUpdateRequest(request: Extract<SessionInboundMessage, {
        type: "schedule/update";
    }>): Promise<void>;
}
//# sourceMappingURL=schedule-session.d.ts.map