export async function appendTimelineItemIfAgentKnown(options) {
    try {
        await options.agentManager.appendTimelineItem(options.agentId, options.item);
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Unknown agent")) {
            return false;
        }
        throw error;
    }
}
export async function emitLiveTimelineItemIfAgentKnown(options) {
    try {
        await options.agentManager.emitLiveTimelineItem(options.agentId, options.item);
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Unknown agent")) {
            return false;
        }
        throw error;
    }
}
//# sourceMappingURL=timeline-append.js.map