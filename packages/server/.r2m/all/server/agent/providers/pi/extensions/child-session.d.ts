import type { ProviderSubagentInputEvent } from "../../../provider-subagents/store.js";
import { type PiToolResult } from "../tool-call-mapper.js";
export declare function outputFileFromToolResult(result: PiToolResult): string | undefined;
/** Reads a finished child transcript once, up to `maxBytes`. */
export declare function mapPiChildSession(id: string, file: string, maxBytes?: number): Promise<ProviderSubagentInputEvent[]>;
/** Incrementally reads one append-only child transcript. A partial JSONL row is held until newline. */
export declare class PiChildSessionFollower {
    private readonly id;
    private readonly file;
    private offset;
    private pending;
    private readonly mapper;
    private items;
    private readonly maxBytes;
    constructor(id: string, file: string, maxBytes?: number);
    readNew(): Promise<ProviderSubagentInputEvent[]>;
}
//# sourceMappingURL=child-session.d.ts.map