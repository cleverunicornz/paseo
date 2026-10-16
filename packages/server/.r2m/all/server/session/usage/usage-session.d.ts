import type { ListUsageReportsOptions } from "../../plugins/usage-sources/index.js";
import type pino from "pino";
import type { ProviderUsage, UsageReportEntry } from "@getpaseo/protocol/messages";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
export interface UsageSessionOptions {
    emit(message: SessionOutboundMessage): void;
    runtime?: {
        listUsageReports(options: ListUsageReportsOptions): Promise<UsageReportEntry[]>;
        listLegacyUsage(): Promise<{
            fetchedAt: string;
            providers: ProviderUsage[];
        }>;
    };
    logger: pino.Logger;
}
export declare class UsageSession {
    private readonly options;
    constructor(options: UsageSessionOptions);
    handleListReports(msg: Extract<SessionInboundMessage, {
        type: "usage.list_reports.request";
    }>): Promise<void>;
    handleLegacyList(msg: Extract<SessionInboundMessage, {
        type: "provider.usage.list.request";
    }>): Promise<void>;
}
//# sourceMappingURL=usage-session.d.ts.map