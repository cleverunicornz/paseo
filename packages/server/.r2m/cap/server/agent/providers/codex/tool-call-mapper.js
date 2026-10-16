import { z } from "zod";
import { extractCodexShellOutput, normalizeToolCallStatus, truncateDiffText, } from "../tool-call-mapper-utils.js";
import { deriveCodexToolDetail, normalizeCodexFilePath } from "./tool-call-detail-parser.js";
import { isSpeakToolName } from "@getpaseo/protocol/tool-name-normalization";
const CodexCommandValueSchema = z.union([z.string(), z.array(z.string())]);
const CodexToolCallStatusSchema = z.enum(["running", "completed", "failed", "canceled"]);
const CodexToolCallEnvelopeParamsSchema = z
    .object({
    callId: z.string().optional().nullable(),
    name: z.string().min(1),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
})
    .passthrough();
const CODEX_SHELL_NAMES = new Set([
    "Bash",
    "shell",
    "bash",
    "exec",
    "exec_command",
    "command",
]);
const CODEX_READ_NAMES = new Set(["read", "read_file"]);
const CODEX_WRITE_NAMES = new Set(["write", "write_file", "create_file"]);
const CODEX_EDIT_NAMES = new Set(["edit", "apply_patch", "apply_diff"]);
const CODEX_SEARCH_NAMES = new Set(["search", "web_search"]);
function resolveCodexToolKind(name) {
    if (CODEX_SHELL_NAMES.has(name))
        return "shell";
    if (CODEX_READ_NAMES.has(name))
        return "read";
    if (CODEX_WRITE_NAMES.has(name))
        return "write";
    if (CODEX_EDIT_NAMES.has(name))
        return "edit";
    if (CODEX_SEARCH_NAMES.has(name))
        return "search";
    if (isSpeakToolName(name))
        return "speak";
    return "unknown";
}
function toToolCallTimelineItem(envelope) {
    const name = envelope.toolKind === "speak" ? "speak" : envelope.name;
    const parsedDetail = deriveCodexToolDetail({
        name,
        input: envelope.input,
        output: envelope.output,
        cwd: envelope.cwd ?? null,
    });
    const detail = envelope.toolKind === "edit" &&
        envelope.status !== "running" &&
        !hasRenderableEditDetail(parsedDetail)
        ? {
            type: "unknown",
            input: envelope.input,
            output: envelope.output,
        }
        : parsedDetail;
    if (envelope.status === "failed") {
        return {
            type: "tool_call",
            callId: envelope.callId,
            name,
            status: "failed",
            error: envelope.error ?? { message: "Tool call failed" },
            detail,
            ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
        };
    }
    return {
        type: "tool_call",
        callId: envelope.callId,
        name,
        status: envelope.status,
        error: null,
        detail,
        ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
    };
}
// ---------------------------------------------------------------------------
// Thread-item parsing
// ---------------------------------------------------------------------------
const CodexCommandExecutionItemSchema = z
    .object({
    type: z.literal("commandExecution"),
    id: z.string().min(1),
    status: z.string().optional(),
    error: z.unknown().optional(),
    command: CodexCommandValueSchema.optional(),
    cwd: z.string().optional(),
    aggregatedOutput: z.string().nullable().optional(),
    exitCode: z.number().nullable().optional(),
})
    .passthrough();
const CodexFileChangeItemSchema = z
    .object({
    type: z.literal("fileChange"),
    id: z.string().min(1),
    status: z.string().optional(),
    error: z.unknown().optional(),
    changes: z.unknown().optional(),
})
    .passthrough();
const CodexMcpToolCallItemSchema = z
    .object({
    type: z.literal("mcpToolCall"),
    id: z.string().min(1),
    status: z.string().optional(),
    error: z.unknown().optional(),
    tool: z.string().min(1),
    server: z.string().optional(),
    arguments: z.unknown().optional(),
    result: z.unknown().optional(),
})
    .passthrough();
