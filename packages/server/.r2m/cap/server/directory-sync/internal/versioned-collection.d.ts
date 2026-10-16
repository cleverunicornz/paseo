export interface VersionedValue<T> {
    seq: number;
    value: T;
}
export interface VersionedRemoval {
    id: string;
    seq: number;
}
export interface CollectionRead<T> {
    mode: "changes" | "snapshot";
    reason?: "no_cursor" | "generation_changed" | "cursor_expired";
    headSeq: number;
    values: VersionedValue<T>[];
    removals: VersionedRemoval[];
}
export type PublishedChange<T> = {
    kind: "upsert";
    seq: number;
    value: T;
} | {
    kind: "remove";
    seq: number;
    id: string;
};
interface VersionedCollectionOptions<T> {
    getId(value: T): string;
    fingerprint?(value: T): string;
    maxTombstones?: number;
}
/** Owns latest-state sequencing for one directory entity type. */
export declare class VersionedCollection<T> {
    private readonly valuesById;
    private readonly tombstonesById;
    private readonly getId;
    private readonly fingerprint;
    private readonly maxTombstones;
    private expiredThroughSeq;
    private nextSeq;
    constructor(options: VersionedCollectionOptions<T>);
    get headSeq(): number;
    sequenceFor(id: string): number | null;
    replace(value: T): Extract<PublishedChange<T>, {
        kind: "upsert";
    }> | null;
    remove(id: string): Extract<PublishedChange<T>, {
        kind: "remove";
    }> | null;
    replaceAll(values: Iterable<T>): void;
    readSnapshot(reason?: "no_cursor" | "generation_changed" | "cursor_expired"): CollectionRead<T>;
    readAfter(afterSeq: number): CollectionRead<T>;
    private advance;
    private sortedValues;
    private trimTombstones;
}
export {};
//# sourceMappingURL=versioned-collection.d.ts.map