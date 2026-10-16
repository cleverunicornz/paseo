import type { ToolPolicy } from "@getpaseo/protocol/agent-types";
import { z } from "zod";
export declare const CodexProviderOptionsSchema: z.ZodObject<{
    approval_policy: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        never: "never";
        untrusted: "untrusted";
        "on-request": "on-request";
    }>, z.ZodObject<{
        granular: z.ZodObject<{
            sandbox_approval: z.ZodOptional<z.ZodBoolean>;
            rules: z.ZodOptional<z.ZodBoolean>;
            mcp_elicitations: z.ZodOptional<z.ZodBoolean>;
            request_permissions: z.ZodOptional<z.ZodBoolean>;
            skill_approval: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
    sandbox_mode: z.ZodOptional<z.ZodEnum<{
        "read-only": "read-only";
        "workspace-write": "workspace-write";
        "danger-full-access": "danger-full-access";
    }>>;
    sandbox_workspace_write: z.ZodOptional<z.ZodObject<{
        writable_roots: z.ZodOptional<z.ZodArray<z.ZodString>>;
        network_access: z.ZodOptional<z.ZodBoolean>;
        exclude_slash_tmp: z.ZodOptional<z.ZodBoolean>;
        exclude_tmpdir_env_var: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
    web_search: z.ZodOptional<z.ZodEnum<{
        live: "live";
        disabled: "disabled";
        cached: "cached";
        indexed: "indexed";
    }>>;
    features: z.ZodOptional<z.ZodObject<{
        network_proxy: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            proxy_url: z.ZodOptional<z.ZodString>;
            socks_url: z.ZodOptional<z.ZodString>;
            enable_socks5: z.ZodOptional<z.ZodBoolean>;
            enable_socks5_udp: z.ZodOptional<z.ZodBoolean>;
            allow_local_binding: z.ZodOptional<z.ZodBoolean>;
            allow_upstream_proxy: z.ZodOptional<z.ZodBoolean>;
            dangerously_allow_all_unix_sockets: z.ZodOptional<z.ZodBoolean>;
            dangerously_allow_non_loopback_proxy: z.ZodOptional<z.ZodBoolean>;
            domains: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                deny: "deny";
            }>>>;
            unix_sockets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodEnum<{
                allow: "allow";
                deny: "deny";
            }>>>;
        }, z.core.$strict>]>>;
        multi_agent_v2: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type CodexProviderOptions = z.infer<typeof CodexProviderOptionsSchema>;
export declare function applyCodexToolPolicy(config: Record<string, unknown>, toolPolicy: ToolPolicy | undefined): Record<string, unknown>;
//# sourceMappingURL=options.d.ts.map