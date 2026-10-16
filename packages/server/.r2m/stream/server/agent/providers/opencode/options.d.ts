import type { ToolPolicy } from "@getpaseo/protocol/agent-types";
import { z } from "zod";
export declare const OpenCodeProviderOptionsSchema: z.ZodObject<{
    permission: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        allow: "allow";
        deny: "deny";
        ask: "ask";
    }>, z.ZodObject<{
        read: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        edit: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        glob: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        grep: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        list: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        bash: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        task: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        external_directory: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        todowrite: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>;
        question: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>;
        webfetch: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>;
        websearch: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>;
        codesearch: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>;
        repo_clone: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        repo_overview: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        lsp: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
        doom_loop: z.ZodOptional<z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>;
        skill: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>, z.ZodRecord<z.ZodString, z.ZodEnum<{
            allow: "allow";
            deny: "deny";
            ask: "ask";
        }>>]>>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export type OpenCodeProviderOptions = z.infer<typeof OpenCodeProviderOptionsSchema>;
export interface OpenCodePermissionRule {
    permission: string;
    pattern: string;
    action: "ask" | "allow" | "deny";
}
export declare function buildOpenCodePermissionRules(options: OpenCodeProviderOptions | undefined, toolPolicy: ToolPolicy | undefined): OpenCodePermissionRule[] | undefined;
//# sourceMappingURL=options.d.ts.map