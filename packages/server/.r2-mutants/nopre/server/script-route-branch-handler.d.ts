import type { Logger } from "pino";
import type { ServiceProxySubsystem } from "./service-proxy.js";
interface BranchChangeRouteHandlerOptions {
    serviceProxy: ServiceProxySubsystem;
    onRoutesChanged: (workspaceId: string) => void;
    logger?: Logger;
}
export declare function createBranchChangeRouteHandler(options: BranchChangeRouteHandlerOptions): (workspaceId: string, oldBranch: string | null, newBranch: string | null) => void;
export {};
//# sourceMappingURL=script-route-branch-handler.d.ts.map