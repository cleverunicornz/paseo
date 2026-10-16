import { z } from "zod";
import { isSpeakToolName } from "@getpaseo/protocol/tool-name-normalization";
import { deriveClaudeToolDetail } from "./tool-call-detail-parser.js";
const ClaudePlanInputSchema = z.object({ plan: z.string() });
const ClaudeToolCallStatusSchema = z.enum(["running", "completed", "failed", "canceled"]);
const ClaudeRawToolCallSchema = z
    .object({
    callId: z.string().optional().nullable(),
    name: z.string().min(1),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    error: z.unknown().nullable().optional(),
    status: ClaudeToolCallStatusSchema,
})
    .passthrough();
const SHELL_NAMES = new Set(["Bash", "bash", "shell", "exec_command"]);
const READ_NAMES = new Set(["Read", "read", "read_file", "view_file"]);
const WRITE_NAMES = new Set(["Write", "write", "write_file", "create_file"]);
const EDIT_NAMES = new Set([
    "Edit",
    "MultiEdit",
    "multi_edit",
    "edit",
    "apply_patch",
    "apply_diff",
    "str_replace_editor",
]);
const SEARCH_NAMES = new Set([
    "WebSearch",
    "web_search",
    "search",
    "Grep",
    "grep",
    "Glob",
    "glob",
]);
const FETCH_NAMES = new Set([
    "WebFetch",
    "web_fetch",
    "WebFetchTool",
    "web_fetch_tool",
    "webfetch",
]);
function resolveClaudeToolKind(name) {
    if (SHELL_NAMES.has(name))
        return "shell";
    if (READ_NAMES.has(name))
        return "read";
    if (WRITE_NAMES.has(name))
        return "write";
    if (EDIT_NAMES.has(name))
        return "edit";
    if (SEARCH_NAMES.has(name))
        return "search";
    if (FETCH_NAMES.has(name))
        return "fetch";
    if (isSpeakToolName(name))
        return "speak";
    return "unknown";
}
function resolveDetailName(toolKind, name) {
    switch (toolKind) {
        case "shell":
            return "shell";
        case "read":
            return "read_file";
        case "write":
            return "write_file";
        case "edit":
            return "apply_patch";
        case "search":
        case "fetch":
            return name;
        case "speak":
            return "speak";
        default:
            return name;
    }
}
function mapClaudeToolCall(params, status, error) {
    const parsed = ClaudeRawToolCallSchema.safeParse({ ...params, status, error });
    if (!parsed.success) {
        return null;
    }
    const raw = parsed.data;
    const callId = typeof raw.callId === "string" && raw.callId.trim().length > 0 ? raw.callId : null;
    if (callId === null) {
        return null;
    }
    const trimmedName = raw.name.trim();
    if (trimmedName === "ExitPlanMode") {
        const plan = ClaudePlanInputSchema.safeParse(raw.input);
        if (plan.success) {
            // The permission callback and transcript tool_result describe the same call.
            // Keep its native identity so resolution updates the proposal's original position.
            return {
                type: "tool_call",
                callId,
                // Older clients suppress the pending native call while showing its approval card.
                name: status === "running" ? trimmedName : "plan_approval",
                status: status === "failed" ? "completed" : status,
                error: null,
                detail: { type: "plan", text: plan.data.plan },
                metadata: {
                    ...raw.metadata,
                    ...(status === "completed" || status === "failed"
                        ? { approved: status === "completed" }
                        : {}),
                },
            };
        }
    }
    const toolKind = resolveClaudeToolKind(trimmedName);
    const name = toolKind === "speak" ? "speak" : trimmedName;
    const input = raw.input ?? null;
    const output = raw.output ?? null;
    const detail = deriveClaudeToolDetail(resolveDetailName(toolKind, name), input, output);
    if (raw.status === "failed") {
        return {
            type: "tool_call",
            callId,
            name,
            detail,
            status: "failed",
            error: raw.error ?? { message: "Tool call failed" },
            ...(raw.metadata ? { metadata: raw.metadata } : {}),
        };
    }
    return {
        type: "tool_call",
        callId,
        name,
        detail,
        status: raw.status,
        error: null,
        ...(raw.metadata ? { metadata: raw.metadata } : {}),
    };
}
export function mapClaudeRunningToolCall(params) {
    return mapClaudeToolCall(params, "running", null);
}
export function mapClaudeCompletedToolCall(params) {
    return mapClaudeToolCall(params, "completed", null);
}
export function mapClaudeFailedToolCall(params) {
    return mapClaudeToolCall(params, "failed", params.error);
}
export function mapClaudeCanceledToolCall(params) {
    return mapClaudeToolCall(params, "canceled", null);
}
//# sourceMappingURL=tool-call-mapper.js.map