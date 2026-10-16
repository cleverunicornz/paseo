import type { ProjectCreateDirectoryErrorCode } from "@getpaseo/protocol/messages";
import type { PersistedProjectRecord } from "./workspace-registry.js";
export declare class ProjectDirectoryRequestError extends Error {
    readonly code: ProjectCreateDirectoryErrorCode;
    readonly directoryPath: string | null;
    constructor(code: ProjectCreateDirectoryErrorCode, message: string, directoryPath?: string | null);
}
export interface CreateProjectDirectoryInput {
    parentPath: string;
    name: string;
}
export interface CreateProjectDirectoryResult {
    directoryPath: string;
    project: PersistedProjectRecord;
}
interface ProjectDirectoryFileSystem {
    stat(path: string): Promise<{
        isDirectory(): boolean;
    }>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
}
interface CreateProjectDirectoryDependencies {
    filesystem?: ProjectDirectoryFileSystem;
    registerProject(directoryPath: string): Promise<PersistedProjectRecord>;
}
export declare function createProjectDirectory(input: CreateProjectDirectoryInput, dependencies: CreateProjectDirectoryDependencies): Promise<CreateProjectDirectoryResult>;
export declare function validateDirectoryName(name: string): void;
export {};
//# sourceMappingURL=project-directory-service.d.ts.map