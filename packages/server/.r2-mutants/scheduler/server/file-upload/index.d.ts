import { type FileTransferFrame } from "@getpaseo/protocol/binary-frames/index";
import type { FileUploadRequest, FileUploadResponse } from "../messages.js";
interface FileUploadStoreOptions {
    paseoHome: string;
    staleUploadTimeoutMs?: number;
}
export declare class FileUploadStore {
    private static readonly defaultStaleUploadTimeoutMs;
    private readonly paseoHome;
    private readonly staleUploadTimeoutMs;
    private readonly defaultSource;
    private readonly pending;
    constructor(options: FileUploadStoreOptions);
    beginUpload(request: FileUploadRequest, source?: object, finished?: (response: FileUploadResponse | null) => void): () => Promise<void>;
    receiveFrame(frame: FileTransferFrame, source?: object): Promise<FileUploadResponse | null>;
    private applyFrame;
    private startWriting;
    private writeChunk;
    private completeUpload;
    private createStaleUploadTimeout;
    private refreshStaleUploadTimeout;
    private cancel;
    private clearPendingUpload;
    private removeFailedUpload;
    private removeUploadDirectory;
}
export {};
//# sourceMappingURL=index.d.ts.map