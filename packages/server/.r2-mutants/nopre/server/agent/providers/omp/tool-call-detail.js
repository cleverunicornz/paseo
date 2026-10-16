import { z } from "zod";
const OmpToolResultTextContentSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
});
const OmpToolResultUnknownContentSchema = z
    .object({
    type: z.string(),
})
    .passthrough();
const OmpToolResultContentSchema = z.union([
    OmpToolResultTextContentSchema,
    OmpToolResultUnknownContentSchema,
]);
// OMP's own tools report a string error; Paseo host tools (browser_*) report
// a structured `{ code, message, retryable }` error.
const OmpToolResultErrorSchema = z.union([
    z.string(),
    z.object({ message: z.string() }).passthrough(),
]);
const OmpToolResultDetailsSchema = z
    .object({
    diff: z.string().optional(),
    error: OmpToolResultErrorSchema.optional(),
})
    .passthrough();
const XdevExecuteDetailsSchema = z.object({
    tool: z.string().trim().min(1),
    mode: z.literal("execute"),
    args: z.unknown().optional(),
    inner: z.unknown().optional(),
});
const OmpToolResultObjectSchema = z
    .object({
    output: z.string().optional(),
    stdout: z.string().optional(),
    text: z.string().optional(),
    content: z.array(OmpToolResultContentSchema).optional(),
    exitCode: z.number().optional(),
    code: z.number().optional(),
    details: OmpToolResultDetailsSchema.optional(),
})
    .passthrough();
const OmpToolResultSchema = z.union([z.string(), OmpToolResultObjectSchema, z.null()]);
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
    const parsed = OmpToolResultSchema.safeParse(rawResult);
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
export function toolFailureMessage(result) {
    const error = result && typeof result !== "string" ? result.details?.error : undefined;
    const errorMessage = typeof error === "string" ? error : error?.message;
    if (errorMessage) {
        return errorMessage.split("\n", 1)[0].slice(0, 240);
    }
    const output = extractTextFromToolResult(result);
    const exitMessage = output?.match(/(?:Command|Process) exited with code \d+/i)?.[0];
    if (exitMessage)
        return exitMessage;
    const firstLine = output
        ?.split("\n")
        .find((line) => line.trim())
        ?.trim();
    if (firstLine)
        return firstLine.slice(0, 240);
    if (result && typeof result !== "string") {
        const code = result.exitCode ?? result.code;
        if (typeof code === "number")
            return `Tool exited with code ${code}`;
    }
    return "Tool call failed";
}
export function isOmpToolFailure(toolCall, result, isError) {
    return (isError ||
        (toolCall.toolName === "web_search" &&
            result !== null &&
            typeof result !== "string" &&
            typeof result.details?.error === "string"));
}
export function parseToolArgs(toolName, rawArgs) {
    if (toolName === "edit") {
        return parseEditToolArgs(rawArgs);
    }
    const schema = SIMPLE_TOOL_SCHEMAS[toolName];
    if (schema) {
        const parsed = schema.safeParse(rawArgs);
        if (parsed.success) {
            return {
                kind: toolName,
                toolName,
                args: parsed.data,
            };
        }
    }
    return { kind: "unknown", toolName, args: rawArgs ?? null };
}
export function resolveToolCallName(toolCall, result) {
    if ((toolCall.kind === "read" || toolCall.kind === "write") &&
        toolCall.args.path.startsWith("xd://")) {
        return toolCall.args.path.slice("xd://".length).split(/[/?#]/, 1)[0] || toolCall.toolName;
    }
    if (toolCall.kind === "write" && result && typeof result !== "string") {
        const xdev = XdevExecuteDetailsSchema.safeParse(result.details?.xdev);
        if (xdev.success) {
            return xdev.data.tool;
        }
    }
    return toolCall.toolName;
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
            if (toolCall.args.path.startsWith("xd://")) {
                return {
                    type: "plain_text",
                    label: resolveToolCallName(toolCall),
                    text: extractTextFromToolResult(parsedResult),
                };
            }
            if (/^https?:\/\//.test(toolCall.args.path)) {
                return {
                    type: "fetch",
                    url: toolCall.args.path,
                    result: extractTextFromToolResult(parsedResult),
                };
            }
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
            return mapWriteToolDetail(toolCall.args, parsedResult);
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
function mapWriteToolDetail(args, result) {
    if (result && typeof result !== "string" && result.details && "xdev" in result.details) {
        const xdev = XdevExecuteDetailsSchema.safeParse(result.details.xdev);
        if (xdev.success) {
            return {
                type: "unknown",
                input: xdev.data.args ?? null,
                output: {
                    ...result,
                    details: xdev.data.inner ?? null,
                },
            };
        }
        return {
            type: "unknown",
            input: args,
            output: result,
        };
    }
    // A write to `xd://` runs a tool, not a file write. Name the invoked tool while it runs.
    if (args.path.startsWith("xd://")) {
        return {
            type: "plain_text",
            label: args.path.slice("xd://".length).split(/[/?#]/, 1)[0],
            text: extractTextFromToolResult(result),
        };
    }
    return {
        type: "write",
        filePath: args.path,
        content: args.content,
    };
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
//# sourceMappingURL=tool-call-detail.js.map