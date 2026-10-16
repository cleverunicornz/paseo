import { resolve } from "node:path";
import type { Logger } from "pino";
import { archiveIfSafe, type AutoArchiveArchiveOptions } from "./archive-if-safe.js";
import type { WorkspaceGitSubscription } from "../workspace-git-service.js";
export interface AutoArchiveOnMergeOptions extends AutoArchiveArchiveOptions {
    logger: Logger;
}
export interface AutoArchiveOnMergeDependencies {
    archiveIfSafe: typeof archiveIfSafe;
    resolvePath: typeof resolve;
}
export declare function setupAutoArchiveOnMerge(options: AutoArchiveOnMergeOptions, deps?: AutoArchiveOnMergeDependencies): WorkspaceGitSubscription;
//# sourceMappingURL=index.d.ts.map