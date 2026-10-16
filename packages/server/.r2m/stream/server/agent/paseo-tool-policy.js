export function resolvePaseoToolPolicy(providerId, providerSettings) {
    return providerSettings?.[providerId]?.paseoTools;
}
export function isPaseoToolEnabled(policy, toolName) {
    if (toolName === "speak") {
        return true;
    }
    if (!isPaseoToolPolicyEnabled(policy)) {
        return false;
    }
    return !policy?.disabledTools?.includes(toolName);
}
export function isPaseoToolPolicyEnabled(policy) {
    return policy?.enabled !== false;
}
//# sourceMappingURL=paseo-tool-policy.js.map