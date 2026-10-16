export async function importSessionFromPersistence(input) {
    const config = {
        ...input.context.config,
        ...input.config,
        provider: input.provider,
        cwd: input.request.cwd,
    };
    const storedConfig = {
        ...input.context.storedConfig,
        ...input.config,
        provider: input.provider,
        cwd: input.request.cwd,
    };
    const persistence = input.persistence ?? buildImportPersistenceHandle(input.provider, input.request, storedConfig);
    const session = await input.resumeSession(persistence, config, input.context.launchContext);
    const history = await collectImportedHistory(session.streamHistory());
    return {
        session,
        config: storedConfig,
        persistence,
        timeline: history.timeline,
        providerSubagentEvents: history.providerSubagentEvents,
    };
}
function buildImportPersistenceHandle(provider, input, config) {
    return {
        provider,
        sessionId: input.providerHandleId,
        nativeHandle: input.providerHandleId,
        metadata: {
            ...config,
            provider,
            cwd: input.cwd,
        },
    };
}
async function collectImportedHistory(events) {
    const timeline = [];
    const providerSubagentEvents = [];
    for await (const event of events) {
        if (event.type === "provider_subagent") {
            providerSubagentEvents.push(event);
            continue;
        }
        if (event.type !== "timeline") {
            continue;
        }
        timeline.push({
            item: event.item,
            ...(event.timestamp ? { timestamp: event.timestamp } : {}),
        });
    }
    return { timeline, providerSubagentEvents };
}
//# sourceMappingURL=provider-session-import.js.map