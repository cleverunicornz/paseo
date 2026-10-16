export function composeSystemPromptParts(...parts) {
    const prompt = parts
        .map((part) => part?.trim())
        .filter((part) => typeof part === "string" && part.length > 0)
        .join("\n\n");
    return prompt.length > 0 ? prompt : undefined;
}
//# sourceMappingURL=system-prompt.js.map