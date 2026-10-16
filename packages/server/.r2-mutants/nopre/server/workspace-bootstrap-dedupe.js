export function shouldEmitPendingBootstrapUpdate(input) {
    const { snapshot, update } = input;
    if (!snapshot) {
        return true;
    }
    if (snapshot.status !== update.status) {
        return true;
    }
    const snapshotEnteredAt = snapshot.statusEnteredAt ?? null;
    const updateEnteredAt = update.statusEnteredAt ?? null;
    if (snapshotEnteredAt !== updateEnteredAt) {
        return true;
    }
    // Status pair is unchanged. The only remaining signal is activity.
    if (update.activityAtMs === null) {
        return false;
    }
    if (snapshot.activityAtMs === null) {
        return true;
    }
    return update.activityAtMs > snapshot.activityAtMs;
}
//# sourceMappingURL=workspace-bootstrap-dedupe.js.map