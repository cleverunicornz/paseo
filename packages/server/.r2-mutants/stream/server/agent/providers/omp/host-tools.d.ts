import type { Logger } from "pino";
import type { PaseoToolCatalog } from "../../tools/types.js";
import type { OmpRuntimeSession } from "./runtime.js";
import type { OmpMcpBridge } from "./mcp-bridge.js";
import { type OmpRpcHostToolCallRequest, type OmpRpcHostToolDefinition } from "./rpc-types.js";
interface OmpHostToolRouterInput {
    runtimeSession: OmpRuntimeSession;
    catalog?: PaseoToolCatalog;
    bridge?: OmpMcpBridge;
    logger: Logger;
}
export declare function serializeOmpHostTools(catalog: PaseoToolCatalog): OmpRpcHostToolDefinition[];
export declare function handleOmpHostToolRuntimeEvent(event: unknown, router: OmpHostToolRouter | undefined, runtimeSession: OmpRuntimeSession, logger: Logger): boolean;
export declare class OmpHostToolRouter {
    private readonly runtimeSession;
    private readonly catalog?;
    readonly bridge?: OmpMcpBridge;
    private readonly logger;
    private readonly pendingCalls;
    private readonly idleWaiters;
    constructor(input: OmpHostToolRouterInput);
    register(): Promise<string[]>;
    handleCall(request: OmpRpcHostToolCallRequest): void;
    handleCancel(targetId: string): void;
    clear(): void;
    close(): Promise<void>;
    waitForIdle(): Promise<void>;
    private executeCall;
    private resolveIdleWaiters;
    private sendUpdate;
}
export {};
//# sourceMappingURL=host-tools.d.ts.map