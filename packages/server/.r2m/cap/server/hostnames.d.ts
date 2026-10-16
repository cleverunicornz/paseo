export type HostnamesConfig = true | string[] | undefined;
/**
 * Vite-style hostname allowlist check, adapted to raw Host headers.
 *
 * Semantics:
 * - `hostnames === true` => allow any host.
 * - `hostnames === []` or `undefined` => allow localhost, *.localhost, and all IPs.
 * - `hostnames === ['.example.com', 'myhost']` => allow those *in addition* to defaults.
 */
export declare function isHostnameAllowed(hostHeader: string | undefined, hostnames: HostnamesConfig): boolean;
export declare function mergeHostnames(values: Array<HostnamesConfig>): HostnamesConfig;
export declare function parseHostnamesEnv(raw: string | undefined): HostnamesConfig;
//# sourceMappingURL=hostnames.d.ts.map