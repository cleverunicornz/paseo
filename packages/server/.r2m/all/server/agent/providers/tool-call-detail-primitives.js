import { z } from "zod";
import { extractCodexShellOutput, flattenReadContent as flattenToolReadContent, nonEmptyString, stripReadLineNumberGutter, truncateDiffText, } from "./tool-call-mapper-utils.js";
export const CommandValueSchema = z.union([z.string(), z.array(z.string())]);
export const ToolShellInputSchema = z
    .union([
    z
        .object({
        command: CommandValueSchema,
        cwd: z.string().optional(),
        directory: z.string().optional(),
    })
        .passthrough(),
    z
        .object({
        cmd: CommandValueSchema,
        cwd: z.string().optional(),
        directory: z.string().optional(),
    })
        .passthrough(),
])
    .transform((value) => {
    const parsedCommand = CommandValueSchema.safeParse("command" in value ? value.command : value.cmd);
    let command;
    if (parsedCommand.success) {
        if (typeof parsedCommand.data === "string") {
            command = nonEmptyString(parsedCommand.data);
        }
        else {
            command =
                parsedCommand.data
                    .map((token) => token.trim())
                    .filter((token) => token.length > 0)
                    .join(" ") || undefined;
        }
    }
    return {
        command,
        cwd: nonEmptyString(value.cwd) ?? nonEmptyString(value.directory),
    };
});
const ToolShellOutputObjectSchema = z
    .object({
    command: z.string().optional(),
    output: z.string().optional(),
    text: z.string().optional(),
    content: z.string().optional(),
    aggregated_output: z.string().optional(),
    aggregatedOutput: z.string().optional(),
    exitCode: z.number().finite().nullable().optional(),
    exit_code: z.number().finite().nullable().optional(),
    metadata: z
        .object({
        exitCode: z.number().finite().nullable().optional(),
        exit_code: z.number().finite().nullable().optional(),
    })
        .passthrough()
        .optional(),
    structuredContent: z
        .object({
        output: z.string().optional(),
        text: z.string().optional(),
        content: z.string().optional(),
    })
        .passthrough()
        .optional(),
    structured_content: z
        .object({
        output: z.string().optional(),
        text: z.string().optional(),
        content: z.string().optional(),
    })
        .passthrough()
        .optional(),
    result: z
        .object({
        command: z.string().optional(),
        output: z.string().optional(),
        text: z.string().optional(),
        content: z.string().optional(),
    })
        .passthrough()
        .optional(),
})
    .passthrough();
