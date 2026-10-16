import type { ProjectCheckoutLitePayload } from "@getpaseo/protocol/messages";
import { type PersistedProjectKind, type PersistedWorkspaceKind } from "./workspace-registry-model.js";
interface DirectoryProjectMembership {
    cwd: string;
    checkout: ProjectCheckoutLitePayload;
    workspaceDirectoryKey: string;
    workspaceKind: PersistedWorkspaceKind;
    workspaceDisplayName: string;
    projectId: string;
    projectKey: string;
    projectName: string;
    projectRootPath: string;
    projectKind: PersistedProjectKind;
}
export declare function classifyDirectoryForProjectMembership(input: {
    cwd: string;
    checkout: ProjectCheckoutLitePayload;
    serverId?: string;
}): DirectoryProjectMembership;
export {};
//# sourceMappingURL=workspace-registry-bootstrap-legacy.d.ts.map