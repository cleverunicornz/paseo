import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
interface SearchLocation {
    seq: number;
    role: "user" | "assistant";
    count: number;
}
interface SearchInput {
    rows: readonly AgentTimelineRow[];
    query: string;
    cursor?: number;
}
export declare function searchTimeline({ rows, query, cursor }: SearchInput): Promise<{
    locations: SearchLocation[];
    nextCursor: null;
} | {
    locations: SearchLocation[];
    nextCursor: number;
}>;
export {};
//# sourceMappingURL=index.d.ts.map