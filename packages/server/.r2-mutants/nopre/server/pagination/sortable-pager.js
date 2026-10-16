import { CursorError, decodeCursor, encodeCursor, } from "./cursor.js";
export class SortablePager {
    constructor(config) {
        this.config = config;
    }
    normalizeSort(sort) {
        if (!sort || sort.length === 0) {
            return [...this.config.defaultSort];
        }
        const deduped = [];
        const seen = new Set();
        for (const entry of sort) {
            if (seen.has(entry.key)) {
                continue;
            }
            seen.add(entry.key);
            deduped.push(entry);
        }
        return deduped.length > 0 ? deduped : [...this.config.defaultSort];
    }
    compare(left, right, sort) {
        for (const spec of sort) {
            const leftValue = this.config.getSortValue(left, spec.key);
            const rightValue = this.config.getSortValue(right, spec.key);
            const base = compareValues(leftValue, rightValue);
            if (base === 0) {
                continue;
            }
            return spec.direction === "asc" ? base : -base;
        }
        return this.config.getId(left).localeCompare(this.config.getId(right));
    }
    compareWithCursor(item, cursor, sort) {
        for (const spec of sort) {
            const leftValue = this.config.getSortValue(item, spec.key);
            const rightValue = cursor.values[spec.key] ?? null;
            const base = compareValues(leftValue, rightValue);
            if (base === 0) {
                continue;
            }
            return spec.direction === "asc" ? base : -base;
        }
        return this.config.getId(item).localeCompare(cursor.id);
    }
    encode(item, sort) {
        return encodeCursor(item, sort, this.config.getId, this.config.getSortValue);
    }
    decode(token, sort) {
        return decodeCursor(token, sort, this.config.validKeys, this.config.label);
    }
}
export { CursorError };
export function compareValues(left, right) {
    if (left === right) {
        return 0;
    }
    if (left === null) {
        return -1;
    }
    if (right === null) {
        return 1;
    }
    if (typeof left === "number" && typeof right === "number") {
        return left < right ? -1 : 1;
    }
    return String(left).localeCompare(String(right));
}
//# sourceMappingURL=sortable-pager.js.map