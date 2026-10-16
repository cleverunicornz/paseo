import { z } from "zod";
export const CodexServiceTierSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
});
function buildCodexSpeedFeature(tiers, value) {
    if (tiers.length === 0)
        return [];
    return [
        {
            type: "select",
            id: "service_tier",
            label: "Speed",
            description: "Choose processing speed. Faster tiers increase usage.",
            tooltip: "Select speed",
            icon: "zap",
            desktopTrigger: "icon",
            value,
            options: [
                { id: "default", label: "Normal", isDefault: true },
                ...tiers.map((tier) => ({ id: tier.id, label: tier.name })),
            ],
        },
    ];
}
export const CODEX_PLAN_MODE_FEATURE = {
    type: "toggle",
    id: "plan_mode",
    label: "Plan",
    description: "Switch Codex into planning-only collaboration mode",
    tooltip: "Toggle plan mode",
    icon: "list-todo",
};
export function buildCodexFeatures(input) {
    const features = buildCodexSpeedFeature(input.serviceTiers, input.serviceTier);
    if (input.planModeAvailable !== false) {
        features.push({ ...CODEX_PLAN_MODE_FEATURE, value: input.planModeEnabled });
    }
    return features;
}
export function readCodexServiceTier(values) {
    const tier = values?.service_tier;
    if (typeof tier === "string")
        return tier;
    // COMPAT(codexFastPreference): added in v0.10.0, remove after 2027-03-29 once saved Fast preferences have migrated.
    return values?.fast_mode ? "fast" : null;
}
//# sourceMappingURL=codex-feature-definitions.js.map