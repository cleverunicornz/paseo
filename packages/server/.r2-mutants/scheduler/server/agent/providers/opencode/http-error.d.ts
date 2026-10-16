export declare class OpenCodeHttpError extends Error {
    readonly operation: string;
    readonly status: number | undefined;
    readonly html: boolean;
    readonly name = "OpenCodeHttpError";
    constructor(operation: string, status: number | undefined, html: boolean);
}
//# sourceMappingURL=http-error.d.ts.map