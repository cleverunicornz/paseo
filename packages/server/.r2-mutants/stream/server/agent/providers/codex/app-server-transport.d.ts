import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";
import { z } from "zod";
export declare class CodexAppServerRpcError extends Error {
    readonly code: string | number | undefined;
    readonly data: unknown;
    constructor(message: string, code: string | number | undefined, data: unknown);
}
type RequestHandler = (params: unknown, requestId: number) => unknown;
type NotificationHandler = (method: string, params: unknown) => void;
type UnexpectedTerminationHandler = (error: Error) => void;
export interface CodexThreadForkParams {
    threadId: string;
    beforeTurnId?: string | null;
    path?: string | null;
    model?: string | null;
    modelProvider?: string | null;
    serviceTier?: string | null;
    cwd?: string | null;
    runtimeWorkspaceRoots?: string[] | null;
    approvalPolicy?: unknown;
    approvalsReviewer?: unknown;
    sandbox?: unknown;
    permissions?: string | null;
    config?: Record<string, unknown> | null;
    baseInstructions?: string | null;
    developerInstructions?: string | null;
    ephemeral?: boolean;
    threadSource?: unknown;
    excludeTurns?: boolean;
    persistExtendedHistory?: boolean;
}
declare const CodexThreadForkResponseSchema: z.ZodObject<{
    thread: z.ZodObject<{
        id: z.ZodString;
        sessionId: z.ZodOptional<z.ZodString>;
        forkedFromId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        turns: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    }, z.core.$loose>;
    model: z.ZodString;
    modelProvider: z.ZodString;
    serviceTier: z.ZodNullable<z.ZodString>;
    cwd: z.ZodString;
    runtimeWorkspaceRoots: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    instructionSources: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    approvalPolicy: z.ZodUnknown;
    approvalsReviewer: z.ZodUnknown;
    sandbox: z.ZodUnknown;
    activePermissionProfile: z.ZodOptional<z.ZodUnknown>;
    reasoningEffort: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$loose>;
export type CodexThreadForkResponse = z.infer<typeof CodexThreadForkResponseSchema>;
export declare function parseCodexThreadForkResponse(response: unknown): CodexThreadForkResponse;
export interface CodexThreadRollbackParams {
    threadId: string;
    numTurns: number;
}
declare const CodexThreadRollbackResponseSchema: z.ZodObject<{
    thread: z.ZodObject<{
        id: z.ZodString;
        sessionId: z.ZodOptional<z.ZodString>;
        forkedFromId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        turns: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    }, z.core.$loose>;
}, z.core.$loose>;
export type CodexThreadRollbackResponse = z.infer<typeof CodexThreadRollbackResponseSchema>;
export declare function parseCodexThreadRollbackResponse(response: unknown): CodexThreadRollbackResponse;
export interface CodexAppServerTraceContext {
    agentId?: string;
    sessionId?: string;
    turnId?: string;
}
export declare class CodexAppServerClient {
    private readonly child;
    private readonly logger;
    private readonly getTraceContext;
    private readonly rl;
    private readonly pending;
    private readonly requestHandlers;
    private notificationHandler;
    private unexpectedTerminationHandler;
    private nextId;
    private disposed;
    private stderrBuffer;
    constructor(child: ChildProcessWithoutNullStreams, logger: Logger, getTraceContext?: () => CodexAppServerTraceContext);
    setUnexpectedTerminationHandler(handler: UnexpectedTerminationHandler): void;
    setNotificationHandler(handler: NotificationHandler): void;
    setRequestHandler(method: string, handler: RequestHandler): void;
    request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
    forkThread(params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
    rollbackThread(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse>;
    notify(method: string, params?: unknown): void;
    dispose(): Promise<void>;
    private handleUnexpectedTermination;
    private rejectPending;
    private writeJsonRpcResponse;
    private handleLine;
    private traceRawEvent;
}
export {};
//# sourceMappingURL=app-server-transport.d.ts.map