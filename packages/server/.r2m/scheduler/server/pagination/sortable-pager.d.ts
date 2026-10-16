import { CursorError, type CursorSortValue, type DecodedCursor } from "./cursor.js";
export interface SortSpec<K extends string> {
    key: K;
    direction: "asc" | "desc";
}
export interface SortablePagerConfig<TItem, K extends string> {
    validKeys: readonly K[];
    defaultSort: readonly SortSpec<K>[];
    label: string;
    getId: (item: TItem) => string;
    getSortValue: (item: TItem, key: K) => CursorSortValue;
}
export declare class SortablePager<TItem, K extends string> {
    private readonly config;
    constructor(config: SortablePagerConfig<TItem, K>);
    normalizeSort(sort: readonly SortSpec<K>[] | undefined): SortSpec<K>[];
    compare(left: TItem, right: TItem, sort: readonly SortSpec<K>[]): number;
    compareWithCursor(item: TItem, cursor: DecodedCursor<K>, sort: readonly SortSpec<K>[]): number;
    encode(item: TItem, sort: readonly SortSpec<K>[]): string;
    decode(token: string, sort: readonly SortSpec<K>[]): DecodedCursor<K>;
}
export { CursorError };
export declare function compareValues(left: CursorSortValue, right: CursorSortValue): number;
//# sourceMappingURL=sortable-pager.d.ts.map