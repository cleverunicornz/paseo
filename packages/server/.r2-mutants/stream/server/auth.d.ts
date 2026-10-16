import type { RequestHandler } from "express";
export declare const DAEMON_PASSWORD_BCRYPT_COST = 12;
export interface DaemonAuthConfig {
    password?: string;
    localCredential?: () => string | null;
}
export interface BearerAuthRejectContext {
    path: string;
    method: string;
    hasToken: boolean;
}
interface BearerValidationInput {
    password: string | undefined;
    token: string | null;
}
export declare function isBearerTokenValidAsync(input: BearerValidationInput): Promise<boolean>;
export declare function hashDaemonPassword(password: string): string;
export declare function extractHttpBearerToken(value: string | undefined): string | null;
export declare function extractWsBearerProtocol(value: string | undefined): string | null;
export declare function extractWsBearerToken(protocol: string | null): string | null;
export declare function createRequireBearerMiddleware(auth: DaemonAuthConfig | undefined, onReject?: (context: BearerAuthRejectContext) => void): RequestHandler;
export declare function shouldBypassBearerAuth(method: string, path: string): boolean;
/**
 * Authorizes a request to the Agent MCP endpoint (/mcp/agents), which is exempt
 * from the global daemon-password middleware. Accepts either the per-daemon-run
 * capability token the daemon injects into its own agents' configs and MCP
 * client, or a valid daemon-password bearer (so existing password-authenticated
 * callers keep working). When no daemon password is configured the endpoint is
 * open, matching the global middleware's behavior.
 */
export declare function isAgentMcpRequestAuthorized(input: {
    password: string | undefined;
    capabilityToken: string | null;
    authorizationHeader: string | undefined;
}): Promise<boolean>;
export {};
//# sourceMappingURL=auth.d.ts.map