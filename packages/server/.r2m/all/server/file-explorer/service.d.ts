export type ExplorerEntryKind = "file" | "directory";
export type ExplorerFileKind = "text" | "image" | "binary";
export type ExplorerEncoding = "utf-8" | "base64" | "none";
export interface ListDirectoryParams {
    root: string;
    relativePath?: string;
}
export interface ReadFileParams {
    root: string;
    relativePath: string;
}
export interface WriteFileParams extends ReadFileParams {
    content: string;
    expectedModifiedAt: string;
    expectedRevision?: string;
}
export type ExplorerFileVersion = {
    status: "ready";
    cwd: string;
    path: string;
    size: number;
    modifiedAt: string;
    revision: string;
} | {
    status: "missing";
    cwd: string;
    path: string;
} | {
    status: "error";
    cwd: string;
    path: string;
    error: string;
};
export type ExplorerFileWriteResult = {
    status: "written";
    modifiedAt: string;
    size: number;
    revision: string;
} | {
    status: "conflict";
    version: ExplorerFileVersion;
} | {
    status: "error";
    error: string;
};
export interface FileExplorerEntry {
    name: string;
    path: string;
    kind: ExplorerEntryKind;
    size: number;
    modifiedAt: string;
}
export interface FileExplorerDirectory {
    path: string;
    entries: FileExplorerEntry[];
}
export interface FileExplorerFile {
    path: string;
    kind: ExplorerFileKind;
    encoding: ExplorerEncoding;
    content?: string;
    mimeType?: string;
    size: number;
    modifiedAt: string;
    revision: string;
}
export interface FileExplorerFileBytes {
    path: string;
    kind: ExplorerFileKind;
    encoding: "utf-8" | "binary";
    bytes: Uint8Array;
    mimeType: string;
    size: number;
    modifiedAt: string;
    revision: string;
}
export interface FileExplorerFileStream {
    path: string;
    kind: ExplorerFileKind;
    encoding: "utf-8" | "binary";
    mimeType: string;
    size: number;
    modifiedAt: string;
    revision: string;
    chunks: AsyncIterable<Uint8Array>;
}
export declare const FILE_EXPLORER_STREAM_CHUNK_BYTES: number;
export declare const MAX_EDITABLE_FILE_BYTES: number;
export declare function listDirectoryEntries({ root, relativePath, }: ListDirectoryParams): Promise<FileExplorerDirectory>;
export declare function readExplorerFile({ root, relativePath, }: ReadFileParams): Promise<FileExplorerFile>;
export declare function readExplorerFileBytes({ root, relativePath, }: ReadFileParams): Promise<FileExplorerFileBytes>;
export declare function streamExplorerFile({ root, relativePath }: ReadFileParams, consume: (file: FileExplorerFileStream) => Promise<void>): Promise<void>;
export declare function getExplorerFileVersion({ root, relativePath, }: ReadFileParams): Promise<ExplorerFileVersion>;
export declare function resolveExplorerFilePath({ root, relativePath, }: ReadFileParams): Promise<string>;
export declare function writeExplorerFile({ root, relativePath, content, expectedModifiedAt, expectedRevision, }: WriteFileParams): Promise<ExplorerFileWriteResult>;
export declare function getDownloadableFileInfo({ root, relativePath }: ReadFileParams): Promise<{
    path: string;
    absolutePath: string;
    fileName: string;
    mimeType: string;
    size: number;
}>;
export interface ExplorerCreateEntryParams {
    root: string;
    parentPath: string;
    name: string;
    kind: ExplorerEntryKind;
}
export interface ExplorerRenameEntryParams {
    root: string;
    relativePath: string;
    name: string;
}
export type ExplorerEntryMutationResult = {
    status: "ok";
    path: string;
} | {
    status: "error";
    error: string;
};
export declare function createExplorerEntry({ root, parentPath, name, kind, }: ExplorerCreateEntryParams): Promise<ExplorerEntryMutationResult>;
export declare function duplicateExplorerEntry({ root, relativePath, }: ReadFileParams): Promise<ExplorerEntryMutationResult>;
export declare function renameExplorerEntry({ root, relativePath, name, }: ExplorerRenameEntryParams): Promise<ExplorerEntryMutationResult>;
export declare function deleteExplorerEntry({ root, relativePath, }: ReadFileParams): Promise<ExplorerEntryMutationResult>;
//# sourceMappingURL=service.d.ts.map