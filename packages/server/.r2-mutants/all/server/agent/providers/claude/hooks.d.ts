import type { ClaudeOptions } from "./query.js";
type ClaudeHooks = NonNullable<ClaudeOptions["hooks"]>;
/**
 * Combine Paseo's observation hooks with any the user configured, per event.
 *
 * Neither side wins: Claude Code runs every matcher registered for an event, so appending keeps
 * a user's hooks working while Paseo keeps observing. Assigning either one would silently drop
 * the other, and the failure would be invisible — effort would simply stop appearing.
 */
export declare function mergeClaudeHooks(own: ClaudeHooks, extra: unknown): ClaudeHooks;
export {};
//# sourceMappingURL=hooks.d.ts.map