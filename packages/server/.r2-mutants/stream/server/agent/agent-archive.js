export function buildArchivedAgentRecord(record, options) {
    const archivedAt = options?.archivedAt ?? new Date().toISOString();
    return {
        ...record,
        archivedAt,
        updatedAt: options?.updatedAt ?? record.updatedAt,
        lastStatus: normalizeArchivedStatus(record.lastStatus),
        requiresAttention: false,
        attentionReason: null,
        attentionTimestamp: null,
    };
}
function normalizeArchivedStatus(status) {
    return status === "running" || status === "initializing" ? "idle" : status;
}
//# sourceMappingURL=agent-archive.js.map