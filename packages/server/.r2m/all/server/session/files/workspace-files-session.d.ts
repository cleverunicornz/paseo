import type pino from "pino";
import type { SessionDelivery } from "../owned-subscriptions/index.js";
import { type FileTransferFrame } from "@getpaseo/protocol/binary-frames/index";
import type { FileDownloadTokenRequest, FileEntryCreateRequest, FileEntryDeleteRequest, FileEntryDuplicateRequest, FileEntryRenameRequest, FileExplorerRequest, FileUploadRequest, FileSubscribeRequest, FileUnsubscribeRequest, FileWriteRequest, SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { DownloadTokenStore } from "../../file-download/token-store.js";
import { type FileObserver } from "../../file-explorer/observer.js";
/**
 * What a workspace file-access request reaches outside its own domain: the
 * outbound message channel (text + binary). `hasBinaryChannel` gates the
 * binary file-explorer transfer path the same way the terminal subsystem does
 * — old clients without a binary channel fall back to inline JSON file content.
 */
export interface WorkspaceFilesSessionHost {
    emit(msg: SessionOutboundMessage, source?: object): void;
    emitBinary(frame: Uint8Array, source?: object): Promise<void>;
    hasBinaryChannel(): boolean;
}
export interface WorkspaceFilesSessionOptions {
    host: WorkspaceFilesSessionHost;
    downloadTokenStore: DownloadTokenStore;
    paseoHome: string;
    logger: pino.Logger;
    fileObserver?: FileObserver;
}
/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state — file I/O scoped to a cwd is
 * the whole concern.
 */
export declare class WorkspaceFilesSession {
    private readonly host;
    private readonly downloadTokenStore;
    private readonly logger;
    private readonly fileUploads;
    private readonly fileObserver;
    constructor(options: WorkspaceFilesSessionOptions);
    handleFileSubscribeRequest(request: FileSubscribeRequest, ownership: SessionDelivery): Promise<void>;
    handleFileUnsubscribeRequest(request: FileUnsubscribeRequest, ownership: SessionDelivery): Promise<void>;
    handleFileWriteRequest(request: FileWriteRequest): Promise<void>;
    handleFileEntryCreateRequest(request: FileEntryCreateRequest): Promise<void>;
    handleFileEntryRenameRequest(request: FileEntryRenameRequest): Promise<void>;
    handleFileEntryDuplicateRequest(request: FileEntryDuplicateRequest): Promise<void>;
    handleFileEntryDeleteRequest(request: FileEntryDeleteRequest): Promise<void>;
    handleFileExplorerRequest(request: FileExplorerRequest, source?: object): Promise<void>;
    handleFileUploadRequest(request: FileUploadRequest, ownership: SessionDelivery): void;
    handleFileTransferFrame(frame: FileTransferFrame, source: object): Promise<void>;
    handleProjectIconRequest(request: Extract<SessionInboundMessage, {
        type: "project_icon_request";
    }>): Promise<void>;
    handleFileDownloadTokenRequest(request: FileDownloadTokenRequest): Promise<void>;
}
//# sourceMappingURL=workspace-files-session.d.ts.map