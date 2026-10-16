import { getAgentStreamEventTurnId, } from "../agent-sdk-types.js";
export async function runProviderTurn({ prompt, runOptions, startTurn, subscribe, getSessionId, reduceFinalText = replaceFinalTextWithAssistantMessage, }) {
    const timeline = [];
    let finalText = "";
    let usage;
    let turnId = null;
    const bufferedEvents = [];
    let settled = false;
    let resolveCompletion;
    let rejectCompletion;
    const processEvent = (event) => {
        if (settled) {
            return;
        }
        const eventTurnId = getAgentStreamEventTurnId(event);
        if (turnId && eventTurnId && eventTurnId !== turnId) {
            return;
        }
        if (event.type === "timeline") {
            timeline.push(event.item);
            finalText = reduceFinalText({ current: finalText, item: event.item });
            return;
        }
        if (event.type === "turn_completed") {
            usage = event.usage;
            settled = true;
            resolveCompletion();
            return;
        }
        if (event.type === "turn_failed") {
            settled = true;
            rejectCompletion(new Error(event.error));
            return;
        }
        if (event.type === "turn_canceled") {
            settled = true;
            resolveCompletion();
        }
    };
    const completion = new Promise((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
    });
    const unsubscribe = subscribe((event) => {
        if (!turnId) {
            bufferedEvents.push(event);
            return;
        }
        processEvent(event);
    });
    try {
        const result = await startTurn(prompt, runOptions);
        turnId = result.turnId;
        for (const event of bufferedEvents) {
            processEvent(event);
        }
        await completion;
    }
    finally {
        unsubscribe();
    }
    return {
        sessionId: await getSessionId(),
        finalText,
        usage,
        timeline,
    };
}
export function replaceFinalTextWithAssistantMessage({ current, item, }) {
    return item.type === "assistant_message" ? item.text : current;
}
export function appendOrReplaceGrowingAssistantMessage({ current, item, }) {
    if (item.type !== "assistant_message") {
        return current;
    }
    if (!current) {
        return item.text;
    }
    return item.text.startsWith(current) ? item.text : `${current}${item.text}`;
}
//# sourceMappingURL=provider-runner.js.map