import { randomUUID } from "node:crypto";
import { VersionedCollection } from "./internal/versioned-collection.js";
/** Daemon-global latest-state sequence owner for the active app directory. */
export class DirectorySyncService {
    constructor(generation = randomUUID()) {
        this.projects = new VersionedCollection({
            getId: (project) => project.projectId,
        });
        this.workspaces = new VersionedCollection({
            getId: (workspace) => workspace.id,
        });
        this.agents = new VersionedCollection({
            getId: (entry) => entry.agent.id,
        });
        this.generation = generation;
    }
    synchronizeProjects(snapshot, cursor) {
        this.projects.replaceAll(snapshot);
        const read = this.read(this.projects, cursor);
        return {
            projects: read.values.map(({ seq, value }) => ({ ...value, syncSeq: seq })),
            sync: this.metadata(read),
        };
    }
    synchronizeWorkspaces(snapshot, cursor) {
        this.workspaces.replaceAll(snapshot);
        const read = this.read(this.workspaces, cursor);
        return {
            entries: read.values.map(({ seq, value }) => ({ ...value, syncSeq: seq })),
            emptyProjects: [],
            pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
            sync: this.metadata(read),
        };
    }
    synchronizeAgents(snapshot, cursor) {
        this.agents.replaceAll(snapshot);
        const read = this.read(this.agents, cursor);
        return {
            entries: read.values.map(({ seq, value }) => ({ ...value, syncSeq: seq })),
            pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
            sync: this.metadata(read),
        };
    }
    sequenceProjectUpdate(update, includeSequence) {
        if (update.kind === "upsert") {
            this.projects.replace(update.project);
        }
        else {
            this.projects.remove(update.projectId);
        }
        const id = update.kind === "upsert" ? update.project.projectId : update.projectId;
        return this.withVersion(update, includeSequence, this.version(this.projects, id));
    }
    sequenceWorkspaceUpdate(payload, value, id, includeSequence) {
        if (value) {
            this.workspaces.replace(value);
        }
        else {
            this.workspaces.remove(id);
        }
        return this.withVersion(payload, includeSequence, this.version(this.workspaces, id));
    }
    sequenceAgentUpdate(payload, value, id, includeSequence) {
        if (value) {
            this.agents.replace(value);
        }
        else {
            this.agents.remove(id);
        }
        return this.withVersion(payload, includeSequence, this.version(this.agents, id));
    }
    metadata(read) {
        return {
            generation: this.generation,
            headSeq: read.headSeq,
            mode: read.mode,
            ...(read.reason ? { reason: read.reason } : {}),
            removals: read.removals,
        };
    }
    withVersion(payload, includeSequence, version) {
        return version && includeSequence ? { ...payload, ...version } : payload;
    }
    read(collection, cursor) {
        if (cursor.generation !== this.generation) {
            return collection.readSnapshot(cursor.generation === undefined ? "no_cursor" : "generation_changed");
        }
        if (cursor.afterSeq === undefined) {
            return collection.readSnapshot("no_cursor");
        }
        return collection.readAfter(cursor.afterSeq);
    }
    version(collection, id) {
        const seq = collection.sequenceFor(id);
        return seq === null ? null : { generation: this.generation, seq };
    }
}
//# sourceMappingURL=index.js.map