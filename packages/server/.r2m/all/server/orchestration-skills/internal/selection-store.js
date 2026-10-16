const DEFAULT_SKILL_SELECTION = { mode: "all" };
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function coerceSkillNames(value) {
    if (!Array.isArray(value))
        return [];
    const names = value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return [...new Set(names)].sort();
}
export function coerceSkillSelection(value) {
    if (!isRecord(value))
        return DEFAULT_SKILL_SELECTION;
    if (value.mode === "all")
        return { mode: "all" };
    if (value.mode === "custom") {
        return { mode: "custom", skills: coerceSkillNames(value.skills) };
    }
    return DEFAULT_SKILL_SELECTION;
}
export function createSkillSelectionStore(configStore) {
    return {
        async get() {
            return coerceSkillSelection(configStore.get().skills?.selection);
        },
        async set(selection) {
            const parsed = coerceSkillSelection(selection);
            configStore.setAgentSkillSelection(parsed);
            return parsed;
        },
        async isSet() {
            return configStore.get().skills?.selection !== undefined;
        },
    };
}
//# sourceMappingURL=selection-store.js.map