function firstNonEmptyString(values) {
    for (const value of values) {
        const resolved = nonEmptyString(value);
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
}
function resolveShellOutputRawText(value) {
    return firstNonEmptyString([
        value.output,
        value.text,
        value.content,
        value.aggregated_output,
        value.aggregatedOutput,
        value.structuredContent?.output,
        value.structuredContent?.text,
        value.structuredContent?.content,
        value.structured_content?.output,
        value.structured_content?.text,
        value.structured_content?.content,
        value.result?.output,
        value.result?.text,
        value.result?.content,
    ]);
}
function resolveShellOutputExitCode(value) {
    return (value.exitCode ??
        value.exit_code ??
        value.metadata?.exitCode ??
        value.metadata?.exit_code ??
        undefined);
}
function transformShellOutputObject(value) {
    return {
        command: nonEmptyString(value.command) ?? nonEmptyString(value.result?.command),
        output: extractCodexShellOutput(resolveShellOutputRawText(value)),
        exitCode: resolveShellOutputExitCode(value),
    };
}
export const ToolShellOutputSchema = z.union([
    z.string().transform((value) => ({
        command: undefined,
        output: extractCodexShellOutput(value),
        exitCode: undefined,
    })),
    ToolShellOutputObjectSchema.transform((value) => transformShellOutputObject(value)),
]);
export const ToolPathInputSchema = z.union([
    z
        .object({ path: z.string() })
        .passthrough()
        .transform((value) => ({ filePath: value.path })),
    z
        .object({ file_path: z.string() })
        .passthrough()
        .transform((value) => ({ filePath: value.file_path })),
    z
        .object({ filePath: z.string() })
        .passthrough()
        .transform((value) => ({ filePath: value.filePath })),
]);
export const ToolReadInputSchema = z.union([
    z
        .object({
        path: z.string(),
        offset: z.number().finite().optional(),
        limit: z.number().finite().optional(),
    })
        .passthrough()
        .transform((value) => ({ filePath: value.path, offset: value.offset, limit: value.limit })),
    z
        .object({
        file_path: z.string(),
        offset: z.number().finite().optional(),
        limit: z.number().finite().optional(),
    })
        .passthrough()
        .transform((value) => ({
        filePath: value.file_path,
        offset: value.offset,
        limit: value.limit,
    })),
    z
        .object({
        filePath: z.string(),
        offset: z.number().finite().optional(),
        limit: z.number().finite().optional(),
    })
        .passthrough()
        .transform((value) => ({ filePath: value.filePath, offset: value.offset, limit: value.limit })),
]);
const ToolReadChunkSchema = z.union([
    z
        .object({
        text: z.string(),
        content: z.string().optional(),
        output: z.string().optional(),
    })
        .passthrough(),
    z
        .object({
        text: z.string().optional(),
        content: z.string(),
        output: z.string().optional(),
    })
        .passthrough(),
    z
        .object({
        text: z.string().optional(),
        content: z.string().optional(),
        output: z.string(),
    })
        .passthrough(),
]);
const ToolReadContentSchema = z.union([
    z.string(),
    ToolReadChunkSchema,
    z.array(ToolReadChunkSchema),
]);
const ToolReadPayloadSchema = z.union([
    z
        .object({
        content: ToolReadContentSchema,
        text: ToolReadContentSchema.optional(),
        output: ToolReadContentSchema.optional(),
    })
        .passthrough(),
    z
        .object({
        content: ToolReadContentSchema.optional(),
        text: ToolReadContentSchema,
        output: ToolReadContentSchema.optional(),
    })
        .passthrough(),
    z
        .object({
        content: ToolReadContentSchema.optional(),
        text: ToolReadContentSchema.optional(),
        output: ToolReadContentSchema,
    })
        .passthrough(),
]);
function flattenReadContent(value) {
    return flattenToolReadContent(value);
}
function readXmlTag(value, tagName) {
    const match = value.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
    return match?.[1];
}
function decodeXmlText(value) {
    return value.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|amp|lt|gt|quot|apos);/g, (entity, decimal, hex) => {
        if (decimal) {
            return String.fromCodePoint(Number.parseInt(decimal, 10));
        }
        if (hex) {
            return String.fromCodePoint(Number.parseInt(hex, 16));
        }
        switch (entity) {
            case "&amp;":
                return "&";
            case "&lt;":
                return "<";
            case "&gt;":
                return ">";
            case "&quot;":
                return '"';
            case "&apos;":
                return "'";
            default:
                return entity;
        }
    });
}
function trimOuterLineBreaks(value) {
    return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}
