import type { RequestHandler } from "express";
import type { Logger } from "pino";
export interface WebUiMiddlewareOptions {
    enabled: boolean;
    distDir: string | null;
    label: string;
    logger: Logger;
}
export declare function createWebUiMiddleware(options: WebUiMiddlewareOptions): RequestHandler;
//# sourceMappingURL=web-ui.d.ts.map