export type SshHostnameResolver = (host: string) => Promise<string | null>;
/**
 * Resolve an SSH host alias (e.g. `github-work` from ~/.ssh/config) to its
 * configured HostName via `ssh -G`. Results are cached for the daemon's
 * lifetime; a host that isn't an alias resolves to itself.
 */
export declare function resolveSshHostname(host: string): Promise<string | null>;
//# sourceMappingURL=ssh-hostname.d.ts.map