function parseXmlReadOutput(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith("<path>") || !/<content>/i.test(trimmed)) {
        return undefined;
    }
    const filePath = nonEmptyString(readXmlTag(trimmed, "path")?.trim());
    const content = readXmlTag(trimmed, "content");
    if (!filePath && content === undefined) {
        return undefined;
    }
    return {
        filePath: filePath ? decodeXmlText(filePath) : undefined,
        content: content === undefined ? undefined : decodeXmlText(trimOuterLineBreaks(content)),
    };
}
const ToolReadOutputContentSchema = z.union([
    z.string().transform((value) => {
        const xmlReadOutput = parseXmlReadOutput(value);
        if (xmlReadOutput) {
            return xmlReadOutput;
        }
        return { filePath: undefined, content: nonEmptyString(value) };
    }),
    ToolReadChunkSchema.transform((value) => ({
        filePath: undefined,
        content: flattenReadContent(value),
    })),
    z.array(ToolReadChunkSchema).transform((value) => ({
        filePath: undefined,
        content: flattenReadContent(value),
    })),
    ToolReadPayloadSchema.transform((value) => ({
        filePath: undefined,
        content: flattenReadContent(value.content) ??
            flattenReadContent(value.text) ??
            flattenReadContent(value.output),
    })),
    z
        .object({ data: ToolReadPayloadSchema })
        .passthrough()
        .transform((value) => ({
        filePath: undefined,
        content: flattenReadContent(value.data.content) ??
            flattenReadContent(value.data.text) ??
            flattenReadContent(value.data.output),
    })),
    z
        .object({ structuredContent: ToolReadPayloadSchema })
        .passthrough()
        .transform((value) => ({
        filePath: undefined,
        content: flattenReadContent(value.structuredContent.content) ??
            flattenReadContent(value.structuredContent.text) ??
            flattenReadContent(value.structuredContent.output),
    })),
    z
        .object({ structured_content: ToolReadPayloadSchema })
        .passthrough()
        .transform((value) => ({
        filePath: undefined,
        content: flattenReadContent(value.structured_content.content) ??
            flattenReadContent(value.structured_content.text) ??
            flattenReadContent(value.structured_content.output),
    })),
]);
const ToolReadOutputPathSchema = z.union([
    z
        .object({
        path: z.string(),
        content: ToolReadContentSchema.optional(),
        text: ToolReadContentSchema.optional(),
        output: ToolReadContentSchema.optional(),
    })
        .passthrough()
        .transform((value) => ({
        filePath: value.path,
        content: flattenReadContent(value.content) ??
            flattenReadContent(value.text) ??
            flattenReadContent(value.output),
    })),
    z
        .object({
        file_path: z.string(),
        content: ToolReadContentSchema.optional(),
        text: ToolReadContentSchema.optional(),
        output: ToolReadContentSchema.optional(),
    })
        .passthrough()
        .transform((value) => ({
        filePath: value.file_path,
        content: flattenReadContent(value.content) ??
            flattenReadContent(value.text) ??
            flattenReadContent(value.output),
    })),
    z
        .object({
        filePath: z.string(),
        content: ToolReadContentSchema.optional(),
        text: ToolReadContentSchema.optional(),
        output: ToolReadContentSchema.optional(),
    })
        .passthrough()
        .transform((value) => ({
        filePath: value.filePath,
        content: flattenReadContent(value.content) ??
            flattenReadContent(value.text) ??
            flattenReadContent(value.output),
    })),
]);
export const ToolReadOutputSchema = ToolReadOutputContentSchema;
export const ToolReadOutputWithPathSchema = z.union([
    ToolReadOutputContentSchema,
    ToolReadOutputPathSchema,
]);
export const ToolWriteContentSchema = z
    .object({
    content: z.string().optional(),
    new_content: z.string().optional(),
    newContent: z.string().optional(),
})
    .passthrough();
export const ToolWriteInputSchema = z
    .intersection(ToolPathInputSchema, ToolWriteContentSchema)
    .transform((value) => ({
    filePath: value.filePath,
    content: nonEmptyString(value.content) ??
        nonEmptyString(value.new_content) ??
        nonEmptyString(value.newContent),
}));
export const ToolWriteOutputSchema = z.union([
    z.string().transform(() => ({
        filePath: undefined,
        content: undefined,
    })),
    z.intersection(ToolPathInputSchema, ToolWriteContentSchema).transform((value) => ({
        filePath: value.filePath,
        content: nonEmptyString(value.content) ??
            nonEmptyString(value.new_content) ??
            nonEmptyString(value.newContent),
    })),
    ToolWriteContentSchema.transform((value) => ({
        filePath: undefined,
        content: nonEmptyString(value.content) ??
            nonEmptyString(value.new_content) ??
            nonEmptyString(value.newContent),
    })),
]);
export const ToolEditTextSchema = z
    .object({
    old_string: z.string().optional(),
    old_str: z.string().optional(),
    oldContent: z.string().optional(),
    old_content: z.string().optional(),
    new_string: z.string().optional(),
    new_str: z.string().optional(),
    newContent: z.string().optional(),
    new_content: z.string().optional(),
    content: z.string().optional(),
    patch: z.string().optional(),
    diff: z.string().optional(),
    unified_diff: z.string().optional(),
    unifiedDiff: z.string().optional(),
})
    .passthrough();
