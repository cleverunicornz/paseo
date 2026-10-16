import type { ProjectIconSource } from "@getpaseo/protocol/messages";
import type { PersistedProjectRecord, ProjectRegistry } from "../server/workspace-registry.js";
import { type ProjectIcon } from "./project-icon.js";
/**
 * The only writer of custom project icons. The client owns image acquisition;
 * this boundary accepts bytes, validates them, and replaces whatever was stored.
 */
export declare function setProjectCustomIcon(input: {
    paseoHome: string;
    projectId: string;
    source: ProjectIconSource;
    projects: ProjectRegistry;
}): Promise<PersistedProjectRecord>;
/** Resolves the icon a project renders with, whichever mode it is in. */
export declare function readProjectIcon(input: {
    paseoHome: string;
    project: PersistedProjectRecord;
}): Promise<ProjectIcon | null>;
export interface ProjectIconSnapshot {
    icon: ProjectIcon | null;
    revision: string;
}
/** Keeps the icon bytes served by a session aligned with its advertised revision. */
export declare class ProjectIconReader {
    private readonly paseoHome;
    private readonly snapshots;
    constructor(paseoHome: string);
    snapshot(project: PersistedProjectRecord): Promise<ProjectIconSnapshot>;
    read(project: PersistedProjectRecord): Promise<ProjectIcon | null>;
}
/** Reads the effective icon and gives that exact result a stable identity. */
export declare function readProjectIconSnapshot(input: {
    paseoHome: string;
    project: PersistedProjectRecord;
}): Promise<ProjectIconSnapshot>;
export declare function removeProjectCustomIcon(input: {
    paseoHome: string;
    projectId: string;
}): Promise<void>;
//# sourceMappingURL=project-custom-icon.d.ts.map