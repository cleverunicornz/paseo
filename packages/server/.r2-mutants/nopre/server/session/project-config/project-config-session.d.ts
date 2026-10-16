import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProjectRegistry } from "../../workspace-registry.js";
export interface ProjectConfigSessionHost {
    emit(msg: SessionOutboundMessage): void;
}
export interface ProjectConfigSessionOptions {
    host: ProjectConfigSessionHost;
    projectRegistry: Pick<ProjectRegistry, "list">;
    logger: pino.Logger;
}
/**
 * A client's read/write surface for a project's on-disk paseo.json. Resolves the
 * request's repoRoot against the known (non-archived) project roots — accepting a
 * trailing slash or a symlink via realpath — then reads or writes the config
 * substrate and emits the matching response. Reaches no state beyond the injected
 * project registry and the outbound channel.
 */
export declare class ProjectConfigSession {
    private readonly host;
    private readonly projectRegistry;
    private readonly logger;
    constructor(options: ProjectConfigSessionOptions);
    handleReadProjectConfigRequest(msg: Extract<SessionInboundMessage, {
        type: "read_project_config_request";
    }>): Promise<void>;
    handleWriteProjectConfigRequest(msg: Extract<SessionInboundMessage, {
        type: "write_project_config_request";
    }>): Promise<void>;
    private readSetupCommitStatus;
    private emitProjectConfigReadFailure;
    private emitProjectConfigWriteFailure;
    private resolveKnownProjectRoot;
}
//# sourceMappingURL=project-config-session.d.ts.map