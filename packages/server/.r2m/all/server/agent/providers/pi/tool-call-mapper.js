import { z } from "zod";
const PiToolResultTextContentSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
});
const PiToolResultUnknownContentSchema = z
    .object({
    type: z.string(),
})
    .passthrough();
const PiToolResultContentSchema = z.union([
    PiToolResultTextContentSchema,
    PiToolResultUnknownContentSchema,
]);
const PiToolResultDetailsSchema = z
    .object({
    diff: z.string().optional(),
})
    .passthrough();
const PiToolResultObjectSchema = z
    .object({
    output: z.string().optional(),
    stdout: z.string().optional(),
    text: z.string().optional(),
    content: z.array(PiToolResultContentSchema).optional(),
    exitCode: z.number().optional(),
    code: z.number().optional(),
    details: PiToolResultDetailsSchema.optional(),
})
    .passthrough();
const PiToolResultSchema = z.union([z.string(), PiToolResultObjectSchema, z.null()]);
const BashToolInputSchema = z.object({
    command: z.string(),
    timeout: z.number().optional(),
});
const ReadToolInputSchema = z.object({
    path: z.string(),
    offset: z.number().optional(),
    limit: z.number().optional(),
});
const EditToolInputSchema = z.object({
    path: z.string(),
    edits: z.array(z.object({
        oldText: z.string(),
        newText: z.string(),
    })),
});
const LegacyEditToolInputSchema = z.object({
    path: z.string(),
    old_string: z.string().optional(),
    oldString: z.string().optional(),
    new_string: z.string().optional(),
    newString: z.string().optional(),
});
const WriteToolInputSchema = z.object({
    path: z.string(),
    content: z.string(),
});
const FindToolInputSchema = z.object({
    pattern: z.string(),
    path: z.string().optional(),
    limit: z.number().optional(),
});
const GrepToolInputSchema = z.object({
    pattern: z.string(),
    path: z.string().optional(),
    glob: z.string().optional(),
    ignoreCase: z.boolean().optional(),
    literal: z.boolean().optional(),
    context: z.number().optional(),
    limit: z.number().optional(),
});
const LsToolInputSchema = z.object({
    path: z.string().optional(),
    limit: z.number().optional(),
});
export function parseToolResult(rawResult) {
    const parsed = PiToolResultSchema.safeParse(rawResult);
    if (parsed.success) {
        return parsed.data;
    }
    return null;
}
export function extractTextFromToolResult(result) {
    if (typeof result === "string") {
        return result;
    }
    if (!result) {
        return undefined;
    }
    const directText = result.output ?? result.stdout ?? result.text;
    if (directText) {
        return directText;
    }
    if (!result.content) {
        return undefined;
    }
    const textParts = [];
    for (const block of result.content) {
        if (block.type === "text" && "text" in block) {
            textParts.push(block.text);
        }
    }
    return textParts.length > 0 ? textParts.join("\n") : undefined;
}
export function parseToolArgs(toolName, rawArgs) {
    if (toolName === "edit") {
        return parseEditToolArgs(rawArgs);
    }
    const schema = SIMPLE_TOOL_SCHEMAS[toolName];
    if (schema) {
        const parsed = schema.safeParse(rawArgs);
        if (parsed.success) {
            return { kind: toolName, toolName, args: parsed.data };
        }
    }
    return { kind: "unknown", toolName, args: rawArgs ?? null };
}
export function mapToolDetail(toolCall, result) {
    const parsedResult = result ?? null;
    switch (toolCall.kind) {
        case "bash": {
            const summary = resolveToolCallOutput(parsedResult);
            return {
                type: "shell",
                command: toolCall.args.command,
                output: summary.output,
                exitCode: summary.exitCode,
            };
        }
        case "read":
            return {
                type: "read",
                filePath: toolCall.args.path,
                content: extractTextFromToolResult(parsedResult),
                offset: toolCall.args.offset,
                limit: toolCall.args.limit,
            };
        case "edit": {
            const firstEdit = toolCall.args.edits[0];
            const unifiedDiff = parsedResult && typeof parsedResult !== "string" ? parsedResult.details?.diff : undefined;
            return {
                type: "edit",
                filePath: toolCall.args.path,
                oldString: firstEdit?.oldText,
                newString: firstEdit?.newText,
                unifiedDiff,
            };
        }
        case "write":
            return { type: "write", filePath: toolCall.args.path, content: toolCall.args.content };
        case "find":
            return mapFindToolDetail(toolCall.args, parsedResult);
        case "grep":
            return mapGrepToolDetail(toolCall.args, parsedResult);
        case "ls":
            return mapLsToolDetail(toolCall.args, parsedResult);
        default:
            return {
                type: "unknown",
                input: toolCall.args,
                output: parsedResult,
            };
    }
}
function resolveToolCallOutput(result) {
    if (typeof result === "string") {
        return { output: result };
    }
    if (!result) {
        return {};
    }
    const summary = {
        output: extractTextFromToolResult(result),
    };
    if (typeof result.exitCode === "number") {
        summary.exitCode = result.exitCode;
        return summary;
    }
    if (typeof result.code === "number") {
        summary.exitCode = result.code;
        return summary;
    }
    summary.exitCode = null;
    return summary;
}
function normalizeLegacyEditArgs(rawArgs) {
    const parsed = LegacyEditToolInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
        return null;
    }
    const oldText = parsed.data.old_string ?? parsed.data.oldString;
    const newText = parsed.data.new_string ?? parsed.data.newString;
    if (!oldText || newText === undefined) {
        return null;
    }
    return {
        path: parsed.data.path,
        edits: [{ oldText, newText }],
    };
}
function parseEditToolArgs(rawArgs) {
    const parsed = EditToolInputSchema.safeParse(rawArgs);
    if (parsed.success) {
        return { kind: "edit", toolName: "edit", args: parsed.data };
    }
    const legacyArgs = normalizeLegacyEditArgs(rawArgs);
    if (legacyArgs) {
        return { kind: "edit", toolName: "edit", args: legacyArgs };
    }
    return { kind: "unknown", toolName: "edit", args: rawArgs ?? null };
}
const SIMPLE_TOOL_SCHEMAS = {
    bash: BashToolInputSchema,
    read: ReadToolInputSchema,
    write: WriteToolInputSchema,
    find: FindToolInputSchema,
    grep: GrepToolInputSchema,
    ls: LsToolInputSchema,
};
function mapFindToolDetail(args, result) {
    return {
        type: "search",
        query: args.pattern,
        toolName: "search",
        content: typeof result === "string" ? result : undefined,
    };
}
function mapGrepToolDetail(args, result) {
    return {
        type: "search",
        query: args.pattern,
        toolName: "grep",
        content: typeof result === "string" ? result : undefined,
    };
}
function mapLsToolDetail(args, result) {
    return {
        type: "search",
        query: args.path ?? "ls",
        content: typeof result === "string" ? result : undefined,
    };
}
//# sourceMappingURL=tool-call-mapper.js.map