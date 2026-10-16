/**
 * Content-Disposition for a file download (RFC 6266).
 *
 * Any name that is not plain ASCII also gets `filename*=UTF-8''…`, because
 * browsers do not read raw Latin-1 bytes in `filename` and fall back to a name
 * taken from the URL. A name with a percent escape gets it too, so browsers do
 * not decode the escape in `filename`.
 */
export declare function formatAttachmentContentDisposition(fileName: string): string;
//# sourceMappingURL=content-disposition.d.ts.map