export const ToolEditInputSchema = z
    .intersection(ToolPathInputSchema, ToolEditTextSchema)
    .transform((value) => ({
    filePath: value.filePath,
    oldString: nonEmptyString(value.old_string) ??
        nonEmptyString(value.old_str) ??
        nonEmptyString(value.oldContent) ??
        nonEmptyString(value.old_content),
    newString: nonEmptyString(value.new_string) ??
        nonEmptyString(value.new_str) ??
        nonEmptyString(value.newContent) ??
        nonEmptyString(value.new_content) ??
        nonEmptyString(value.content),
    unifiedDiff: truncateDiffText(nonEmptyString(value.patch) ??
        nonEmptyString(value.diff) ??
        nonEmptyString(value.unified_diff) ??
        nonEmptyString(value.unifiedDiff)),
}));
const ToolEditOutputFileSchema = z.union([
    z
        .object({
        path: z.string(),
        patch: z.string().optional(),
        diff: z.string().optional(),
        unified_diff: z.string().optional(),
        unifiedDiff: z.string().optional(),
    })
        .passthrough()
        .transform((value) => ({
        filePath: value.path,
        unifiedDiff: truncateDiffText(nonEmptyString(value.patch) ??
            nonEmptyString(value.diff) ??
            nonEmptyString(value.unified_diff) ??
            nonEmptyString(value.unifiedDiff)),
    })),
    z
        .object({
        file_path: z.string(),
        patch: z.string().optional(),
        diff: z.string().optional(),
        unified_diff: z.string().optional(),
        unifiedDiff: z.string().optional(),
    })
        .passthrough()
        .transform((value) => ({
        filePath: value.file_path,
        unifiedDiff: truncateDiffText(nonEmptyString(value.patch) ??
            nonEmptyString(value.diff) ??
            nonEmptyString(value.unified_diff) ??
            nonEmptyString(value.unifiedDiff)),
    })),
    z
        .object({
        filePath: z.string(),
        patch: z.string().optional(),
        diff: z.string().optional(),
        unified_diff: z.string().optional(),
        unifiedDiff: z.string().optional(),
    })
        .passthrough()
        .transform((value) => ({
        filePath: value.filePath,
        unifiedDiff: truncateDiffText(nonEmptyString(value.patch) ??
            nonEmptyString(value.diff) ??
            nonEmptyString(value.unified_diff) ??
            nonEmptyString(value.unifiedDiff)),
    })),
]);
export const ToolEditOutputSchema = z.union([
    z.intersection(ToolPathInputSchema, ToolEditTextSchema).transform((value) => ({
        filePath: value.filePath,
        newString: nonEmptyString(value.newContent) ??
            nonEmptyString(value.new_content) ??
            nonEmptyString(value.content),
        unifiedDiff: truncateDiffText(nonEmptyString(value.patch) ??
            nonEmptyString(value.diff) ??
            nonEmptyString(value.unified_diff) ??
            nonEmptyString(value.unifiedDiff)),
    })),
    z
        .object({ files: z.array(ToolEditOutputFileSchema).min(1) })
        .passthrough()
        .transform((value) => ({
        filePath: value.files[0]?.filePath,
        unifiedDiff: value.files[0]?.unifiedDiff,
        newString: undefined,
    })),
    ToolEditTextSchema.transform((value) => ({
        filePath: undefined,
        newString: nonEmptyString(value.newContent) ??
            nonEmptyString(value.new_content) ??
            nonEmptyString(value.content),
        unifiedDiff: truncateDiffText(nonEmptyString(value.patch) ??
            nonEmptyString(value.diff) ??
            nonEmptyString(value.unified_diff) ??
            nonEmptyString(value.unifiedDiff)),
    })),
]);
export const ToolSearchInputSchema = z.union([
    z
        .object({ query: z.string() })
        .passthrough()
        .transform((value) => ({ query: value.query })),
    z
        .object({ q: z.string() })
        .passthrough()
        .transform((value) => ({ query: value.q })),
    z
        .object({ pattern: z.string() })
        .passthrough()
        .transform((value) => ({ query: value.pattern })),
]);
export const ToolGlobOutputSchema = z
    .object({
    durationMs: z.number().finite(),
    numFiles: z.number().int().nonnegative(),
    filenames: z.array(z.string()),
    truncated: z.boolean(),
})
    .passthrough();
