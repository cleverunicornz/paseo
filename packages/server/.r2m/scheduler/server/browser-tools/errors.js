export class BrowserToolsRequestError extends Error {
    constructor(error) {
        super(error.message);
        this.name = "BrowserToolsRequestError";
        this.code = error.code;
        this.retryable = error.retryable;
    }
}
export function browserToolsFailure(params) {
    return {
        requestId: params.requestId,
        ok: false,
        error: {
            code: params.code,
            message: params.message,
            retryable: params.retryable ?? false,
        },
    };
}
export function createBrowserToolsRequestError(params) {
    return new BrowserToolsRequestError({
        code: params.code,
        message: params.message,
        retryable: params.retryable ?? false,
    });
}
//# sourceMappingURL=errors.js.map