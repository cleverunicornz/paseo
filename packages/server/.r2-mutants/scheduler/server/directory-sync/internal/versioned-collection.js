/** Owns latest-state sequencing for one directory entity type. */
export class VersionedCollection {
    constructor(options) {
        this.valuesById = new Map();
        this.tombstonesById = new Map();
        this.expiredThroughSeq = 0;
        this.nextSeq = 0;
        this.getId = options.getId;
        this.fingerprint = options.fingerprint ?? ((value) => JSON.stringify(value));
        this.maxTombstones = options.maxTombstones ?? 5000;
    }
    get headSeq() {
        return this.nextSeq;
    }
    sequenceFor(id) {
        return this.valuesById.get(id)?.seq ?? this.tombstonesById.get(id) ?? null;
    }
    replace(value) {
        const id = this.getId(value);
        const fingerprint = this.fingerprint(value);
        const previous = this.valuesById.get(id);
        if (previous?.fingerprint === fingerprint)
            return null;
        const seq = this.advance();
        this.valuesById.set(id, { seq, fingerprint, value });
        this.tombstonesById.delete(id);
        return { kind: "upsert", seq, value };
    }
    remove(id) {
        if (!this.valuesById.has(id) && this.tombstonesById.has(id))
            return null;
        if (!this.valuesById.delete(id) && !this.tombstonesById.has(id))
            return null;
        const seq = this.advance();
        this.tombstonesById.delete(id);
        this.tombstonesById.set(id, seq);
        this.trimTombstones();
        return { kind: "remove", seq, id };
    }
    replaceAll(values) {
        const retainedIds = new Set();
        for (const value of values) {
            const id = this.getId(value);
            retainedIds.add(id);
            this.replace(value);
        }
        for (const id of this.valuesById.keys()) {
            if (!retainedIds.has(id))
                this.remove(id);
        }
    }
    readSnapshot(reason = "no_cursor") {
        return {
            mode: "snapshot",
            reason,
            headSeq: this.headSeq,
            values: this.sortedValues(),
            removals: [],
        };
    }
    readAfter(afterSeq) {
        if (afterSeq < this.expiredThroughSeq || afterSeq > this.headSeq) {
            return this.readSnapshot("cursor_expired");
        }
        return {
            mode: "changes",
            headSeq: this.headSeq,
            values: this.sortedValues().filter((entry) => entry.seq > afterSeq),
            removals: Array.from(this.tombstonesById, ([id, seq]) => ({ id, seq }))
                .filter((entry) => entry.seq > afterSeq)
                .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id)),
        };
    }
    advance() {
        this.nextSeq += 1;
        return this.nextSeq;
    }
    sortedValues() {
        return Array.from(this.valuesById.values())
            .map(({ seq, value }) => ({ seq, value }))
            .sort((left, right) => left.seq - right.seq || this.getId(left.value).localeCompare(this.getId(right.value)));
    }
    trimTombstones() {
        while (this.tombstonesById.size > this.maxTombstones) {
            const oldest = this.tombstonesById.entries().next().value;
            if (!oldest)
                return;
            const [id, seq] = oldest;
            this.tombstonesById.delete(id);
            this.expiredThroughSeq = Math.max(this.expiredThroughSeq, seq);
        }
    }
}
//# sourceMappingURL=versioned-collection.js.map