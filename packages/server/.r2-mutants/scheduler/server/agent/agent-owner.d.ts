import { z } from "zod";
export declare const AgentOwnerSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"daemon">;
    daemonId: z.ZodString;
    executionId: z.ZodString;
}, z.core.$strip>], "kind">;
export type AgentOwner = z.infer<typeof AgentOwnerSchema>;
export type DaemonAgentOwner = Extract<AgentOwner, {
    kind: "daemon";
}>;
export declare function daemonExecutionKey(owner: DaemonAgentOwner): string;
//# sourceMappingURL=agent-owner.d.ts.map