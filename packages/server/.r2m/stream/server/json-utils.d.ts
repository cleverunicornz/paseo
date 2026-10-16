export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
/**
 * Coerce arbitrary values into JSON-safe structures.
 * Unlike the previous implementation, this never throws on undefined—
 * it replaces unsupported values (undefined, functions, symbols) with null
 * so responses always make it back to the client.
 */
export declare function ensureValidJson<T>(value: T): T;
//# sourceMappingURL=json-utils.d.ts.map