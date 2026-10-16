import { realpathSync } from "node:fs";
import { resolve, sep } from "path";
import { readPaseoConfigForEdit, writePaseoConfigForEdit, } from "../../../utils/paseo-config-file.js";
import { hasUncommittedWorktreeSetupChanges } from "./worktree-setup-commit-status.js";
/**
 * A client's read/write surface for a project's on-disk paseo.json. Resolves the
 * request's repoRoot against the known (non-archived) project roots — accepting a
 * trailing slash or a symlink via realpath — then reads or writes the config
 * substrate and emits the matching response. Reaches no state beyond the injected
 * project registry and the outbound channel.
 */
export class ProjectConfigSession {
    constructor(options) {
        this.host = options.host;
        this.projectRegistry = options.projectRegistry;
        this.logger = options.logger;
    }
    async handleReadProjectConfigRequest(msg) {
        const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
        if (!repoRoot) {
            this.emitProjectConfigReadFailure(msg, { code: "project_not_found" });
            return;
        }
        const result = readPaseoConfigForEdit(repoRoot);
        if (!result.ok) {
            this.logger.warn({ repoRoot, requestId: msg.requestId, outcome: result.error.code }, "Failed to read project config");
            this.emitProjectConfigReadFailure(msg, result.error, repoRoot);
            return;
        }
        if (result.config === null) {
            this.logger.debug({ repoRoot, requestId: msg.requestId, outcome: "missing_project_config" }, "Project config missing");
        }
        const setupCommitStatus = await this.readSetupCommitStatus(repoRoot, result.config);
        this.host.emit({
            type: "read_project_config_response",
            payload: {
                requestId: msg.requestId,
                repoRoot,
                ok: true,
                config: result.config,
                revision: result.revision,
                ...(setupCommitStatus === null
                    ? {}
                    : { hasUncommittedWorktreeSetupChanges: setupCommitStatus }),
            },
        });
    }
    async handleWriteProjectConfigRequest(msg) {
        const repoRoot = await this.resolveKnownProjectRoot(msg.repoRoot);
        if (!repoRoot) {
            this.emitProjectConfigWriteFailure(msg, { code: "project_not_found" });
            return;
        }
        this.logger.debug({ repoRoot, requestId: msg.requestId, outcome: "write_attempt" }, "Writing project config");
        const result = writePaseoConfigForEdit({
            repoRoot,
            config: msg.config,
            expectedRevision: msg.expectedRevision,
        });
        if (!result.ok) {
            this.logger.debug({ repoRoot, requestId: msg.requestId, outcome: result.error.code }, "Project config write did not complete");
            this.emitProjectConfigWriteFailure(msg, result.error, repoRoot);
            return;
        }
        this.logger.debug({ repoRoot, requestId: msg.requestId, outcome: "written" }, "Project config written");
        const setupCommitStatus = await this.readSetupCommitStatus(repoRoot, result.config);
        this.host.emit({
            type: "write_project_config_response",
            payload: {
                requestId: msg.requestId,
                repoRoot,
                ok: true,
                config: result.config,
                revision: result.revision,
                ...(setupCommitStatus === null
                    ? {}
                    : { hasUncommittedWorktreeSetupChanges: setupCommitStatus }),
            },
        });
    }
    async readSetupCommitStatus(repoRoot, config) {
        try {
            return await hasUncommittedWorktreeSetupChanges({ repoRoot, currentConfig: config });
        }
        catch (error) {
            this.logger.debug({ repoRoot, error }, "Could not inspect committed worktree setup");
            return null;
        }
    }
    emitProjectConfigReadFailure(msg, error, repoRoot = msg.repoRoot) {
        this.host.emit({
            type: "read_project_config_response",
            payload: {
                requestId: msg.requestId,
                repoRoot,
                ok: false,
                error,
            },
        });
    }
    emitProjectConfigWriteFailure(msg, error, repoRoot = msg.repoRoot) {
        this.host.emit({
            type: "write_project_config_response",
            payload: {
                requestId: msg.requestId,
                repoRoot,
                ok: false,
                error,
            },
        });
    }
    async resolveKnownProjectRoot(repoRoot) {
        const requestedRoot = canonicalizeConfigRoot(repoRoot);
        const projects = await this.projectRegistry.list();
        for (const project of projects) {
            if (project.archivedAt !== null) {
                continue;
            }
            const projectRoot = canonicalizeConfigRoot(project.rootPath);
            if (requestedRoot === projectRoot) {
                return projectRoot;
            }
        }
        return null;
    }
}
function canonicalizeConfigRoot(repoRoot) {
    const resolved = resolve(repoRoot);
    try {
        return stripTrailingPathSeparators(realpathSync(resolved));
    }
    catch {
        return stripTrailingPathSeparators(resolved);
    }
}
function stripTrailingPathSeparators(path) {
    let normalized = path;
    while (normalized.length > 1 && normalized.endsWith(sep)) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
//# sourceMappingURL=project-config-session.js.map