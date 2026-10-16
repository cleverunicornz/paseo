export class CursorError extends Error {
    constructor(message) {
        super(message);
        this.name = "CursorError";
    }
}
export function encodeCursor(entry, sort, getId, getValue) {
    const values = {};
    for (const spec of sort) {
        values[spec.key] = getValue(entry, spec.key);
    }
    return Buffer.from(JSON.stringify({ sort, values, id: getId(entry) }), "utf8").toString("base64url");
}
export function decodeCursor(cursor, sort, validKeys, label) {
    const invalid = new CursorError(`Invalid ${label} cursor`);
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    }
    catch {
        throw invalid;
    }
    if (!parsed || typeof parsed !== "object") {
        throw invalid;
    }
    const payload = parsed;
    if (!Array.isArray(payload.sort) || typeof payload.id !== "string") {
        throw invalid;
    }
    if (!payload.values || typeof payload.values !== "object") {
        throw invalid;
    }
    const cursorSort = parseCursorSort(payload.sort, validKeys, label);
    if (cursorSort.length !== sort.length ||
        cursorSort.some((entry, index) => entry.key !== sort[index]?.key || entry.direction !== sort[index]?.direction)) {
        throw new CursorError(`${label} cursor does not match current sort`);
    }
    return {
        sort: cursorSort,
        values: payload.values,
        id: payload.id,
    };
}
function parseCursorSort(raw, validKeys, label) {
    const result = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") {
            throw new CursorError(`Invalid ${label} cursor`);
        }
        const { key, direction } = item;
        if (typeof key !== "string" || typeof direction !== "string") {
            throw new CursorError(`Invalid ${label} cursor`);
        }
        if (!validKeys.includes(key) ||
            (direction !== "asc" && direction !== "desc")) {
            throw new CursorError(`Invalid ${label} cursor`);
        }
        result.push({ key: key, direction });
    }
    return result;
}
//# sourceMappingURL=cursor.js.map