export const ToolGrepOutputSchema = z
    .object({
    mode: z.enum(["content", "files_with_matches", "count"]).optional(),
    numFiles: z.number().int().nonnegative(),
    filenames: z.array(z.string()),
    content: z.string().optional(),
    numLines: z.number().int().nonnegative().optional(),
    numMatches: z.number().int().nonnegative().optional(),
    appliedLimit: z.number().int().nonnegative().optional(),
    appliedOffset: z.number().int().nonnegative().optional(),
})
    .passthrough();
export const ToolWebFetchInputSchema = z
    .object({
    url: z.string(),
    prompt: z.string(),
})
    .passthrough();
export const ToolWebFetchOutputSchema = z
    .object({
    bytes: z.number().int().nonnegative(),
    code: z.number().int(),
    codeText: z.string(),
    result: z.string(),
    durationMs: z.number().finite(),
    url: z.string(),
})
    .passthrough();
const ToolWebSearchResultHitSchema = z
    .object({
    title: z.string(),
    url: z.string(),
})
    .passthrough();
const ToolWebSearchResultEntrySchema = z.union([
    z
        .object({
        tool_use_id: z.string(),
        content: z.array(ToolWebSearchResultHitSchema),
    })
        .passthrough(),
    z.string(),
]);
export const ToolWebSearchOutputSchema = z
    .object({
    query: z.string(),
    results: z.array(ToolWebSearchResultEntrySchema),
    durationSeconds: z.number().finite(),
})
    .passthrough();
