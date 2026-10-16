export interface CursorSortEntry<K extends string> {
    key: K;
    direction: "asc" | "desc";
}
export type CursorSortValue = string | number | null;
export interface DecodedCursor<K extends string> {
    sort: CursorSortEntry<K>[];
    values: Record<string, CursorSortValue>;
    id: string;
}
export declare class CursorError extends Error {
    constructor(message: string);
}
export declare function encodeCursor<E, K extends string>(entry: E, sort: readonly CursorSortEntry<K>[], getId: (entry: E) => string, getValue: (entry: E, key: K) => CursorSortValue): string;
export declare function decodeCursor<K extends string>(cursor: string, sort: readonly CursorSortEntry<K>[], validKeys: readonly K[], label: string): DecodedCursor<K>;
//# sourceMappingURL=cursor.d.ts.map