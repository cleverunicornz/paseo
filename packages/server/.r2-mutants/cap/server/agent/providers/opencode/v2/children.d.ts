import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import type { V2Api } from "./api.js";
interface ChildrenOptions {
    client(): V2Api;
    id: string;
    emit(event: AgentStreamEvent): void;
    reconcilePermissions(id: string): Promise<void>;
    bindChild?: (id: string) => void;
}
export declare class SessionChildren {
    private readonly options;
    private readonly children;
    private readonly childStates;
    constructor(options: ChildrenOptions);
    observe(event: import("@opencode/client").OpenCodeEvent): Promise<void>;
    reconcile(parentID: string): Promise<void>;
    private reconcileChild;
}
export {};
//# sourceMappingURL=children.d.ts.map