function normalizeDetailPath(filePath, normalizePath) {
    if (typeof filePath !== "string") {
        return undefined;
    }
    const trimmed = filePath.trim();
    if (!trimmed) {
        return undefined;
    }
    return normalizePath ? normalizePath(trimmed) : trimmed;
}
function isParsedToolGlobOutput(output) {
    return Boolean(output && "truncated" in output);
}
function isParsedToolGrepOutput(output) {
    return Boolean(output && "filenames" in output && !("truncated" in output));
}
function isParsedToolWebSearchOutput(output) {
    return Boolean(output && "results" in output);
}
export function toShellToolDetail(input, output) {
    const command = input?.command ?? output?.command;
    if (!command) {
        return undefined;
    }
    return {
        type: "shell",
        command,
        ...(input?.cwd ? { cwd: input.cwd } : {}),
        ...(output?.output ? { output: output.output } : {}),
        ...(output?.exitCode !== undefined ? { exitCode: output.exitCode } : {}),
    };
}
export function toReadToolDetail(input, output, options) {
    const filePath = normalizeDetailPath(input?.filePath ?? output?.filePath, options?.normalizePath);
    if (!filePath) {
        return undefined;
    }
    const stripped = output?.content ? stripReadLineNumberGutter(output.content) : undefined;
    const content = stripped?.content ?? output?.content;
    const offset = input?.offset ?? stripped?.startLine;
    return {
        type: "read",
        filePath,
        ...(content ? { content } : {}),
        ...(offset !== undefined ? { offset } : {}),
        ...(input?.limit !== undefined ? { limit: input.limit } : {}),
    };
}
export function toWriteToolDetail(input, output, options) {
    const filePath = normalizeDetailPath(input?.filePath ?? output?.filePath, options?.normalizePath);
    if (!filePath) {
        return undefined;
    }
    const content = input?.content ?? output?.content;
    return {
        type: "write",
        filePath,
        ...(content ? { content } : {}),
    };
}
export function toEditToolDetail(input, output, options) {
    const filePath = normalizeDetailPath(input?.filePath ?? output?.filePath, options?.normalizePath);
    if (!filePath) {
        return undefined;
    }
    const newString = input?.newString ?? output?.newString;
    const unifiedDiff = input?.unifiedDiff ?? output?.unifiedDiff;
    return {
        type: "edit",
        filePath,
        ...(input?.oldString ? { oldString: input.oldString } : {}),
        ...(newString ? { newString } : {}),
        ...(unifiedDiff ? { unifiedDiff } : {}),
    };
}
function buildWebSearchExtraFields(output) {
    const webResults = output.results.flatMap((entry) => typeof entry === "string" ? [] : entry.content);
    const annotations = output.results.filter((entry) => typeof entry === "string");
    return {
        ...(webResults.length > 0 ? { webResults } : {}),
        ...(annotations.length > 0 ? { annotations } : {}),
        durationSeconds: output.durationSeconds,
    };
}
function buildGrepExtraFields(output) {
    const filePaths = output.filenames.length > 0 ? output.filenames : undefined;
    return {
        ...(output.content ? { content: output.content } : {}),
        ...(filePaths ? { filePaths } : {}),
        numFiles: output.numFiles,
        ...(output.numMatches !== undefined ? { numMatches: output.numMatches } : {}),
        ...(output.mode ? { mode: output.mode } : {}),
    };
}
function buildGlobExtraFields(output) {
    const filePaths = output.filenames.length > 0 ? output.filenames : undefined;
    return {
        ...(filePaths ? { filePaths } : {}),
        numFiles: output.numFiles,
        durationMs: output.durationMs,
        truncated: output.truncated,
    };
}
function buildSearchToolDetailOutputFields(output) {
    if (isParsedToolGrepOutput(output)) {
        return buildGrepExtraFields(output);
    }
    if (isParsedToolGlobOutput(output)) {
        return buildGlobExtraFields(output);
    }
    if (isParsedToolWebSearchOutput(output)) {
        return buildWebSearchExtraFields(output);
    }
    return {};
}
export function toSearchToolDetail(params) {
    const { input, output, toolName } = params;
    if (!input?.query) {
        return undefined;
    }
    return {
        type: "search",
        query: input.query,
        ...(toolName ? { toolName } : {}),
        ...buildSearchToolDetailOutputFields(output),
    };
}
export function toFetchToolDetail(input, output) {
    const url = input?.url ?? output?.url;
    if (!url) {
        return undefined;
    }
    return {
        type: "fetch",
        url,
        ...(input?.prompt ? { prompt: input.prompt } : {}),
        ...(output?.result ? { result: output.result } : {}),
        ...(output?.code !== undefined ? { code: output.code } : {}),
        ...(output?.codeText ? { codeText: output.codeText } : {}),
        ...(output?.bytes !== undefined ? { bytes: output.bytes } : {}),
        ...(output?.durationMs !== undefined ? { durationMs: output.durationMs } : {}),
    };
}
export function toolDetailBranchByName(name, inputSchema, outputSchema, mapper) {
    const shape = {
        name: z.literal(name),
        input: z.nullable(inputSchema),
        output: z.nullable(outputSchema),
    };
    const schema = z.object(shape);
    return schema.transform((value) => {
        // Zod v4 drops generic unknown-valued shape fields from object output inference here.
        const parsedValue = value;
        return mapper(parsedValue.input, parsedValue.output);
    });
}
export function toolDetailBranchByToolName(toolName, inputSchema, outputSchema, mapper) {
    const shape = {
        toolName: z.literal(toolName),
        input: z.nullable(inputSchema),
        output: z.nullable(outputSchema),
    };
    const schema = z.object(shape);
    return schema.transform((value) => {
        const parsedValue = value;
        return mapper(parsedValue.input, parsedValue.output);
    });
}
export function toolDetailBranchByNameWithCwd(name, inputSchema, outputSchema, mapper) {
    const shape = {
        name: z.literal(name),
        input: z.nullable(inputSchema),
        output: z.nullable(outputSchema),
        cwd: z.string().optional().nullable(),
    };
    const schema = z.object(shape);
    return schema.transform((value) => {
        const parsedValue = value;
        return mapper(parsedValue.input, parsedValue.output, parsedValue.cwd ?? null);
    });
}
//# sourceMappingURL=tool-call-detail-primitives.js.map