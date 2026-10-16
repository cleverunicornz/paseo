import { randomUUID } from "node:crypto";
export class WorkspaceLabelSequence {
    constructor(journalLimit = 256) {
        this.journalLimit = journalLimit;
        this.generation = randomUUID();
        this.headSeq = 0;
        this.journal = [];
        this.subscribers = new Set();
    }
    subscribe(listener) {
        this.subscribers.add(listener);
        return () => this.subscribers.delete(listener);
    }
    publish(change) {
        const entry = { generation: this.generation, seq: ++this.headSeq, change };
        this.journal.push(entry);
        if (this.journal.length > this.journalLimit)
            this.journal.shift();
        for (const subscriber of this.subscribers) {
            try {
                subscriber(entry);
            }
            catch {
                // Publication follows durable persistence and cannot fail the mutation.
            }
        }
    }
    synchronize(catalog, cursor) {
        const oldestSeq = this.journal[0]?.seq ?? this.headSeq + 1;
        const canCatchUp = cursor?.generation === this.generation &&
            cursor.afterSeq <= this.headSeq &&
            cursor.afterSeq >= oldestSeq - 1;
        if (!canCatchUp) {
            return {
                labels: catalog.map((label) => ({ ...label })),
                sync: {
                    mode: "snapshot",
                    generation: this.generation,
                    headSeq: this.headSeq,
                    removals: [],
                },
            };
        }
        const changes = this.journal.filter((entry) => entry.seq > cursor.afterSeq);
        const upserts = new Map();
        const removals = new Map();
        for (const entry of changes) {
            if (entry.change.kind === "remove") {
                const key = entry.change.name.toLowerCase();
                const wasCreatedDuringCatchUp = upserts.delete(key);
                if (!wasCreatedDuringCatchUp) {
                    removals.set(key, { name: entry.change.name, seq: entry.seq });
                }
                continue;
            }
            if (entry.change.previousName) {
                const previousKey = entry.change.previousName.toLowerCase();
                const wasCreatedDuringCatchUp = upserts.delete(previousKey);
                if (!wasCreatedDuringCatchUp) {
                    removals.set(previousKey, {
                        name: entry.change.previousName,
                        seq: entry.seq,
                    });
                }
            }
            removals.delete(entry.change.label.name.toLowerCase());
            upserts.set(entry.change.label.name.toLowerCase(), entry.change.label);
        }
        return {
            labels: [...upserts.values()],
            sync: {
                mode: "changes",
                generation: this.generation,
                headSeq: this.headSeq,
                removals: [...removals.values()],
            },
        };
    }
}
//# sourceMappingURL=sequence.js.map