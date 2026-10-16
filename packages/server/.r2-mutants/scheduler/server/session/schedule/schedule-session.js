export class ScheduleSession {
    constructor(options) {
        this.host = options.host;
        this.scheduleService = options.scheduleService;
        this.logger = options.logger;
    }
    toScheduleSummary(schedule) {
        const { runs: _runs, ...summary } = schedule;
        return summary;
    }
    emitScheduleRpcError(request, error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error({ err: error, requestType: request.type }, "Schedule request failed");
        this.host.emit({
            type: "rpc_error",
            payload: {
                requestId: request.requestId,
                requestType: request.type,
                error: message,
                code: "schedule_request_failed",
            },
        });
    }
    async handleScheduleCreateRequest(request) {
        try {
            const target = request.target.type === "self"
                ? { type: "agent", agentId: request.target.agentId }
                : request.target;
            const schedule = await this.scheduleService.create({
                prompt: request.prompt,
                name: request.name,
                cadence: request.cadence,
                target,
                maxRuns: request.maxRuns,
                expiresAt: request.expiresAt,
                runOnCreate: request.runOnCreate,
            });
            this.host.emit({
                type: "schedule/create/response",
                payload: {
                    requestId: request.requestId,
                    schedule: this.toScheduleSummary(schedule),
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleScheduleListRequest(request) {
        try {
            const schedules = await this.scheduleService.list();
            this.host.emit({
                type: "schedule/list/response",
                payload: {
                    requestId: request.requestId,
                    schedules: schedules.map((schedule) => this.toScheduleSummary(schedule)),
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleScheduleInspectRequest(request) {
        try {
            const schedule = await this.scheduleService.inspect(request.scheduleId);
            this.host.emit({
                type: "schedule/inspect/response",
                payload: {
                    requestId: request.requestId,
                    schedule,
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleScheduleLogsRequest(request) {
        try {
            const runs = await this.scheduleService.logs(request.scheduleId);
            this.host.emit({
                type: "schedule/logs/response",
                payload: {
                    requestId: request.requestId,
                    runs,
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleSchedulePauseRequest(request) {
        try {
            const schedule = await this.scheduleService.pause(request.scheduleId);
            this.host.emit({
                type: "schedule/pause/response",
                payload: {
                    requestId: request.requestId,
                    schedule: this.toScheduleSummary(schedule),
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleScheduleResumeRequest(request) {
        try {
            const schedule = await this.scheduleService.resume(request.scheduleId);
            this.host.emit({
                type: "schedule/resume/response",
                payload: {
                    requestId: request.requestId,
                    schedule: this.toScheduleSummary(schedule),
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleScheduleDeleteRequest(request) {
        try {
            await this.scheduleService.delete(request.scheduleId);
            this.host.emit({
                type: "schedule/delete/response",
                payload: {
                    requestId: request.requestId,
                    scheduleId: request.scheduleId,
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleScheduleRunOnceRequest(request) {
        try {
            const schedule = await this.scheduleService.runOnce(request.scheduleId);
            this.host.emit({
                type: "schedule/run-once/response",
                payload: {
                    requestId: request.requestId,
                    schedule,
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
    async handleScheduleUpdateRequest(request) {
        try {
            const schedule = await this.scheduleService.update({
                id: request.scheduleId,
                ...(request.name !== undefined ? { name: request.name } : {}),
                ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
                ...(request.cadence !== undefined ? { cadence: request.cadence } : {}),
                ...(request.newAgentConfig !== undefined ? { newAgentConfig: request.newAgentConfig } : {}),
                ...(request.maxRuns !== undefined ? { maxRuns: request.maxRuns } : {}),
                ...(request.expiresAt !== undefined ? { expiresAt: request.expiresAt } : {}),
            });
            this.host.emit({
                type: "schedule/update/response",
                payload: {
                    requestId: request.requestId,
                    schedule,
                    error: null,
                },
            });
        }
        catch (error) {
            this.emitScheduleRpcError(request, error);
        }
    }
}
//# sourceMappingURL=schedule-session.js.map