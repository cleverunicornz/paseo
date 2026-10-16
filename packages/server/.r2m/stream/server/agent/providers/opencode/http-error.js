export class OpenCodeHttpError extends Error {
    constructor(operation, status, html) {
        const statusLabel = status === undefined ? "" : ` (HTTP ${status})`;
        super(html
            ? `OpenCode ${operation} returned HTML instead of JSON; incompatible OpenCode API${statusLabel}`
            : `OpenCode ${operation} failed${statusLabel}`);
        this.operation = operation;
        this.status = status;
        this.html = html;
        this.name = "OpenCodeHttpError";
    }
}
//# sourceMappingURL=http-error.js.map