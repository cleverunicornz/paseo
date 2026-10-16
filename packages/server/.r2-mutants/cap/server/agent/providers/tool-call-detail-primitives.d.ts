import { z } from "zod";
import type { ToolCallDetail } from "../agent-sdk-types.js";
export declare const CommandValueSchema: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
type ToolDetailSchema = z.ZodType;
export declare const ToolShellInputSchema: z.ZodPipe<z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
    cwd: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    cmd: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
    cwd: z.ZodOptional<z.ZodString>;
    directory: z.ZodOptional<z.ZodString>;
}, z.core.$loose>]>, z.ZodTransform<{
    command: string | undefined;
    cwd: string | undefined;
}, {
    [x: string]: unknown;
    command: string | string[];
    cwd?: string | undefined;
    directory?: string | undefined;
} | {
    [x: string]: unknown;
    cmd: string | string[];
    cwd?: string | undefined;
    directory?: string | undefined;
}>>;
export declare const ToolShellOutputSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodString, z.ZodTransform<{
    command: undefined;
    output: string | undefined;
    exitCode: undefined;
}, string>>, z.ZodPipe<z.ZodObject<{
    command: z.ZodOptional<z.ZodString>;
    output: z.ZodOptional<z.ZodString>;
    text: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    aggregated_output: z.ZodOptional<z.ZodString>;
    aggregatedOutput: z.ZodOptional<z.ZodString>;
    exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    exit_code: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    metadata: z.ZodOptional<z.ZodObject<{
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        exit_code: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$loose>>;
    structuredContent: z.ZodOptional<z.ZodObject<{
        output: z.ZodOptional<z.ZodString>;
        text: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    structured_content: z.ZodOptional<z.ZodObject<{
        output: z.ZodOptional<z.ZodString>;
        text: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    result: z.ZodOptional<z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
        output: z.ZodOptional<z.ZodString>;
        text: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>, z.ZodTransform<{
    command: string | undefined;
    output: string | undefined;
    exitCode: number | null | undefined;
}, {
    [x: string]: unknown;
    command?: string | undefined;
    output?: string | undefined;
    text?: string | undefined;
    content?: string | undefined;
    aggregated_output?: string | undefined;
    aggregatedOutput?: string | undefined;
    exitCode?: number | null | undefined;
    exit_code?: number | null | undefined;
    metadata?: {
        [x: string]: unknown;
        exitCode?: number | null | undefined;
        exit_code?: number | null | undefined;
    } | undefined;
    structuredContent?: {
        [x: string]: unknown;
        output?: string | undefined;
        text?: string | undefined;
        content?: string | undefined;
    } | undefined;
    structured_content?: {
        [x: string]: unknown;
        output?: string | undefined;
        text?: string | undefined;
        content?: string | undefined;
    } | undefined;
    result?: {
        [x: string]: unknown;
        command?: string | undefined;
        output?: string | undefined;
        text?: string | undefined;
        content?: string | undefined;
    } | undefined;
}>>]>;
export declare const ToolPathInputSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
    path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    path: string;
}>>, z.ZodPipe<z.ZodObject<{
    file_path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    file_path: string;
}>>, z.ZodPipe<z.ZodObject<{
    filePath: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    filePath: string;
}>>]>;
export declare const ToolReadInputSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
    path: z.ZodString;
    offset: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
    offset: number | undefined;
    limit: number | undefined;
}, {
    [x: string]: unknown;
    path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}>>, z.ZodPipe<z.ZodObject<{
    file_path: z.ZodString;
    offset: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
    offset: number | undefined;
    limit: number | undefined;
}, {
    [x: string]: unknown;
    file_path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}>>, z.ZodPipe<z.ZodObject<{
    filePath: z.ZodString;
    offset: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
    offset: number | undefined;
    limit: number | undefined;
}, {
    [x: string]: unknown;
    filePath: string;
    offset?: number | undefined;
    limit?: number | undefined;
}>>]>;
interface ToolReadOutputValue {
    filePath?: string;
    content?: string;
}
export declare const ToolReadOutputSchema: z.ZodType<ToolReadOutputValue, unknown>;
export declare const ToolReadOutputWithPathSchema: z.ZodType<ToolReadOutputValue, unknown>;
export declare const ToolWriteContentSchema: z.ZodObject<{
    content: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const ToolWriteInputSchema: z.ZodPipe<z.ZodIntersection<z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
    path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    path: string;
}>>, z.ZodPipe<z.ZodObject<{
    file_path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    file_path: string;
}>>, z.ZodPipe<z.ZodObject<{
    filePath: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    filePath: string;
}>>]>, z.ZodObject<{
    content: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>, z.ZodTransform<{
    filePath: string;
    content: string | undefined;
}, ({
    filePath: string;
} | {
    filePath: string;
} | {
    filePath: string;
}) & {
    [x: string]: unknown;
    content?: string | undefined;
    new_content?: string | undefined;
    newContent?: string | undefined;
}>>;
export declare const ToolWriteOutputSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodString, z.ZodTransform<{
    filePath: undefined;
    content: undefined;
}, string>>, z.ZodPipe<z.ZodIntersection<z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
    path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    path: string;
}>>, z.ZodPipe<z.ZodObject<{
    file_path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    file_path: string;
}>>, z.ZodPipe<z.ZodObject<{
    filePath: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    filePath: string;
}>>]>, z.ZodObject<{
    content: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>, z.ZodTransform<{
    filePath: string;
    content: string | undefined;
}, ({
    filePath: string;
} | {
    filePath: string;
} | {
    filePath: string;
}) & {
    [x: string]: unknown;
    content?: string | undefined;
    new_content?: string | undefined;
    newContent?: string | undefined;
}>>, z.ZodPipe<z.ZodObject<{
    content: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodTransform<{
    filePath: undefined;
    content: string | undefined;
}, {
    [x: string]: unknown;
    content?: string | undefined;
    new_content?: string | undefined;
    newContent?: string | undefined;
}>>]>;
export declare const ToolEditTextSchema: z.ZodObject<{
    old_string: z.ZodOptional<z.ZodString>;
    old_str: z.ZodOptional<z.ZodString>;
    oldContent: z.ZodOptional<z.ZodString>;
    old_content: z.ZodOptional<z.ZodString>;
    new_string: z.ZodOptional<z.ZodString>;
    new_str: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    patch: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodString>;
    unified_diff: z.ZodOptional<z.ZodString>;
    unifiedDiff: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const ToolEditInputSchema: z.ZodPipe<z.ZodIntersection<z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
    path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    path: string;
}>>, z.ZodPipe<z.ZodObject<{
    file_path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    file_path: string;
}>>, z.ZodPipe<z.ZodObject<{
    filePath: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    filePath: string;
}>>]>, z.ZodObject<{
    old_string: z.ZodOptional<z.ZodString>;
    old_str: z.ZodOptional<z.ZodString>;
    oldContent: z.ZodOptional<z.ZodString>;
    old_content: z.ZodOptional<z.ZodString>;
    new_string: z.ZodOptional<z.ZodString>;
    new_str: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    patch: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodString>;
    unified_diff: z.ZodOptional<z.ZodString>;
    unifiedDiff: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>, z.ZodTransform<{
    filePath: string;
    oldString: string | undefined;
    newString: string | undefined;
    unifiedDiff: string | undefined;
}, ({
    filePath: string;
} | {
    filePath: string;
} | {
    filePath: string;
}) & {
    [x: string]: unknown;
    old_string?: string | undefined;
    old_str?: string | undefined;
    oldContent?: string | undefined;
    old_content?: string | undefined;
    new_string?: string | undefined;
    new_str?: string | undefined;
    newContent?: string | undefined;
    new_content?: string | undefined;
    content?: string | undefined;
    patch?: string | undefined;
    diff?: string | undefined;
    unified_diff?: string | undefined;
    unifiedDiff?: string | undefined;
}>>;
export declare const ToolEditOutputSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodIntersection<z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
    path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    path: string;
}>>, z.ZodPipe<z.ZodObject<{
    file_path: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    file_path: string;
}>>, z.ZodPipe<z.ZodObject<{
    filePath: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
}, {
    [x: string]: unknown;
    filePath: string;
}>>]>, z.ZodObject<{
    old_string: z.ZodOptional<z.ZodString>;
    old_str: z.ZodOptional<z.ZodString>;
    oldContent: z.ZodOptional<z.ZodString>;
    old_content: z.ZodOptional<z.ZodString>;
    new_string: z.ZodOptional<z.ZodString>;
    new_str: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    patch: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodString>;
    unified_diff: z.ZodOptional<z.ZodString>;
    unifiedDiff: z.ZodOptional<z.ZodString>;
}, z.core.$loose>>, z.ZodTransform<{
    filePath: string;
    newString: string | undefined;
    unifiedDiff: string | undefined;
}, ({
    filePath: string;
} | {
    filePath: string;
} | {
    filePath: string;
}) & {
    [x: string]: unknown;
    old_string?: string | undefined;
    old_str?: string | undefined;
    oldContent?: string | undefined;
    old_content?: string | undefined;
    new_string?: string | undefined;
    new_str?: string | undefined;
    newContent?: string | undefined;
    new_content?: string | undefined;
    content?: string | undefined;
    patch?: string | undefined;
    diff?: string | undefined;
    unified_diff?: string | undefined;
    unifiedDiff?: string | undefined;
}>>, z.ZodPipe<z.ZodObject<{
    files: z.ZodArray<z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
        path: z.ZodString;
        patch: z.ZodOptional<z.ZodString>;
        diff: z.ZodOptional<z.ZodString>;
        unified_diff: z.ZodOptional<z.ZodString>;
        unifiedDiff: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodTransform<{
        filePath: string;
        unifiedDiff: string | undefined;
    }, {
        [x: string]: unknown;
        path: string;
        patch?: string | undefined;
        diff?: string | undefined;
        unified_diff?: string | undefined;
        unifiedDiff?: string | undefined;
    }>>, z.ZodPipe<z.ZodObject<{
        file_path: z.ZodString;
        patch: z.ZodOptional<z.ZodString>;
        diff: z.ZodOptional<z.ZodString>;
        unified_diff: z.ZodOptional<z.ZodString>;
        unifiedDiff: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodTransform<{
        filePath: string;
        unifiedDiff: string | undefined;
    }, {
        [x: string]: unknown;
        file_path: string;
        patch?: string | undefined;
        diff?: string | undefined;
        unified_diff?: string | undefined;
        unifiedDiff?: string | undefined;
    }>>, z.ZodPipe<z.ZodObject<{
        filePath: z.ZodString;
        patch: z.ZodOptional<z.ZodString>;
        diff: z.ZodOptional<z.ZodString>;
        unified_diff: z.ZodOptional<z.ZodString>;
        unifiedDiff: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodTransform<{
        filePath: string;
        unifiedDiff: string | undefined;
    }, {
        [x: string]: unknown;
        filePath: string;
        patch?: string | undefined;
        diff?: string | undefined;
        unified_diff?: string | undefined;
        unifiedDiff?: string | undefined;
    }>>]>>;
}, z.core.$loose>, z.ZodTransform<{
    filePath: string;
    unifiedDiff: string | undefined;
    newString: undefined;
}, {
    [x: string]: unknown;
    files: ({
        filePath: string;
        unifiedDiff: string | undefined;
    } | {
        filePath: string;
        unifiedDiff: string | undefined;
    } | {
        filePath: string;
        unifiedDiff: string | undefined;
    })[];
}>>, z.ZodPipe<z.ZodObject<{
    old_string: z.ZodOptional<z.ZodString>;
    old_str: z.ZodOptional<z.ZodString>;
    oldContent: z.ZodOptional<z.ZodString>;
    old_content: z.ZodOptional<z.ZodString>;
    new_string: z.ZodOptional<z.ZodString>;
    new_str: z.ZodOptional<z.ZodString>;
    newContent: z.ZodOptional<z.ZodString>;
    new_content: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    patch: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodString>;
    unified_diff: z.ZodOptional<z.ZodString>;
    unifiedDiff: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodTransform<{
    filePath: undefined;
    newString: string | undefined;
    unifiedDiff: string | undefined;
}, {
    [x: string]: unknown;
    old_string?: string | undefined;
    old_str?: string | undefined;
    oldContent?: string | undefined;
    old_content?: string | undefined;
    new_string?: string | undefined;
    new_str?: string | undefined;
    newContent?: string | undefined;
    new_content?: string | undefined;
    content?: string | undefined;
    patch?: string | undefined;
    diff?: string | undefined;
    unified_diff?: string | undefined;
    unifiedDiff?: string | undefined;
}>>]>;
export declare const ToolSearchInputSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodObject<{
    query: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    query: string;
}, {
    [x: string]: unknown;
    query: string;
}>>, z.ZodPipe<z.ZodObject<{
    q: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    query: string;
}, {
    [x: string]: unknown;
    q: string;
}>>, z.ZodPipe<z.ZodObject<{
    pattern: z.ZodString;
}, z.core.$loose>, z.ZodTransform<{
    query: string;
}, {
    [x: string]: unknown;
    pattern: string;
}>>]>;
export declare const ToolGlobOutputSchema: z.ZodObject<{
    durationMs: z.ZodNumber;
    numFiles: z.ZodNumber;
    filenames: z.ZodArray<z.ZodString>;
    truncated: z.ZodBoolean;
}, z.core.$loose>;
export declare const ToolGrepOutputSchema: z.ZodObject<{
    mode: z.ZodOptional<z.ZodEnum<{
        content: "content";
        files_with_matches: "files_with_matches";
        count: "count";
    }>>;
    numFiles: z.ZodNumber;
    filenames: z.ZodArray<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    numLines: z.ZodOptional<z.ZodNumber>;
    numMatches: z.ZodOptional<z.ZodNumber>;
    appliedLimit: z.ZodOptional<z.ZodNumber>;
    appliedOffset: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const ToolWebFetchInputSchema: z.ZodObject<{
    url: z.ZodString;
    prompt: z.ZodString;
}, z.core.$loose>;
export declare const ToolWebFetchOutputSchema: z.ZodObject<{
    bytes: z.ZodNumber;
    code: z.ZodNumber;
    codeText: z.ZodString;
    result: z.ZodString;
    durationMs: z.ZodNumber;
    url: z.ZodString;
}, z.core.$loose>;
export declare const ToolWebSearchOutputSchema: z.ZodObject<{
    query: z.ZodString;
    results: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        tool_use_id: z.ZodString;
        content: z.ZodArray<z.ZodObject<{
            title: z.ZodString;
            url: z.ZodString;
        }, z.core.$loose>>;
    }, z.core.$loose>, z.ZodString]>>;
    durationSeconds: z.ZodNumber;
}, z.core.$loose>;
export type ParsedToolShellInput = z.infer<typeof ToolShellInputSchema>;
export type ParsedToolShellOutput = z.infer<typeof ToolShellOutputSchema>;
export type ParsedToolReadInput = z.infer<typeof ToolReadInputSchema>;
export type ParsedToolReadOutput = ToolReadOutputValue;
export type ParsedToolReadOutputWithPath = ToolReadOutputValue;
export type ParsedToolWriteInput = z.infer<typeof ToolWriteInputSchema>;
export type ParsedToolWriteOutput = z.infer<typeof ToolWriteOutputSchema>;
export type ParsedToolEditInput = z.infer<typeof ToolEditInputSchema>;
export type ParsedToolEditOutput = z.infer<typeof ToolEditOutputSchema>;
export type ParsedToolSearchInput = z.infer<typeof ToolSearchInputSchema>;
export type ParsedToolGlobOutput = z.infer<typeof ToolGlobOutputSchema>;
export type ParsedToolGrepOutput = z.infer<typeof ToolGrepOutputSchema>;
export type ParsedToolWebFetchInput = z.infer<typeof ToolWebFetchInputSchema>;
export type ParsedToolWebFetchOutput = z.infer<typeof ToolWebFetchOutputSchema>;
export type ParsedToolWebSearchOutput = z.infer<typeof ToolWebSearchOutputSchema>;
type NormalizePathFn = (filePath: string) => string | undefined;
export declare function toShellToolDetail(input: ParsedToolShellInput | null, output: ParsedToolShellOutput | null): ToolCallDetail | undefined;
export declare function toReadToolDetail(input: ParsedToolReadInput | null, output: ParsedToolReadOutput | null, options?: {
    normalizePath?: NormalizePathFn;
}): ToolCallDetail | undefined;
export declare function toWriteToolDetail(input: ParsedToolWriteInput | null, output: ParsedToolWriteOutput | null, options?: {
    normalizePath?: NormalizePathFn;
}): ToolCallDetail | undefined;
export declare function toEditToolDetail(input: ParsedToolEditInput | null, output: ParsedToolEditOutput | null, options?: {
    normalizePath?: NormalizePathFn;
}): ToolCallDetail | undefined;
export declare function toSearchToolDetail(params: {
    input: ParsedToolSearchInput | null;
    output?: ParsedToolGrepOutput | ParsedToolGlobOutput | ParsedToolWebSearchOutput | null;
    toolName?: "search" | "grep" | "glob" | "web_search";
}): ToolCallDetail | undefined;
export declare function toFetchToolDetail(input: ParsedToolWebFetchInput | null, output: ParsedToolWebFetchOutput | null): ToolCallDetail | undefined;
export declare function toolDetailBranchByName<Name extends string, InputSchema extends ToolDetailSchema, OutputSchema extends ToolDetailSchema>(name: Name, inputSchema: InputSchema, outputSchema: OutputSchema, mapper: (input: z.infer<InputSchema> | null, output: z.infer<OutputSchema> | null) => ToolCallDetail | undefined): z.ZodPipe<z.ZodObject<{
    name: z.ZodLiteral<Name>;
    input: z.ZodNullable<InputSchema>;
    output: z.ZodNullable<OutputSchema>;
}, z.core.$strip>, z.ZodTransform<{
    type: "shell";
    command: string;
    cwd?: string;
    output?: string;
    exitCode?: number | null;
} | {
    type: "read";
    filePath: string;
    content?: string;
    offset?: number;
    limit?: number;
} | {
    type: "edit";
    filePath: string;
    oldString?: string;
    newString?: string;
    unifiedDiff?: string;
} | {
    type: "write";
    filePath: string;
    content?: string;
} | {
    type: "search";
    query: string;
    toolName?: "search" | "grep" | "glob" | "web_search";
    content?: string;
    filePaths?: string[];
    webResults?: Array<{
        title: string;
        url: string;
    }>;
    annotations?: string[];
    numFiles?: number;
    numMatches?: number;
    durationMs?: number;
    durationSeconds?: number;
    truncated?: boolean;
    mode?: "content" | "files_with_matches" | "count";
} | {
    type: "fetch";
    url: string;
    prompt?: string;
    result?: string;
    code?: number;
    codeText?: string;
    bytes?: number;
    durationMs?: number;
} | {
    type: "worktree_setup";
    worktreePath: string;
    branchName: string;
    log: string;
    commands: Array<{
        index: number;
        command: string;
        cwd: string;
        log: string;
        status: "running" | "completed" | "failed";
        exitCode: number | null;
        durationMs?: number;
    }>;
    truncated?: boolean;
} | {
    type: "sub_agent";
    subAgentType?: string;
    description?: string;
    childSessionId?: string;
    log: string;
    actions?: Array<{
        index: number;
        toolName: string;
        summary?: string;
    }>;
} | {
    type: "plain_text";
    label?: string;
    text?: string;
    icon?: import("../agent-sdk-types.js").ToolCallIconName;
} | {
    type: "plan";
    text: string;
} | {
    type: "unknown";
    input: unknown;
    output: unknown;
} | undefined, {
    name: Name;
} & {} extends infer T ? { [K in keyof T]: T[K]; } : never>>;
export declare function toolDetailBranchByToolName<Name extends string, InputSchema extends ToolDetailSchema, OutputSchema extends ToolDetailSchema>(toolName: Name, inputSchema: InputSchema, outputSchema: OutputSchema, mapper: (input: z.infer<InputSchema> | null, output: z.infer<OutputSchema> | null) => ToolCallDetail | undefined): z.ZodPipe<z.ZodObject<{
    toolName: z.ZodLiteral<Name>;
    input: z.ZodNullable<InputSchema>;
    output: z.ZodNullable<OutputSchema>;
}, z.core.$strip>, z.ZodTransform<{
    type: "shell";
    command: string;
    cwd?: string;
    output?: string;
    exitCode?: number | null;
} | {
    type: "read";
    filePath: string;
    content?: string;
    offset?: number;
    limit?: number;
} | {
    type: "edit";
    filePath: string;
    oldString?: string;
    newString?: string;
    unifiedDiff?: string;
} | {
    type: "write";
    filePath: string;
    content?: string;
} | {
    type: "search";
    query: string;
    toolName?: "search" | "grep" | "glob" | "web_search";
    content?: string;
    filePaths?: string[];
    webResults?: Array<{
        title: string;
        url: string;
    }>;
    annotations?: string[];
    numFiles?: number;
    numMatches?: number;
    durationMs?: number;
    durationSeconds?: number;
    truncated?: boolean;
    mode?: "content" | "files_with_matches" | "count";
} | {
    type: "fetch";
    url: string;
    prompt?: string;
    result?: string;
    code?: number;
    codeText?: string;
    bytes?: number;
    durationMs?: number;
} | {
    type: "worktree_setup";
    worktreePath: string;
    branchName: string;
    log: string;
    commands: Array<{
        index: number;
        command: string;
        cwd: string;
        log: string;
        status: "running" | "completed" | "failed";
        exitCode: number | null;
        durationMs?: number;
    }>;
    truncated?: boolean;
} | {
    type: "sub_agent";
    subAgentType?: string;
    description?: string;
    childSessionId?: string;
    log: string;
    actions?: Array<{
        index: number;
        toolName: string;
        summary?: string;
    }>;
} | {
    type: "plain_text";
    label?: string;
    text?: string;
    icon?: import("../agent-sdk-types.js").ToolCallIconName;
} | {
    type: "plan";
    text: string;
} | {
    type: "unknown";
    input: unknown;
    output: unknown;
} | undefined, {
    toolName: Name;
} & {} extends infer T ? { [K in keyof T]: T[K]; } : never>>;
export declare function toolDetailBranchByNameWithCwd<Name extends string, InputSchema extends ToolDetailSchema, OutputSchema extends ToolDetailSchema>(name: Name, inputSchema: InputSchema, outputSchema: OutputSchema, mapper: (input: z.infer<InputSchema> | null, output: z.infer<OutputSchema> | null, cwd: string | null) => ToolCallDetail | undefined): z.ZodPipe<z.ZodObject<{
    cwd: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    name: z.ZodLiteral<Name>;
    input: z.ZodNullable<InputSchema>;
    output: z.ZodNullable<OutputSchema>;
}, z.core.$strip>, z.ZodTransform<{
    type: "shell";
    command: string;
    cwd?: string;
    output?: string;
    exitCode?: number | null;
} | {
    type: "read";
    filePath: string;
    content?: string;
    offset?: number;
    limit?: number;
} | {
    type: "edit";
    filePath: string;
    oldString?: string;
    newString?: string;
    unifiedDiff?: string;
} | {
    type: "write";
    filePath: string;
    content?: string;
} | {
    type: "search";
    query: string;
    toolName?: "search" | "grep" | "glob" | "web_search";
    content?: string;
    filePaths?: string[];
    webResults?: Array<{
        title: string;
        url: string;
    }>;
    annotations?: string[];
    numFiles?: number;
    numMatches?: number;
    durationMs?: number;
    durationSeconds?: number;
    truncated?: boolean;
    mode?: "content" | "files_with_matches" | "count";
} | {
    type: "fetch";
    url: string;
    prompt?: string;
    result?: string;
    code?: number;
    codeText?: string;
    bytes?: number;
    durationMs?: number;
} | {
    type: "worktree_setup";
    worktreePath: string;
    branchName: string;
    log: string;
    commands: Array<{
        index: number;
        command: string;
        cwd: string;
        log: string;
        status: "running" | "completed" | "failed";
        exitCode: number | null;
        durationMs?: number;
    }>;
    truncated?: boolean;
} | {
    type: "sub_agent";
    subAgentType?: string;
    description?: string;
    childSessionId?: string;
    log: string;
    actions?: Array<{
        index: number;
        toolName: string;
        summary?: string;
    }>;
} | {
    type: "plain_text";
    label?: string;
    text?: string;
    icon?: import("../agent-sdk-types.js").ToolCallIconName;
} | {
    type: "plan";
    text: string;
} | {
    type: "unknown";
    input: unknown;
    output: unknown;
} | undefined, {
    name: Name;
} & {
    cwd?: string | null | undefined;
} extends infer T ? { [K in keyof T]: T[K]; } : never>>;
export {};
//# sourceMappingURL=tool-call-detail-primitives.d.ts.map