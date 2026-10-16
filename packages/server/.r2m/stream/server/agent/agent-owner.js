import { z } from "zod";
export const AgentOwnerSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("daemon"),
        daemonId: z.string(),
        executionId: z.string(),
    }),
]);
export function daemonExecutionKey(owner) {
    return `${owner.daemonId}\0${owner.executionId}`;
}
//# sourceMappingURL=agent-owner.js.map