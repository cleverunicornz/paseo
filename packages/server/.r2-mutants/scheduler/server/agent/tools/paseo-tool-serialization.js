// These SDK internals are reachable through @modelcontextprotocol/sdk's wildcard export,
// not a curated public subpath. Keep that package pinned exactly and re-verify these
// paths on every SDK bump so native host-tool schemas stay byte-compatible.
import { normalizeObjectSchema, } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
const EMPTY_OBJECT_JSON_SCHEMA = {
    type: "object",
    properties: {},
};
function formatStructuredContentForModel(structuredContent) {
    if (!structuredContent ||
        typeof structuredContent !== "object" ||
        Array.isArray(structuredContent)) {
        return JSON.stringify(structuredContent, null, 2);
    }
    const record = structuredContent;
    const summary = [];
    for (const [key, value] of Object.entries(record)) {
        if (!Array.isArray(value)) {
            continue;
        }
        summary.push(`${key}_count=${value.length}`);
        const ids = value
            .map((item) => item && typeof item === "object" && !Array.isArray(item)
            ? item.id
            : null)
            .filter((id) => typeof id === "string" && id.length > 0);
        if (ids.length === value.length && ids.length > 0) {
            summary.push(`${key}_ids=${ids.join(",")}`);
        }
    }
    const json = JSON.stringify(structuredContent, null, 2);
    return summary.length > 0 ? `${summary.join("\n")}\n\n${json}` : json;
}
export function addModelVisibleStructuredContent(result) {
    if (result.structuredContent === undefined || result.content.length > 0) {
        return result;
    }
    return {
        ...result,
        content: [
            {
                type: "text",
                text: formatStructuredContentForModel(result.structuredContent),
            },
        ],
    };
}
export function serializePaseoToolInputParameters(tool) {
    const schema = normalizeObjectSchema(tool.inputSchema);
    return schema
        ? toJsonSchemaCompat(schema, {
            strictUnions: true,
            pipeStrategy: "input",
        })
        : { ...EMPTY_OBJECT_JSON_SCHEMA };
}
//# sourceMappingURL=paseo-tool-serialization.js.map