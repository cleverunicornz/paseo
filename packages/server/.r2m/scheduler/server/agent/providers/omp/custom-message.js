export function shouldDisplayOmpCustomMessage(message) {
    return Reflect.get(message, "display") !== false;
}
// injected rows need their own message id so the stream coalescer never glues them
// onto the assistant reply they arrive next to
export function ompCustomMessageId(message, nextIndex) {
    const id = Reflect.get(message, "id");
    return `omp-custom-${typeof id === "string" && id ? id : nextIndex()}`;
}
// omp does not persist the typed /skill:<name> as a user message, only the expansion
// it injected on the user's behalf; rebuild the bubble from the expansion's details
export function ompSkillPromptUserText(message) {
    if (Reflect.get(message, "customType") !== "skill-prompt" ||
        Reflect.get(message, "attribution") !== "user") {
        return null;
    }
    const details = Reflect.get(message, "details");
    const name = details && typeof details === "object" ? Reflect.get(details, "name") : undefined;
    if (typeof name !== "string" || !name) {
        return null;
    }
    const args = Reflect.get(details, "args");
    return typeof args === "string" && args.trim()
        ? `/skill:${name} ${args.trim()}`
        : `/skill:${name}`;
}
//# sourceMappingURL=custom-message.js.map