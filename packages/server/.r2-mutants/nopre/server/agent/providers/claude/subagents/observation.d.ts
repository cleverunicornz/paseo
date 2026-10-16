import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import type { ProviderSubagentInputEvent, ProviderSubagentStatus } from "../../../provider-subagents/store.js";
/**
 * A single fact a provider observed about one subagent.
 *
 * Sources translate their wire format into observations. Claude-specific presentation is reduced
 * to a subtitle before it crosses this boundary, while lifecycle and timeline facts stay
 * structural. Live and on-disk replay therefore speak one vocabulary.
 *
 * The union stays small on purpose: a kind earns its place when a descriptor field exists to
 * receive it and a source exists to report it.
 */
export type SubagentObservation = {
    /** The subagent exists, and here is what it was asked to do. */
    kind: "declared";
    id: string;
    /** Subagent type, e.g. "Explore". Identical across a fan-out — not the task. */
    title?: string;
    /** The task this child was given. What actually distinguishes it from its siblings. */
    description?: string;
    toolCallId?: string;
    /** Provider subagent that launched this one. Absent means a direct child of the agent. */
    parentSubagentId?: string;
    timestamp?: string;
} | {
    kind: "status";
    id: string;
    status: ProviderSubagentStatus;
    timestamp?: string;
}
/** Complete provider-owned secondary label. Clients display this without parsing it. */
 | {
    kind: "subtitle";
    id: string;
    subtitle: string;
    timestamp?: string;
} | {
    kind: "timeline";
    id: string;
    item: AgentTimelineItem;
    timestamp?: string;
};
/**
 * Turn observations into store events.
 *
 * Pure and stateless by construction. Both the task protocol and a persisted transcript are
 * edge-triggered — a subagent is declared once and its status changes only when it changes — so
 * there is nothing to debounce here. Accumulation across partial upserts is the store's sticky
 * merge (omitted field preserves, explicit null clears), which is why a `status` observation can
 * carry status alone without blanking the title.
 */
export declare function foldSubagentObservations(observations: readonly SubagentObservation[]): ProviderSubagentInputEvent[];
//# sourceMappingURL=observation.d.ts.map