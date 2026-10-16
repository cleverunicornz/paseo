import { z } from "zod";
export declare const ACPProviderOptionsSchema: z.ZodObject<{
    supportsMcpServers: z.ZodOptional<z.ZodBoolean>;
    clientCapabilities: z.ZodOptional<z.ZodObject<{
        fs: z.ZodOptional<z.ZodObject<{
            readTextFile: z.ZodOptional<z.ZodBoolean>;
            writeTextFile: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        terminal: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$loose>;
//# sourceMappingURL=acp-options.d.ts.map