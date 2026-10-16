import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
export type WorkspaceLabelChange = {
    kind: "upsert";
    label: WorkspaceLabelDefinition;
    previousName?: string;
} | {
    kind: "remove";
    name: string;
};
interface SequencedChange {
    generation: string;
    seq: number;
    change: WorkspaceLabelChange;
}
export interface WorkspaceLabelCursor {
    generation: string;
    afterSeq: number;
}
export interface WorkspaceLabelSync {
    labels: WorkspaceLabelDefinition[];
    sync: {
        mode: "snapshot" | "changes";
        generation: string;
        headSeq: number;
        removals: Array<{
            name: string;
            seq: number;
        }>;
    };
}
export declare class WorkspaceLabelSequence {
    private readonly journalLimit;
    private readonly generation;
    private headSeq;
    private readonly journal;
    private readonly subscribers;
    constructor(journalLimit?: number);
    subscribe(listener: (change: SequencedChange) => void): () => void;
    publish(change: WorkspaceLabelChange): void;
    synchronize(catalog: readonly WorkspaceLabelDefinition[], cursor?: WorkspaceLabelCursor): WorkspaceLabelSync;
}
export {};
//# sourceMappingURL=sequence.d.ts.map