const CodexWebSearchItemSchema = z
    .object({
    type: z.literal("webSearch"),
    id: z.string().min(1),
    status: z.string().optional(),
    error: z.unknown().optional(),
    query: z.string().optional(),
    action: z.unknown().optional(),
})
    .passthrough();
const CodexCollabAgentToolCallItemSchema = z
    .object({
    type: z.literal("collabAgentToolCall"),
    id: z.string().min(1),
    status: z.string().optional(),
    error: z.unknown().optional(),
    prompt: z.string().optional(),
    tool: z.string().optional(),
    receiverThreadIds: z.array(z.string()).optional(),
    agentsStates: z.record(z.string(), z.unknown()).optional(),
})
    .passthrough();
const CodexSubAgentActivityItemSchema = z
    .object({
    type: z.literal("subAgentActivity"),
    id: z.string().min(1),
    kind: z.enum(["started", "interacted", "interrupted"]),
    agentThreadId: z.string().min(1),
    agentPath: z.string(),
})
    .passthrough();
const CodexToolThreadItemSchema = z.discriminatedUnion("type", [
    CodexCommandExecutionItemSchema,
    CodexFileChangeItemSchema,
    CodexMcpToolCallItemSchema,
    CodexWebSearchItemSchema,
]);
const CodexThreadItemSchema = z.discriminatedUnion("type", [
    CodexCommandExecutionItemSchema,
    CodexFileChangeItemSchema,
    CodexMcpToolCallItemSchema,
    CodexWebSearchItemSchema,
    CodexCollabAgentToolCallItemSchema,
    CodexSubAgentActivityItemSchema,
]);
function unwrapShellCommand(command) {
    const trimmed = command.trim();
    const unix = trimmed.match(/^(?:(?:\/[^/\s]+)*\/)?(?:zsh|bash|sh)\s+-(?:lc|c)\s+([\s\S]+)$/);
    if (unix?.[1])
        return stripMatchingEdgeQuotes(unix[1].trim());
    const windows = trimmed.match(/^(?:"[^"]*\\)?(?:pwsh|powershell|cmd)(?:\.exe)?"?(?:\s+-[A-Za-z]+(?:\s+[^-\s][^\s]*)?)*\s+(?:-Command|-c|\/c)\s+([\s\S]+)$/i);
    return windows?.[1] ? stripMatchingEdgeQuotes(windows[1].trim()) : trimmed;
}
function stripMatchingEdgeQuotes(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
function isWindowsShellCommand(command) {
    const normalized = command.replace(/^["']|["']$/g, "");
    return /(?:^|\\)(?:pwsh|powershell|cmd)(?:\.exe)?$/i.test(normalized);
}
export function normalizeCommandExecutionCommand(value) {
    if (typeof value === "string") {
        const normalized = unwrapShellCommand(value);
        return normalized.length > 0 ? normalized : undefined;
    }
    if (!Array.isArray(value)) {
        return undefined;
    }
    const parts = value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    if (parts.length === 0) {
        return undefined;
    }
    if (parts.length >= 3 && (parts[1] === "-lc" || parts[1] === "-c")) {
        const unwrapped = parts[2]?.trim();
        return unwrapped && unwrapped.length > 0 ? unwrapped : undefined;
    }
    if (parts.length >= 3 &&
        isWindowsShellCommand(parts[0] ?? "") &&
        /^(-command|-c|\/c)$/i.test(parts[1] ?? "")) {
        const unwrapped = parts.slice(2).join(" ").trim();
        return unwrapped.length > 0 ? stripMatchingEdgeQuotes(unwrapped) : undefined;
    }
    return parts.join(" ");
}
function looksLikeUnifiedDiff(text) {
    const normalized = text.trimStart();
    if (!normalized) {
        return false;
    }
    return (normalized.startsWith("diff --git") ||
        normalized.startsWith("@@") ||
        normalized.startsWith("--- ") ||
        normalized.startsWith("+++ "));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseCodexApplyPatchDirective(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith("*** Add File:")) {
        return { kind: "add", path: trimmed.replace("*** Add File:", "").trim() };
    }
    if (trimmed.startsWith("*** Update File:")) {
        return { kind: "update", path: trimmed.replace("*** Update File:", "").trim() };
    }
    if (trimmed.startsWith("*** Delete File:")) {
        return { kind: "delete", path: trimmed.replace("*** Delete File:", "").trim() };
    }
    return null;
}
function extractPatchPrimaryFilePath(patch) {
    for (const line of patch.split(/\r?\n/)) {
        const directive = parseCodexApplyPatchDirective(line);
        if (directive && directive.path.length > 0) {
            return directive.path;
        }
    }
    return undefined;
}
function looksLikeCodexApplyPatch(text) {
    const normalized = text.trimStart();
    if (!normalized) {
        return false;
    }
    if (normalized.startsWith("*** Begin Patch")) {
        return true;
    }
    return text.split(/\r?\n/).some((line) => parseCodexApplyPatchDirective(line) !== null);
}
function normalizeDiffHeaderPath(rawPath) {
    return rawPath.trim().replace(/^["']+|["']+$/g, "");
}
function codexApplyPatchToUnifiedDiff(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const output = [];
    let sawDiffContent = false;
    for (const line of lines) {
        const directive = parseCodexApplyPatchDirective(line);
        if (directive) {
            const path = normalizeDiffHeaderPath(directive.path);
            if (path.length > 0) {
                if (output.length > 0 && output[output.length - 1] !== "") {
                    output.push("");
                }
                const left = directive.kind === "add" ? "/dev/null" : `a/${path}`;
                const right = directive.kind === "delete" ? "/dev/null" : `b/${path}`;
                output.push(`diff --git a/${path} b/${path}`);
                output.push(`--- ${left}`);
                output.push(`+++ ${right}`);
                sawDiffContent = true;
            }
            continue;
        }
        const trimmed = line.trim();
        if (trimmed === "*** Begin Patch" ||
            trimmed === "*** End Patch" ||
            trimmed === "*** End of File" ||
            trimmed.startsWith("*** Move to:")) {
            continue;
        }
        if (line.startsWith("@@")) {
            output.push(line);
            sawDiffContent = true;
            continue;
        }
        if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
            output.push(line);
            sawDiffContent = true;
            continue;
        }
        if (line.startsWith("\\ No newline at end of file")) {
            output.push(line);
            sawDiffContent = true;
            continue;
        }
    }
    if (!sawDiffContent) {
        return text;
    }
    const normalized = output.join("\n").trim();
    return normalized.length > 0 ? normalized : text;
}
function contentToDeletionDiff(filePath, content) {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const output = [];
    output.push(`diff --git a/${filePath} b/${filePath}`);
    output.push(`--- a/${filePath}`);
    output.push(`+++ /dev/null`);
    const nonEmpty = lines.filter((l) => l.length > 0 || lines.indexOf(l) < lines.length - 1);
    if (nonEmpty.length > 0) {
        output.push(`@@ -1,${nonEmpty.length} +0,0 @@`);
        for (const line of nonEmpty) {
            output.push(`-${line}`);
        }
    }
    return output.join("\n");
}
function classifyDiffLikeText(text) {
    if (looksLikeUnifiedDiff(text)) {
        return { isDiff: true, text };
    }
    if (looksLikeCodexApplyPatch(text)) {
        return { isDiff: true, text: codexApplyPatchToUnifiedDiff(text) };
    }
    return { isDiff: false, text };
}
function asEditTextFields(text) {
    if (typeof text !== "string" || text.length === 0) {
        return {};
    }
    const classified = classifyDiffLikeText(text);
    if (classified.isDiff) {
        return { unifiedDiff: truncateDiffText(classified.text) };
    }
    return { newString: text };
}
function findToolCallEditPatchText(input) {
    return ((typeof input.patch === "string" && input.patch) ||
        (typeof input.diff === "string" && input.diff) ||
        (typeof input.unified_diff === "string" && input.unified_diff) ||
        (typeof input.unifiedDiff === "string" && input.unifiedDiff) ||
        (typeof input.content === "string" && input.content) ||
        undefined);
}
function findToolCallEditInputPath(input, patchText) {
    return ((typeof input.path === "string" && input.path.trim().length > 0 ? input.path : undefined) ||
        (typeof input.file_path === "string" && input.file_path.trim().length > 0
            ? input.file_path
            : undefined) ||
        (typeof input.filePath === "string" && input.filePath.trim().length > 0
            ? input.filePath
            : undefined) ||
        extractPatchPrimaryFilePath(patchText));
}
function normalizeToolCallEditRecordInput(input) {
    const candidatePatchText = findToolCallEditPatchText(input);
    if (!candidatePatchText) {
        return input;
    }
    const textFields = asEditTextFields(candidatePatchText);
    const rawPath = findToolCallEditInputPath(input, candidatePatchText);
    const { patch: _patch, diff: _diff, unified_diff: _unifiedDiffSnake, unifiedDiff: _unifiedDiffCamel, ...rest } = input;
    const normalized = {
        ...rest,
        ...(rawPath ? { path: rawPath } : {}),
        ...(textFields.unifiedDiff ? { patch: textFields.unifiedDiff } : {}),
        ...(textFields.newString ? { content: textFields.newString } : {}),
    };
    if (textFields.unifiedDiff && "content" in normalized) {
        delete normalized.content;
    }
    return normalized;
}
function normalizeToolCallEditInput(input) {
    if (typeof input === "string") {
        const textFields = asEditTextFields(input);
        const path = extractPatchPrimaryFilePath(input);
        return {
            ...(path ? { path } : {}),
            ...(textFields.unifiedDiff ? { patch: textFields.unifiedDiff } : {}),
            ...(textFields.newString ? { content: textFields.newString } : {}),
        };
    }
    if (!isRecord(input)) {
        return input;
    }
    return normalizeToolCallEditRecordInput(input);
}
function asEditFileOutputFields(text) {
    if (typeof text !== "string" || text.length === 0) {
        return {};
    }
    const classified = classifyDiffLikeText(text);
    if (classified.isDiff) {
        return { patch: truncateDiffText(classified.text) };
    }
    return { content: text };
}
function pickFirstPatchLikeString(values) {
    for (const value of values) {
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }
    return undefined;
}
function hasRenderableEditDetail(detail) {
    if (detail.type !== "edit") {
        return true;
    }
    return ((typeof detail.unifiedDiff === "string" && detail.unifiedDiff.trim().length > 0) ||
        (typeof detail.newString === "string" && detail.newString.trim().length > 0) ||
        (typeof detail.oldString === "string" && detail.oldString.trim().length > 0));
}
function readStatus(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    return typeof value.status === "string" ? value.status : undefined;
}
function normalizeCollabAgentChildStatus(status) {
    const normalized = status.trim().toLowerCase();
    switch (normalized) {
        case "error":
        case "errored":
            return "running";
        case "shutdown":
            return "canceled";
        case "notfound":
            return "failed";
        default:
            return normalizeToolCallStatus(status, null, null);
    }
}
function resolveCollabAgentStatus(item) {
    if (item.error !== undefined && item.error !== null) {
        return "failed";
    }
    const parentStatus = normalizeToolCallStatus(item.status, null, null);
    if (parentStatus === "failed") {
        return "failed";
    }
    const childStatuses = Object.values(item.agentsStates ?? {})
        .map(readStatus)
        .filter((status) => typeof status === "string" && status.trim().length > 0)
        .map(normalizeCollabAgentChildStatus);
    if (childStatuses.some((status) => status === "failed")) {
        return "failed";
    }
    if (childStatuses.some((status) => status === "canceled")) {
        return "canceled";
    }
    if (childStatuses.length > 0) {
        return childStatuses.every((status) => status === "completed") ? "completed" : "running";
    }
    return parentStatus;
}
function buildMcpToolName(server, tool) {
    const trimmedTool = tool.trim();
    if (!trimmedTool) {
        return "tool";
    }
    const trimmedServer = typeof server === "string" ? server.trim() : "";
    if (trimmedServer.length > 0) {
        return `${trimmedServer}.${trimmedTool}`;
    }
    return trimmedTool;
}
function readMcpImageContent(block) {
    if (!isRecord(block)) {
        return null;
    }
    if (block.type !== "image") {
        return null;
    }
    if (typeof block.data !== "string" || typeof block.mimeType !== "string") {
        return null;
    }
    return {
        data: block.data,
        mimeType: block.mimeType,
    };
}
export function splitCodexMcpToolResultImages(result) {
    if (!isRecord(result) || !Array.isArray(result.content)) {
        return { images: [], output: result };
    }
    const images = [];
    const content = result.content.map((block) => {
        const image = readMcpImageContent(block);
        if (!image) {
            return block;
        }
        images.push(image);
        return { type: "text", text: "[image]" };
    });
    if (images.length === 0) {
        return { images, output: result };
    }
    return {
        images,
        output: {
            ...result,
            content,
        },
    };
}
function toNullableObject(value) {
    return Object.keys(value).length > 0 ? value : null;
}
function toToolCallFromNormalizedEnvelope(envelope) {
    if (envelope.callId.length === 0 || envelope.name.length === 0 || !envelope.status) {
        return null;
    }
    const trimmedName = envelope.name.trim();
    if (trimmedName.length === 0) {
        return null;
    }
    return toToolCallTimelineItem({
        callId: envelope.callId,
        name: trimmedName,
        toolKind: resolveCodexToolKind(trimmedName),
        input: envelope.input ?? null,
        output: envelope.output ?? null,
        status: envelope.status,
        error: envelope.error ?? null,
        ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
        cwd: envelope.cwd ?? null,
    });
}
function mapCommandExecutionItem(item) {
    const command = normalizeCommandExecutionCommand(item.command);
    const parsedOutput = extractCodexShellOutput(item.aggregatedOutput ?? undefined);
    const input = toNullableObject({
        ...(command !== undefined ? { command } : {}),
        ...(item.cwd !== undefined ? { cwd: item.cwd } : {}),
    });
    const output = parsedOutput !== undefined || item.exitCode !== undefined
        ? {
            ...(command !== undefined ? { command } : {}),
            ...(parsedOutput !== undefined ? { output: parsedOutput } : {}),
            ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
        }
        : null;
    const name = "shell";
    const error = item.error ?? null;
    const status = normalizeToolCallStatus(item.status, error, output);
    return {
        callId: item.id,
        name,
        input,
        output,
        status,
        error,
        cwd: item.cwd ?? null,
    };
}
function parseFileChangePath(entry, options, fallbackPath) {
    const rawPath = (typeof entry.path === "string" && entry.path.trim().length > 0
        ? entry.path.trim()
        : undefined) ??
        (typeof entry.file_path === "string" && entry.file_path.trim().length > 0
            ? entry.file_path.trim()
            : undefined) ??
        (typeof entry.filePath === "string" && entry.filePath.trim().length > 0
            ? entry.filePath.trim()
            : undefined) ??
        (typeof fallbackPath === "string" && fallbackPath.trim().length > 0
            ? fallbackPath.trim()
            : undefined);
    if (!rawPath) {
        return undefined;
    }
    return normalizeCodexFilePath(rawPath, options?.cwd);
}
function parseFileChangeKind(entry) {
    return ((typeof entry.kind === "string" && entry.kind) ||
        (typeof entry.type === "string" && entry.type) ||
        undefined);
}
function parseFileChangeDiff(entry) {
    return pickFirstPatchLikeString([
        entry.diff,
        entry.patch,
        entry.unified_diff,
        entry.unifiedDiff,
        entry.content,
        entry.newString,
    ]);
}
function toFileChangeEntry(entry, options, fallbackPath) {
    const path = parseFileChangePath(entry, options, fallbackPath);
    if (!path) {
        return null;
    }
    return {
        path,
        kind: parseFileChangeKind(entry),
        diff: parseFileChangeDiff(entry),
    };
}
function parseFileChangeEntries(changes, options) {
    if (!changes) {
        return [];
    }
    if (Array.isArray(changes)) {
        return changes
            .map((entry) => (isRecord(entry) ? toFileChangeEntry(entry, options) : null))
            .filter((entry) => entry !== null);
    }
    if (!isRecord(changes)) {
        return [];
    }
    if (Array.isArray(changes.files)) {
        return parseFileChangeEntries(changes.files, options);
    }
    const singleEntry = toFileChangeEntry(changes, options);
    if (singleEntry) {
        return [singleEntry];
    }
    return Object.entries(changes)
        .map(([path, value]) => {
        if (isRecord(value)) {
            return toFileChangeEntry(value, options, path);
        }
        if (typeof value === "string") {
            const normalizedPath = normalizeCodexFilePath(path.trim(), options?.cwd);
            if (!normalizedPath) {
                return null;
            }
            return { path: normalizedPath, diff: value };
        }
        return null;
    })
        .filter((entry) => entry !== null);
}
function resolveFileChangeTextFields(file) {
    if (!file) {
        return {};
    }
    const isDelete = file.kind === "delete";
    if (isDelete && file.diff) {
        const classified = classifyDiffLikeText(file.diff);
        if (classified.isDiff) {
            return { unifiedDiff: truncateDiffText(classified.text) };
        }
        return { unifiedDiff: truncateDiffText(contentToDeletionDiff(file.path, file.diff)) };
    }
    if (isDelete && !file.diff) {
        return { unifiedDiff: contentToDeletionDiff(file.path, "") };
    }
    return asEditTextFields(file.diff);
}
function mapFileChangeItem(item, options) {
    const files = parseFileChangeEntries(item.changes, options);
    const inputBase = files.length > 0
        ? {
            files: files.map((file) => ({
                path: file.path,
                ...(file.kind !== undefined ? { kind: file.kind } : {}),
            })),
        }
        : {};
    const output = toNullableObject(files.length > 0
        ? {
            files: files.map((file) => ({
                path: file.path,
                ...(file.kind !== undefined ? { kind: file.kind } : {}),
                ...(file.kind === "delete"
                    ? { patch: resolveFileChangeTextFields(file).unifiedDiff }
                    : asEditFileOutputFields(file.diff)),
            })),
        }
        : {});
    const name = "apply_patch";
    const error = item.error ?? null;
    const status = normalizeToolCallStatus(item.status, error, output);
    const firstFile = files[0];
    const firstTextFields = resolveFileChangeTextFields(firstFile);
    const hasFirstTextFields = Object.keys(firstTextFields).length > 0;
    const input = toNullableObject({
        ...inputBase,
        ...(firstFile?.path && hasFirstTextFields ? { path: firstFile.path } : {}),
        ...(hasFirstTextFields && firstTextFields.unifiedDiff
            ? { patch: firstTextFields.unifiedDiff }
            : {}),
        ...(hasFirstTextFields && firstTextFields.newString
            ? { content: firstTextFields.newString }
            : {}),
    });
    return {
        callId: item.id,
        name,
        input,
        output,
        status,
        error,
        cwd: options?.cwd ?? null,
    };
}
function mapMcpToolCallItem(item, options) {
    const tool = item.tool.trim();
    if (!tool) {
        return null;
    }
    const name = buildMcpToolName(item.server, tool);
    const input = item.arguments ?? null;
    const { output } = splitCodexMcpToolResultImages(item.result ?? null);
    const error = item.error ?? null;
    const status = normalizeToolCallStatus(item.status, error, output);
    return {
        callId: item.id,
        name,
        input,
        output,
        status,
        error,
        cwd: options?.cwd ?? null,
    };
}
function mapWebSearchItem(item) {
    const input = item.query !== undefined ? { query: item.query } : null;
    const output = item.action ?? null;
    const name = "web_search";
    const error = item.error ?? null;
    const status = normalizeToolCallStatus(item.status ?? "completed", error, output);
    return {
        callId: item.id,
        name,
        input,
        output,
        status,
        error,
        cwd: null,
    };
}
function mapCollabAgentToolCallItem(item) {
    const status = resolveCollabAgentStatus(item);
    const detail = {
        type: "sub_agent",
        subAgentType: "Sub-agent",
        ...(item.prompt ? { description: item.prompt } : {}),
        log: "",
        actions: [],
    };
    if (status === "failed") {
        return {
            type: "tool_call",
            callId: item.id,
            name: "Sub-agent",
            status,
            error: item.error ?? { message: "Sub-agent failed" },
            detail,
        };
    }
    return {
        type: "tool_call",
        callId: item.id,
        name: "Sub-agent",
        status,
        error: null,
        detail,
    };
}
function mapSubAgentActivityItem(item) {
    let nativeName = item.agentPath;
    if (nativeName === "/root") {
        nativeName = "";
    }
    else if (nativeName.startsWith("/root/")) {
        nativeName = nativeName.slice("/root/".length);
    }
    else if (/[\\/]/.test(nativeName)) {
        nativeName = nativeName.slice(Math.max(nativeName.lastIndexOf("/"), nativeName.lastIndexOf("\\")) + 1);
    }
    const description = nativeName;
    nativeName = nativeName
        .split("/")
        .map((segment) => segment.replace(/[_-]+/g, " ").trim())
        .filter(Boolean)
        .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
        .join(" / ");
    nativeName || (nativeName = "Sub-agent");
    return {
        type: "tool_call",
        callId: item.id,
        name: "Sub-agent",
        status: item.kind === "interrupted" ? "canceled" : "running",
        error: null,
        detail: {
            type: "sub_agent",
            subAgentType: nativeName,
            description,
            log: "",
            actions: [],
        },
    };
}
function mapThreadItemToNormalizedEnvelope(item, options) {
    switch (item.type) {
        case "commandExecution":
            return mapCommandExecutionItem(item);
        case "fileChange":
            return mapFileChangeItem(item, options);
        case "mcpToolCall":
            return mapMcpToolCallItem(item, options);
        case "webSearch":
            return mapWebSearchItem(item);
        default: {
            const exhaustiveCheck = item;
            throw new Error(`Unhandled Codex thread item type: ${String(exhaustiveCheck)}`);
        }
    }
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function mapCodexToolCallFromThreadItem(item, options) {
    const parsed = CodexThreadItemSchema.safeParse(item);
    if (!parsed.success) {
        return null;
    }
    if (parsed.data.type === "collabAgentToolCall") {
        return mapCollabAgentToolCallItem(parsed.data);
    }
    if (parsed.data.type === "subAgentActivity") {
        return mapSubAgentActivityItem(parsed.data);
    }
    const envelope = mapThreadItemToNormalizedEnvelope(parsed.data, options);
    if (!envelope) {
        return null;
    }
    return toToolCallFromNormalizedEnvelope(envelope);
}
export function mapCodexToolCallEnvelope(params) {
    const parsed = CodexToolCallEnvelopeParamsSchema.safeParse(params);
    if (!parsed.success) {
        return null;
    }
    const normalizedName = parsed.data.name.trim();
    if (normalizedName.length === 0) {
        return null;
    }
    const callId = typeof parsed.data.callId === "string" ? parsed.data.callId.trim() : "";
    if (callId.length === 0) {
        return null;
    }
    const normalizedInput = normalizedName === "apply_patch" || normalizedName === "apply_diff"
        ? normalizeToolCallEditInput(parsed.data.input ?? null)
        : (parsed.data.input ?? null);
    return toToolCallFromNormalizedEnvelope({
        callId,
        name: normalizedName,
        input: normalizedInput,
        output: parsed.data.output ?? null,
        error: parsed.data.error ?? null,
        status: normalizeToolCallStatus("completed", parsed.data.error ?? null, parsed.data.output ?? null),
        cwd: params.cwd ?? null,
    });
}
//# sourceMappingURL=tool-call-mapper.js.map