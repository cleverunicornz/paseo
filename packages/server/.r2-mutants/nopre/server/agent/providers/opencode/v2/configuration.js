import { OpenCodeProviderOptionsSchema, buildOpenCodePermissionRules } from "../options.js";
import { modelRef } from "./mapping.js";
export function features(config) {
    return [
        {
            type: "toggle",
            id: "auto_accept",
            label: "Auto-accept",
            value: config.featureValues?.["auto_accept"] === true,
        },
    ];
}
export function permissionRules(config) {
    const rules = buildOpenCodePermissionRules(OpenCodeProviderOptionsSchema.parse(config.providerOptions ?? {}), undefined) ?? [];
    const grants = (config.toolPolicy?.preapproved ?? []).map((grant) => ({
        action: `${grant.server.replace(/[^a-zA-Z0-9_-]/g, "_")}_${grant.tool.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        resource: "*",
        effect: "allow",
    }));
    return [
        ...grants,
        ...rules.map((rule) => ({
            action: nativePermissionAction(rule.permission),
            resource: rule.pattern,
            effect: rule.action,
        })),
    ];
}
function nativePermissionAction(action) {
    if (action === "bash")
        return "shell";
    if (action === "task")
        return "subagent";
    return action;
}
export async function applyResumeOverrides(client, info, overrides) {
    if (overrides?.modeId) {
        await client.session.switchAgent({
            sessionID: info.id,
            agent: overrides.modeId,
        });
        info.agent = overrides.modeId;
    }
    if (overrides?.model || overrides?.thinkingOptionId !== undefined) {
        const model = overrides.model
            ? modelRef(overrides.model, overrides.thinkingOptionId ?? info.model?.variant)
            : info.model && { ...info.model, variant: overrides.thinkingOptionId };
        if (!model)
            throw new Error("Select an OpenCode model before changing its variant");
        await client.session.switchModel({ sessionID: info.id, model });
        info.model = model;
    }
}
// Agent identity env is applied per session through `session.environment`, so
// it must not force a dedicated server. Custom MCP is location-scoped, and any
// other env key belongs to the process, so both need isolation. Mirrors the v1
// adapter's `requiresDedicatedOpenCodeServer`.
const V2_SESSION_ENV_KEYS = new Set(["PASEO_AGENT_ID", "PASEO_AGENT_CWD"]);
export function requiresDedicatedV2Server(config, launch) {
    if (Object.keys(config.mcpServers ?? {}).length > 0)
        return true;
    return Object.keys(launch?.env ?? {}).some((key) => !V2_SESSION_ENV_KEYS.has(key));
}
//# sourceMappingURL=configuration.js.map