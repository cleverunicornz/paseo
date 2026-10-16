import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import { encodeFileTransferFrame, FileTransferOpcode, } from "@getpaseo/protocol/binary-frames/index";
import { FileUploadStore } from "../../file-upload/index.js";
import { createExplorerEntry, deleteExplorerEntry, duplicateExplorerEntry, getDownloadableFileInfo, listDirectoryEntries, readExplorerFile, renameExplorerEntry, streamExplorerFile, writeExplorerFile, } from "../../file-explorer/service.js";
import { workspaceFileObserver } from "../../file-explorer/observer.js";
import { getProjectIcon } from "../../../utils/project-icon.js";
/**
 * A client's workspace file-access surface: browsing directories, reading file
 * contents (inline JSON or binary frames), receiving uploads, issuing download
 * tokens, and reading project icons. It owns the upload store and reaches no
 * workspace-git, registry, or subscription state — file I/O scoped to a cwd is
 * the whole concern.
 */
export class WorkspaceFilesSession {
    constructor(options) {
        this.host = options.host;
        this.downloadTokenStore = options.downloadTokenStore;
        this.logger = options.logger;
        this.fileUploads = new FileUploadStore({ paseoHome: options.paseoHome });
        this.fileObserver = options.fileObserver ?? workspaceFileObserver;
    }
    async handleFileSubscribeRequest(request, ownership) {
        let bootstrap;
        const owner = ownership.begin("files", request.subscriptionId, async () => {
            await bootstrap?.then((subscription) => subscription.unsubscribe(), () => undefined);
        }, `file:${request.subscriptionId}`);
        let ready = false;
        let pending = null;
        const emitVersion = (version) => owner.emit({
            type: "fs.file.update",
            payload: { subscriptionId: owner.responseId, version },
        });
        try {
            bootstrap = this.fileObserver.subscribe({ cwd: request.cwd, path: request.path }, (version) => {
                if (owner.signal.aborted)
                    return;
                if (ready)
                    emitVersion(version);
                else
                    pending = version;
            });
            const subscription = await bootstrap;
            if (owner.signal.aborted) {
                subscription.unsubscribe();
                return;
            }
            this.host.emit({
                type: "fs.file.subscribe.response",
                payload: {
                    subscriptionId: owner.responseId,
                    initial: subscription.initial,
                    requestId: request.requestId,
                },
            });
            ready = true;
            if (pending)
                emitVersion(pending);
        }
        catch (error) {
            await owner.release();
            this.host.emit({
                type: "fs.file.subscribe.response",
                payload: {
                    subscriptionId: owner.responseId,
                    initial: {
                        status: "error",
                        cwd: request.cwd,
                        path: request.path,
                        error: getErrorMessage(error),
                    },
                    requestId: request.requestId,
                },
            });
        }
    }
    async handleFileUnsubscribeRequest(request, ownership) {
        await ownership.release(request.subscriptionId);
        this.host.emit({
            type: "fs.file.unsubscribe.response",
            payload: { subscriptionId: request.subscriptionId, requestId: request.requestId },
        });
    }
    async handleFileWriteRequest(request) {
        const result = await writeExplorerFile({
            root: request.cwd,
            relativePath: request.path,
            content: request.content,
            expectedModifiedAt: request.expectedModifiedAt,
            expectedRevision: request.expectedRevision,
        });
        this.host.emit({
            type: "fs.file.write.response",
            payload: { result, requestId: request.requestId },
        });
    }
    async handleFileEntryCreateRequest(request) {
        const result = await createExplorerEntry({
            root: request.cwd,
            parentPath: request.parentPath,
            name: request.name,
            kind: request.kind,
        });
        this.host.emit({
            type: "fs.entry.create.response",
            payload: {
                cwd: request.cwd,
                parentPath: request.parentPath,
                path: result.status === "ok" ? result.path : null,
                success: result.status === "ok",
                error: result.status === "ok" ? null : result.error,
                requestId: request.requestId,
            },
        });
    }
    async handleFileEntryRenameRequest(request) {
        const result = await renameExplorerEntry({
            root: request.cwd,
            relativePath: request.path,
            name: request.name,
        });
        this.host.emit({
            type: "fs.entry.rename.response",
            payload: {
                cwd: request.cwd,
                path: request.path,
                renamedPath: result.status === "ok" ? result.path : null,
                success: result.status === "ok",
                error: result.status === "ok" ? null : result.error,
                requestId: request.requestId,
            },
        });
    }
    async handleFileEntryDuplicateRequest(request) {
        const result = await duplicateExplorerEntry({
            root: request.cwd,
            relativePath: request.path,
        });
        this.host.emit({
            type: "fs.entry.duplicate.response",
            payload: {
                cwd: request.cwd,
                path: request.path,
                duplicatedPath: result.status === "ok" ? result.path : null,
                success: result.status === "ok",
                error: result.status === "ok" ? null : result.error,
                requestId: request.requestId,
            },
        });
    }
    async handleFileEntryDeleteRequest(request) {
        const result = await deleteExplorerEntry({
            root: request.cwd,
            relativePath: request.path,
        });
        this.host.emit({
            type: "fs.entry.delete.response",
            payload: {
                cwd: request.cwd,
                path: request.path,
                success: result.status === "ok",
                error: result.status === "ok" ? null : result.error,
                requestId: request.requestId,
            },
        });
    }
    async handleFileExplorerRequest(request, source) {
        const { cwd: workspaceCwd, path: requestedPath = ".", mode, requestId } = request;
        const cwd = workspaceCwd.trim();
        if (!cwd) {
            this.host.emit({
                type: "file_explorer_response",
                payload: {
                    cwd: workspaceCwd,
                    path: requestedPath,
                    mode,
                    directory: null,
                    file: null,
                    error: "cwd is required",
                    requestId,
                },
            }, source);
            return;
        }
        try {
            if (mode === "list") {
                const directory = await listDirectoryEntries({
                    root: cwd,
                    relativePath: requestedPath,
                });
                this.host.emit({
                    type: "file_explorer_response",
                    payload: {
                        cwd,
                        path: directory.path,
                        mode,
                        directory,
                        file: null,
                        error: null,
                        requestId,
                    },
                }, source);
            }
            else {
                if (request.maxBytes) {
                    const file = await getDownloadableFileInfo({ root: cwd, relativePath: requestedPath });
                    if (file.size > request.maxBytes) {
                        throw new Error("File is too large to display");
                    }
                }
                if (request.acceptBinary && this.host.hasBinaryChannel()) {
                    await streamExplorerFile({ root: cwd, relativePath: requestedPath }, async (file) => {
                        await this.host.emitBinary(encodeFileTransferFrame({
                            opcode: FileTransferOpcode.FileBegin,
                            requestId,
                            metadata: {
                                mime: file.mimeType,
                                size: file.size,
                                encoding: file.encoding,
                                modifiedAt: file.modifiedAt,
                                revision: file.revision,
                            },
                        }), source);
                        for await (const chunk of file.chunks) {
                            await this.host.emitBinary(encodeFileTransferFrame({
                                opcode: FileTransferOpcode.FileChunk,
                                requestId,
                                payload: chunk,
                            }), source);
                        }
                        await this.host.emitBinary(encodeFileTransferFrame({
                            opcode: FileTransferOpcode.FileEnd,
                            requestId,
                        }), source);
                    });
                }
                else {
                    const file = await readExplorerFile({
                        root: cwd,
                        relativePath: requestedPath,
                    });
                    this.host.emit({
                        type: "file_explorer_response",
                        payload: {
                            cwd,
                            path: file.path,
                            mode,
                            directory: null,
                            file,
                            error: null,
                            requestId,
                        },
                    }, source);
                }
            }
        }
        catch (error) {
            this.logger.error({ err: error, cwd, path: requestedPath }, `Failed to fulfill file explorer request for workspace ${cwd}`);
            this.host.emit({
                type: "file_explorer_response",
                payload: {
                    cwd,
                    path: requestedPath,
                    mode,
                    directory: null,
                    file: null,
                    error: getErrorMessage(error),
                    requestId,
                },
            }, source);
        }
    }
    handleFileUploadRequest(request, ownership) {
        let cancel;
        const operation = ownership.operation((message) => message.type === "file.upload.response" && message.payload.requestId === request.requestId, () => cancel?.());
        cancel = this.fileUploads.beginUpload(request, operation.source, (response) => {
            if (response)
                operation.emit(response);
            void operation
                .release()
                .catch((error) => this.logger.error({ err: error }, "Upload cleanup failed"));
        });
    }
    async handleFileTransferFrame(frame, source) {
        await this.fileUploads.receiveFrame(frame, source);
    }
    async handleProjectIconRequest(request) {
        const { cwd, requestId } = request;
        try {
            const icon = await getProjectIcon(cwd);
            this.host.emit({
                type: "project_icon_response",
                payload: {
                    cwd,
                    icon,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.host.emit({
                type: "project_icon_response",
                payload: {
                    cwd,
                    icon: null,
                    error: getErrorMessage(error),
                    requestId,
                },
            });
        }
    }
    async handleFileDownloadTokenRequest(request) {
        const { cwd: workspaceCwd, path: requestedPath, requestId } = request;
        const cwd = workspaceCwd.trim();
        if (!cwd) {
            this.host.emit({
                type: "file_download_token_response",
                payload: {
                    cwd: workspaceCwd,
                    path: requestedPath,
                    token: null,
                    fileName: null,
                    mimeType: null,
                    size: null,
                    error: "cwd is required",
                    requestId,
                },
            });
            return;
        }
        this.logger.debug({ cwd, path: requestedPath }, `Handling file download token request for workspace ${cwd} (${requestedPath})`);
        try {
            const info = await getDownloadableFileInfo({
                root: cwd,
                relativePath: requestedPath,
            });
            const entry = this.downloadTokenStore.issueToken({
                path: info.path,
                absolutePath: info.absolutePath,
                fileName: info.fileName,
                mimeType: info.mimeType,
                size: info.size,
            });
            this.host.emit({
                type: "file_download_token_response",
                payload: {
                    cwd,
                    path: info.path,
                    token: entry.token,
                    fileName: entry.fileName,
                    mimeType: entry.mimeType,
                    size: entry.size,
                    error: null,
                    requestId,
                },
            });
        }
        catch (error) {
            this.logger.error({ err: error, cwd, path: requestedPath }, `Failed to issue download token for workspace ${cwd}`);
            this.host.emit({
                type: "file_download_token_response",
                payload: {
                    cwd,
                    path: requestedPath,
                    token: null,
                    fileName: null,
                    mimeType: null,
                    size: null,
                    error: getErrorMessage(error),
                    requestId,
                },
            });
        }
    }
}
//# sourceMappingURL=workspace-files-session.js.map