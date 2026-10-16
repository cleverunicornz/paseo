import { z } from "zod";
export declare const OmpThinkingLevelSchema: z.ZodEnum<{
    auto: "auto";
    off: "off";
    high: "high";
    max: "max";
    low: "low";
    medium: "medium";
    xhigh: "xhigh";
    minimal: "minimal";
}>;
export declare const OmpImageContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"image">;
    data: z.ZodString;
    mimeType: z.ZodString;
}, z.core.$loose>;
export declare const OmpTextContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, z.core.$loose>;
export declare const OmpThinkingContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"thinking">;
    thinking: z.ZodString;
}, z.core.$loose>;
export declare const OmpToolCallContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"toolCall">;
    id: z.ZodString;
    name: z.ZodString;
    arguments: z.ZodUnknown;
}, z.core.$loose>;
export declare const OmpAssistantContentSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"thinking">;
    thinking: z.ZodString;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"toolCall">;
    id: z.ZodString;
    name: z.ZodString;
    arguments: z.ZodUnknown;
}, z.core.$loose>], "type">;
export declare const OmpAgentMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodString;
        mimeType: z.ZodString;
    }, z.core.$loose>]>>]>;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"developer">;
    content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodString;
        mimeType: z.ZodString;
    }, z.core.$loose>]>>]>;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"custom">;
    content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodString;
        mimeType: z.ZodString;
    }, z.core.$loose>]>>]>;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"assistant">;
    content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"thinking">;
        thinking: z.ZodString;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"toolCall">;
        id: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodUnknown;
    }, z.core.$loose>], "type">>;
    provider: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    responseId: z.ZodOptional<z.ZodString>;
    responseModel: z.ZodOptional<z.ZodString>;
    errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stopReason: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"toolResult">;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    content: z.ZodUnknown;
    isError: z.ZodOptional<z.ZodBoolean>;
    details: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"bashExecution">;
    command: z.ZodString;
    output: z.ZodOptional<z.ZodString>;
    exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    cancelled: z.ZodOptional<z.ZodBoolean>;
    timestamp: z.ZodNumber;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"pythonExecution">;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"hookMessage">;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"branchSummary">;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"compactionSummary">;
}, z.core.$loose>, z.ZodObject<{
    role: z.ZodLiteral<"fileMention">;
}, z.core.$loose>], "role">;
export declare const OmpModelThinkingSchema: z.ZodObject<{
    mode: z.ZodOptional<z.ZodString>;
    efforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    defaultLevel: z.ZodOptional<z.ZodString>;
    effortMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$loose>;
export declare const OmpModelSchema: z.ZodObject<{
    provider: z.ZodString;
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    reasoning: z.ZodOptional<z.ZodBoolean>;
    thinking: z.ZodOptional<z.ZodObject<{
        mode: z.ZodOptional<z.ZodString>;
        efforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        defaultLevel: z.ZodOptional<z.ZodString>;
        effortMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$loose>>;
    contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    api: z.ZodOptional<z.ZodString>;
    baseUrl: z.ZodOptional<z.ZodString>;
    input: z.ZodOptional<z.ZodArray<z.ZodString>>;
    cost: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    compat: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>;
export declare const OmpSessionStateSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        provider: z.ZodString;
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        reasoning: z.ZodOptional<z.ZodBoolean>;
        thinking: z.ZodOptional<z.ZodObject<{
            mode: z.ZodOptional<z.ZodString>;
            efforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
            defaultLevel: z.ZodOptional<z.ZodString>;
            effortMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$loose>>;
        contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        api: z.ZodOptional<z.ZodString>;
        baseUrl: z.ZodOptional<z.ZodString>;
        input: z.ZodOptional<z.ZodArray<z.ZodString>>;
        cost: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        compat: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>>>;
    thinkingLevel: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        off: "off";
        high: "high";
        max: "max";
        low: "low";
        medium: "medium";
        xhigh: "xhigh";
        minimal: "minimal";
    }>>;
    isStreaming: z.ZodBoolean;
    isCompacting: z.ZodBoolean;
    autoCompactionEnabled: z.ZodOptional<z.ZodBoolean>;
    fastModeEnabled: z.ZodOptional<z.ZodBoolean>;
    fastModeActive: z.ZodOptional<z.ZodBoolean>;
    sessionFile: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodString;
    sessionName: z.ZodOptional<z.ZodString>;
    messageCount: z.ZodNumber;
    queuedMessageCount: z.ZodNumber;
    contextUsage: z.ZodOptional<z.ZodObject<{
        tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        percent: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$loose>>;
    todoPhases: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>;
export declare const OmpSessionStatsSchema: z.ZodObject<{
    tokens: z.ZodOptional<z.ZodObject<{
        input: z.ZodOptional<z.ZodNumber>;
        output: z.ZodOptional<z.ZodNumber>;
        cacheRead: z.ZodOptional<z.ZodNumber>;
        cacheWrite: z.ZodOptional<z.ZodNumber>;
        total: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>;
    cost: z.ZodOptional<z.ZodNumber>;
    contextUsage: z.ZodOptional<z.ZodObject<{
        tokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        percent: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const OmpRpcSlashCommandSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodString>;
    sourceInfo: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    input: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        hint: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const OmpAgentToolResultSchema: z.ZodObject<{
    content: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        text: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    details: z.ZodOptional<z.ZodUnknown>;
    isError: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const OmpRpcHostToolDefinitionSchema: z.ZodObject<{
    name: z.ZodString;
    label: z.ZodOptional<z.ZodString>;
    description: z.ZodString;
    loadMode: z.ZodOptional<z.ZodEnum<{
        essential: "essential";
        discoverable: "discoverable";
    }>>;
    parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    hidden: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const OmpRpcHostToolCallRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"host_tool_call">;
    id: z.ZodString;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$loose>;
export declare const OmpRpcHostToolCancelRequestSchema: z.ZodObject<{
    type: z.ZodLiteral<"host_tool_cancel">;
    id: z.ZodString;
    targetId: z.ZodString;
}, z.core.$loose>;
export declare const OmpRpcHostToolUpdateSchema: z.ZodObject<{
    type: z.ZodLiteral<"host_tool_update">;
    id: z.ZodString;
    partialResult: z.ZodObject<{
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodString;
            text: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
        details: z.ZodOptional<z.ZodUnknown>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>;
}, z.core.$loose>;
export declare const OmpRpcHostToolResultSchema: z.ZodObject<{
    type: z.ZodLiteral<"host_tool_result">;
    id: z.ZodString;
    result: z.ZodObject<{
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodString;
            text: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
        details: z.ZodOptional<z.ZodUnknown>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>;
    isError: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const OmpSubagentSubscriptionLevelSchema: z.ZodEnum<{
    off: "off";
    events: "events";
    progress: "progress";
}>;
export declare const OmpSubagentStatusSchema: z.ZodEnum<{
    running: "running";
    completed: "completed";
    failed: "failed";
    pending: "pending";
    aborted: "aborted";
}>;
export declare const OmpSubagentLifecyclePayloadSchema: z.ZodObject<{
    id: z.ZodString;
    agent: z.ZodString;
    agentSource: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        started: "started";
        aborted: "aborted";
    }>;
    sessionFile: z.ZodOptional<z.ZodString>;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    index: z.ZodNumber;
    detached: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const OmpSubagentProgressSchema: z.ZodObject<{
    id: z.ZodString;
    status: z.ZodEnum<{
        running: "running";
        completed: "completed";
        failed: "failed";
        pending: "pending";
        aborted: "aborted";
    }>;
    description: z.ZodOptional<z.ZodString>;
    currentTool: z.ZodOptional<z.ZodUnknown>;
    recentTools: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    recentOutput: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    resolvedModel: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const OmpSubagentProgressPayloadSchema: z.ZodObject<{
    index: z.ZodNumber;
    agent: z.ZodString;
    agentSource: z.ZodOptional<z.ZodString>;
    task: z.ZodString;
    parentToolCallId: z.ZodOptional<z.ZodString>;
    assignment: z.ZodOptional<z.ZodString>;
    progress: z.ZodObject<{
        id: z.ZodString;
        status: z.ZodEnum<{
            running: "running";
            completed: "completed";
            failed: "failed";
            pending: "pending";
            aborted: "aborted";
        }>;
        description: z.ZodOptional<z.ZodString>;
        currentTool: z.ZodOptional<z.ZodUnknown>;
        recentTools: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
        recentOutput: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
        resolvedModel: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
    sessionFile: z.ZodOptional<z.ZodString>;
    detached: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const OmpAssistantMessageEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text_delta">;
    delta: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"thinking_delta">;
    delta: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"start">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"text_start">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"text_end">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"thinking_start">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"thinking_end">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"done">;
}, z.core.$loose>], "type">;
export declare const OmpAgentSessionEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"agent_start">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"turn_start">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"message_start">;
    message: z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"message_end">;
    message: z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"message_update">;
    message: z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">;
    assistantMessageEvent: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text_delta">;
        delta: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"thinking_delta">;
        delta: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"text_start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"text_end">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"thinking_start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"thinking_end">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"done">;
    }, z.core.$loose>], "type">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"tool_execution_start">;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    args: z.ZodUnknown;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"tool_execution_update">;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    args: z.ZodOptional<z.ZodUnknown>;
    partialResult: z.ZodUnknown;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"tool_execution_end">;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    result: z.ZodUnknown;
    isError: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"compaction_start">;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"compaction_end">;
    reason: z.ZodOptional<z.ZodString>;
    errorMessage: z.ZodOptional<z.ZodString>;
    aborted: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"agent_end">;
    messages: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">>>;
}, z.core.$loose>], "type">;
export declare const OmpTodoItemSchema: z.ZodObject<{
    content: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
        abandoned: "abandoned";
    }>;
    blocker: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const OmpTodoPhaseSchema: z.ZodObject<{
    name: z.ZodString;
    tasks: z.ZodArray<z.ZodObject<{
        content: z.ZodString;
        status: z.ZodEnum<{
            completed: "completed";
            pending: "pending";
            in_progress: "in_progress";
            blocked: "blocked";
            abandoned: "abandoned";
        }>;
        blocker: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const OmpTodoReminderEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"todo_reminder">;
    todos: z.ZodArray<z.ZodObject<{
        content: z.ZodString;
        status: z.ZodEnum<{
            completed: "completed";
            pending: "pending";
            in_progress: "in_progress";
            blocked: "blocked";
            abandoned: "abandoned";
        }>;
        blocker: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const OmpNoticeEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"notice">;
    level: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
    }>;
    message: z.ZodString;
    source: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const OmpGoalSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    objective: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodString>;
    tokenBudget: z.ZodOptional<z.ZodNumber>;
    tokensUsed: z.ZodOptional<z.ZodNumber>;
    timeUsedSeconds: z.ZodOptional<z.ZodNumber>;
    createdAt: z.ZodOptional<z.ZodString>;
    updatedAt: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const OmpGoalModeStateSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    mode: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    goal: z.ZodOptional<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        objective: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        tokenBudget: z.ZodOptional<z.ZodNumber>;
        tokensUsed: z.ZodOptional<z.ZodNumber>;
        timeUsedSeconds: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const OmpGoalUpdatedEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"goal_updated">;
    goal: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        objective: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        tokenBudget: z.ZodOptional<z.ZodNumber>;
        tokensUsed: z.ZodOptional<z.ZodNumber>;
        timeUsedSeconds: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    state: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        mode: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
        goal: z.ZodOptional<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            objective: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodString>;
            tokenBudget: z.ZodOptional<z.ZodNumber>;
            tokensUsed: z.ZodOptional<z.ZodNumber>;
            timeUsedSeconds: z.ZodOptional<z.ZodNumber>;
            createdAt: z.ZodOptional<z.ZodString>;
            updatedAt: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const OmpAutoRetryStartEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"auto_retry_start">;
    attempt: z.ZodNumber;
    maxAttempts: z.ZodNumber;
    delayMs: z.ZodNumber;
    errorMessage: z.ZodString;
    errorId: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const OmpAutoRetryEndEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"auto_retry_end">;
    success: z.ZodBoolean;
    attempt: z.ZodNumber;
    finalError: z.ZodOptional<z.ZodString>;
    recoveredErrors: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>;
export declare const OmpRetryFallbackAppliedEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"retry_fallback_applied">;
    from: z.ZodString;
    to: z.ZodString;
    role: z.ZodString;
}, z.core.$loose>;
export declare const OmpRetryFallbackSucceededEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"retry_fallback_succeeded">;
    model: z.ZodString;
    role: z.ZodString;
}, z.core.$loose>;
export declare const OmpAutoCompactionStartEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"auto_compaction_start">;
    reason: z.ZodString;
    action: z.ZodString;
}, z.core.$loose>;
export declare const OmpAutoCompactionEndEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"auto_compaction_end">;
    action: z.ZodOptional<z.ZodString>;
    result: z.ZodOptional<z.ZodUnknown>;
    aborted: z.ZodBoolean;
    willRetry: z.ZodBoolean;
    errorMessage: z.ZodOptional<z.ZodString>;
    skipped: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const OmpAvailableCommandSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodString>;
    input: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        hint: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const OmpAvailableCommandsUpdateEventSchema: z.ZodObject<{
    type: z.ZodLiteral<"available_commands_update">;
    commands: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodString>;
        input: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            hint: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const OmpSubagentEventPayloadSchema: z.ZodObject<{
    id: z.ZodString;
    event: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"agent_start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"turn_start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"message_start">;
        message: z.ZodDiscriminatedUnion<[z.ZodObject<{
            role: z.ZodLiteral<"user">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"developer">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"custom">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"assistant">;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"thinking">;
                thinking: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"toolCall">;
                id: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodUnknown;
            }, z.core.$loose>], "type">>;
            provider: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            responseId: z.ZodOptional<z.ZodString>;
            responseModel: z.ZodOptional<z.ZodString>;
            errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            stopReason: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"toolResult">;
            toolCallId: z.ZodString;
            toolName: z.ZodString;
            content: z.ZodUnknown;
            isError: z.ZodOptional<z.ZodBoolean>;
            details: z.ZodOptional<z.ZodUnknown>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"bashExecution">;
            command: z.ZodString;
            output: z.ZodOptional<z.ZodString>;
            exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            cancelled: z.ZodOptional<z.ZodBoolean>;
            timestamp: z.ZodNumber;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"pythonExecution">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"hookMessage">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"branchSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"compactionSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"fileMention">;
        }, z.core.$loose>], "role">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"message_end">;
        message: z.ZodDiscriminatedUnion<[z.ZodObject<{
            role: z.ZodLiteral<"user">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"developer">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"custom">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"assistant">;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"thinking">;
                thinking: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"toolCall">;
                id: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodUnknown;
            }, z.core.$loose>], "type">>;
            provider: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            responseId: z.ZodOptional<z.ZodString>;
            responseModel: z.ZodOptional<z.ZodString>;
            errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            stopReason: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"toolResult">;
            toolCallId: z.ZodString;
            toolName: z.ZodString;
            content: z.ZodUnknown;
            isError: z.ZodOptional<z.ZodBoolean>;
            details: z.ZodOptional<z.ZodUnknown>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"bashExecution">;
            command: z.ZodString;
            output: z.ZodOptional<z.ZodString>;
            exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            cancelled: z.ZodOptional<z.ZodBoolean>;
            timestamp: z.ZodNumber;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"pythonExecution">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"hookMessage">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"branchSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"compactionSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"fileMention">;
        }, z.core.$loose>], "role">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"message_update">;
        message: z.ZodDiscriminatedUnion<[z.ZodObject<{
            role: z.ZodLiteral<"user">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"developer">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"custom">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"assistant">;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"thinking">;
                thinking: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"toolCall">;
                id: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodUnknown;
            }, z.core.$loose>], "type">>;
            provider: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            responseId: z.ZodOptional<z.ZodString>;
            responseModel: z.ZodOptional<z.ZodString>;
            errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            stopReason: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"toolResult">;
            toolCallId: z.ZodString;
            toolName: z.ZodString;
            content: z.ZodUnknown;
            isError: z.ZodOptional<z.ZodBoolean>;
            details: z.ZodOptional<z.ZodUnknown>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"bashExecution">;
            command: z.ZodString;
            output: z.ZodOptional<z.ZodString>;
            exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            cancelled: z.ZodOptional<z.ZodBoolean>;
            timestamp: z.ZodNumber;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"pythonExecution">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"hookMessage">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"branchSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"compactionSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"fileMention">;
        }, z.core.$loose>], "role">;
        assistantMessageEvent: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text_delta">;
            delta: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking_delta">;
            delta: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"start">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"text_start">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"text_end">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking_start">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking_end">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"done">;
        }, z.core.$loose>], "type">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"tool_execution_start">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        args: z.ZodUnknown;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"tool_execution_update">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        args: z.ZodOptional<z.ZodUnknown>;
        partialResult: z.ZodUnknown;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"tool_execution_end">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        result: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"compaction_start">;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"compaction_end">;
        reason: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodString>;
        aborted: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"agent_end">;
        messages: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            role: z.ZodLiteral<"user">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"developer">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"custom">;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                data: z.ZodString;
                mimeType: z.ZodString;
            }, z.core.$loose>]>>]>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"assistant">;
            content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                text: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"thinking">;
                thinking: z.ZodString;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"toolCall">;
                id: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodUnknown;
            }, z.core.$loose>], "type">>;
            provider: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            responseId: z.ZodOptional<z.ZodString>;
            responseModel: z.ZodOptional<z.ZodString>;
            errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            stopReason: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"toolResult">;
            toolCallId: z.ZodString;
            toolName: z.ZodString;
            content: z.ZodUnknown;
            isError: z.ZodOptional<z.ZodBoolean>;
            details: z.ZodOptional<z.ZodUnknown>;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"bashExecution">;
            command: z.ZodString;
            output: z.ZodOptional<z.ZodString>;
            exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            cancelled: z.ZodOptional<z.ZodBoolean>;
            timestamp: z.ZodNumber;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"pythonExecution">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"hookMessage">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"branchSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"compactionSummary">;
        }, z.core.$loose>, z.ZodObject<{
            role: z.ZodLiteral<"fileMention">;
        }, z.core.$loose>], "role">>>;
    }, z.core.$loose>], "type">;
}, z.core.$loose>;
export declare const OmpRuntimeEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"agent_start">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"turn_start">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"message_start">;
    message: z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"message_end">;
    message: z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"message_update">;
    message: z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">;
    assistantMessageEvent: z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text_delta">;
        delta: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"thinking_delta">;
        delta: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"text_start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"text_end">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"thinking_start">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"thinking_end">;
    }, z.core.$loose>, z.ZodObject<{
        type: z.ZodLiteral<"done">;
    }, z.core.$loose>], "type">;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"tool_execution_start">;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    args: z.ZodUnknown;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"tool_execution_update">;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    args: z.ZodOptional<z.ZodUnknown>;
    partialResult: z.ZodUnknown;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"tool_execution_end">;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    result: z.ZodUnknown;
    isError: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"compaction_start">;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"compaction_end">;
    reason: z.ZodOptional<z.ZodString>;
    errorMessage: z.ZodOptional<z.ZodString>;
    aborted: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"agent_end">;
    messages: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">>>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"extension_ui_request">;
    id: z.ZodString;
    method: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodArray<z.ZodString>>;
    optionDetails: z.ZodOptional<z.ZodUnknown>;
    placeholder: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    launchUrl: z.ZodOptional<z.ZodString>;
    instructions: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"command_output">;
    text: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"prompt_result">;
    id: z.ZodOptional<z.ZodString>;
    agentInvoked: z.ZodOptional<z.ZodBoolean>;
    status: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodObject<{
        message: z.ZodString;
    }, z.core.$loose>>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"process_exit">;
    error: z.ZodString;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"subagent_lifecycle">;
    payload: z.ZodObject<{
        id: z.ZodString;
        agent: z.ZodString;
        agentSource: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            started: "started";
            aborted: "aborted";
        }>;
        sessionFile: z.ZodOptional<z.ZodString>;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        index: z.ZodNumber;
        detached: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"subagent_progress">;
    payload: z.ZodObject<{
        index: z.ZodNumber;
        agent: z.ZodString;
        agentSource: z.ZodOptional<z.ZodString>;
        task: z.ZodString;
        parentToolCallId: z.ZodOptional<z.ZodString>;
        assignment: z.ZodOptional<z.ZodString>;
        progress: z.ZodObject<{
            id: z.ZodString;
            status: z.ZodEnum<{
                running: "running";
                completed: "completed";
                failed: "failed";
                pending: "pending";
                aborted: "aborted";
            }>;
            description: z.ZodOptional<z.ZodString>;
            currentTool: z.ZodOptional<z.ZodUnknown>;
            recentTools: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
            recentOutput: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
            resolvedModel: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>;
        sessionFile: z.ZodOptional<z.ZodString>;
        detached: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"subagent_event">;
    payload: z.ZodObject<{
        id: z.ZodString;
        event: z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"agent_start">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"turn_start">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"message_start">;
            message: z.ZodDiscriminatedUnion<[z.ZodObject<{
                role: z.ZodLiteral<"user">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"developer">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"custom">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"assistant">;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"thinking">;
                    thinking: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"toolCall">;
                    id: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodUnknown;
                }, z.core.$loose>], "type">>;
                provider: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                responseId: z.ZodOptional<z.ZodString>;
                responseModel: z.ZodOptional<z.ZodString>;
                errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                stopReason: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"toolResult">;
                toolCallId: z.ZodString;
                toolName: z.ZodString;
                content: z.ZodUnknown;
                isError: z.ZodOptional<z.ZodBoolean>;
                details: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"bashExecution">;
                command: z.ZodString;
                output: z.ZodOptional<z.ZodString>;
                exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                cancelled: z.ZodOptional<z.ZodBoolean>;
                timestamp: z.ZodNumber;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"pythonExecution">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"hookMessage">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"branchSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"compactionSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"fileMention">;
            }, z.core.$loose>], "role">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"message_end">;
            message: z.ZodDiscriminatedUnion<[z.ZodObject<{
                role: z.ZodLiteral<"user">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"developer">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"custom">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"assistant">;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"thinking">;
                    thinking: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"toolCall">;
                    id: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodUnknown;
                }, z.core.$loose>], "type">>;
                provider: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                responseId: z.ZodOptional<z.ZodString>;
                responseModel: z.ZodOptional<z.ZodString>;
                errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                stopReason: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"toolResult">;
                toolCallId: z.ZodString;
                toolName: z.ZodString;
                content: z.ZodUnknown;
                isError: z.ZodOptional<z.ZodBoolean>;
                details: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"bashExecution">;
                command: z.ZodString;
                output: z.ZodOptional<z.ZodString>;
                exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                cancelled: z.ZodOptional<z.ZodBoolean>;
                timestamp: z.ZodNumber;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"pythonExecution">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"hookMessage">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"branchSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"compactionSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"fileMention">;
            }, z.core.$loose>], "role">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"message_update">;
            message: z.ZodDiscriminatedUnion<[z.ZodObject<{
                role: z.ZodLiteral<"user">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"developer">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"custom">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"assistant">;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"thinking">;
                    thinking: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"toolCall">;
                    id: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodUnknown;
                }, z.core.$loose>], "type">>;
                provider: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                responseId: z.ZodOptional<z.ZodString>;
                responseModel: z.ZodOptional<z.ZodString>;
                errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                stopReason: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"toolResult">;
                toolCallId: z.ZodString;
                toolName: z.ZodString;
                content: z.ZodUnknown;
                isError: z.ZodOptional<z.ZodBoolean>;
                details: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"bashExecution">;
                command: z.ZodString;
                output: z.ZodOptional<z.ZodString>;
                exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                cancelled: z.ZodOptional<z.ZodBoolean>;
                timestamp: z.ZodNumber;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"pythonExecution">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"hookMessage">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"branchSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"compactionSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"fileMention">;
            }, z.core.$loose>], "role">;
            assistantMessageEvent: z.ZodDiscriminatedUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text_delta">;
                delta: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"thinking_delta">;
                delta: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"start">;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"text_start">;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"text_end">;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"thinking_start">;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"thinking_end">;
            }, z.core.$loose>, z.ZodObject<{
                type: z.ZodLiteral<"done">;
            }, z.core.$loose>], "type">;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"tool_execution_start">;
            toolCallId: z.ZodString;
            toolName: z.ZodString;
            args: z.ZodUnknown;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"tool_execution_update">;
            toolCallId: z.ZodString;
            toolName: z.ZodString;
            args: z.ZodOptional<z.ZodUnknown>;
            partialResult: z.ZodUnknown;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"tool_execution_end">;
            toolCallId: z.ZodString;
            toolName: z.ZodString;
            result: z.ZodUnknown;
            isError: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"compaction_start">;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"compaction_end">;
            reason: z.ZodOptional<z.ZodString>;
            errorMessage: z.ZodOptional<z.ZodString>;
            aborted: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"agent_end">;
            messages: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                role: z.ZodLiteral<"user">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"developer">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"custom">;
                content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"image">;
                    data: z.ZodString;
                    mimeType: z.ZodString;
                }, z.core.$loose>]>>]>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"assistant">;
                content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
                    type: z.ZodLiteral<"text">;
                    text: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"thinking">;
                    thinking: z.ZodString;
                }, z.core.$loose>, z.ZodObject<{
                    type: z.ZodLiteral<"toolCall">;
                    id: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodUnknown;
                }, z.core.$loose>], "type">>;
                provider: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                responseId: z.ZodOptional<z.ZodString>;
                responseModel: z.ZodOptional<z.ZodString>;
                errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                stopReason: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"toolResult">;
                toolCallId: z.ZodString;
                toolName: z.ZodString;
                content: z.ZodUnknown;
                isError: z.ZodOptional<z.ZodBoolean>;
                details: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"bashExecution">;
                command: z.ZodString;
                output: z.ZodOptional<z.ZodString>;
                exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                cancelled: z.ZodOptional<z.ZodBoolean>;
                timestamp: z.ZodNumber;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"pythonExecution">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"hookMessage">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"branchSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"compactionSummary">;
            }, z.core.$loose>, z.ZodObject<{
                role: z.ZodLiteral<"fileMention">;
            }, z.core.$loose>], "role">>>;
        }, z.core.$loose>], "type">;
    }, z.core.$loose>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"todo_reminder">;
    todos: z.ZodArray<z.ZodObject<{
        content: z.ZodString;
        status: z.ZodEnum<{
            completed: "completed";
            pending: "pending";
            in_progress: "in_progress";
            blocked: "blocked";
            abandoned: "abandoned";
        }>;
        blocker: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"notice">;
    level: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
    }>;
    message: z.ZodString;
    source: z.ZodOptional<z.ZodString>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"goal_updated">;
    goal: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        objective: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        tokenBudget: z.ZodOptional<z.ZodNumber>;
        tokensUsed: z.ZodOptional<z.ZodNumber>;
        timeUsedSeconds: z.ZodOptional<z.ZodNumber>;
        createdAt: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>>;
    state: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        mode: z.ZodOptional<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
        goal: z.ZodOptional<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            objective: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodString>;
            tokenBudget: z.ZodOptional<z.ZodNumber>;
            tokensUsed: z.ZodOptional<z.ZodNumber>;
            timeUsedSeconds: z.ZodOptional<z.ZodNumber>;
            createdAt: z.ZodOptional<z.ZodString>;
            updatedAt: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$loose>>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"auto_retry_start">;
    attempt: z.ZodNumber;
    maxAttempts: z.ZodNumber;
    delayMs: z.ZodNumber;
    errorMessage: z.ZodString;
    errorId: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"auto_retry_end">;
    success: z.ZodBoolean;
    attempt: z.ZodNumber;
    finalError: z.ZodOptional<z.ZodString>;
    recoveredErrors: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"retry_fallback_applied">;
    from: z.ZodString;
    to: z.ZodString;
    role: z.ZodString;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"retry_fallback_succeeded">;
    model: z.ZodString;
    role: z.ZodString;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"auto_compaction_start">;
    reason: z.ZodString;
    action: z.ZodString;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"auto_compaction_end">;
    action: z.ZodOptional<z.ZodString>;
    result: z.ZodOptional<z.ZodUnknown>;
    aborted: z.ZodBoolean;
    willRetry: z.ZodBoolean;
    errorMessage: z.ZodOptional<z.ZodString>;
    skipped: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"available_commands_update">;
    commands: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodString>;
        input: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            hint: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>>;
    }, z.core.$loose>>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"host_tool_call">;
    id: z.ZodString;
    toolCallId: z.ZodString;
    toolName: z.ZodString;
    arguments: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"host_tool_cancel">;
    id: z.ZodString;
    targetId: z.ZodString;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"host_tool_update">;
    id: z.ZodString;
    partialResult: z.ZodObject<{
        content: z.ZodArray<z.ZodObject<{
            type: z.ZodString;
            text: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
        details: z.ZodOptional<z.ZodUnknown>;
        isError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>;
}, z.core.$loose>, z.ZodObject<{
    type: z.ZodLiteral<"model_changed">;
}, z.core.$loose>], "type">;
export declare const OmpRpcCommandSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"prompt">;
    message: z.ZodString;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodString;
        mimeType: z.ZodString;
    }, z.core.$loose>>>;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"compact">;
    customInstructions: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"set_auto_compaction">;
    enabled: z.ZodBoolean;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"abort">;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"get_state">;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"steer">;
    message: z.ZodString;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"image">;
        data: z.ZodString;
        mimeType: z.ZodString;
    }, z.core.$loose>>>;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"set_fast_mode">;
    enabled: z.ZodBoolean;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"get_messages">;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"get_available_models">;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"set_model">;
    provider: z.ZodString;
    modelId: z.ZodString;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"set_thinking_level">;
    level: z.ZodEnum<{
        auto: "auto";
        off: "off";
        high: "high";
        max: "max";
        low: "low";
        medium: "medium";
        xhigh: "xhigh";
        minimal: "minimal";
    }>;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"get_session_stats">;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"get_available_commands">;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"set_subagent_subscription">;
    level: z.ZodEnum<{
        off: "off";
        events: "events";
        progress: "progress";
    }>;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"set_host_tools">;
    tools: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        label: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
        loadMode: z.ZodOptional<z.ZodEnum<{
            essential: "essential";
            discoverable: "discoverable";
        }>>;
        parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        hidden: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>>;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"branch">;
    entryId: z.ZodString;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"get_branch_messages">;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"handoff">;
    customInstructions: z.ZodOptional<z.ZodString>;
    id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "type">;
export declare const OmpPromptAckSchema: z.ZodOptional<z.ZodObject<{
    agentInvoked: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>>;
export declare const OmpMessagesResultSchema: z.ZodObject<{
    messages: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"developer">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"custom">;
        content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            data: z.ZodString;
            mimeType: z.ZodString;
        }, z.core.$loose>]>>]>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
        }, z.core.$loose>, z.ZodObject<{
            type: z.ZodLiteral<"toolCall">;
            id: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodUnknown;
        }, z.core.$loose>], "type">>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        responseId: z.ZodOptional<z.ZodString>;
        responseModel: z.ZodOptional<z.ZodString>;
        errorMessage: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stopReason: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"toolResult">;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        content: z.ZodUnknown;
        isError: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"bashExecution">;
        command: z.ZodString;
        output: z.ZodOptional<z.ZodString>;
        exitCode: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        cancelled: z.ZodOptional<z.ZodBoolean>;
        timestamp: z.ZodNumber;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"pythonExecution">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"hookMessage">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"branchSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"compactionSummary">;
    }, z.core.$loose>, z.ZodObject<{
        role: z.ZodLiteral<"fileMention">;
    }, z.core.$loose>], "role">>>;
}, z.core.$loose>;
export declare const OmpModelsResultSchema: z.ZodObject<{
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        reasoning: z.ZodOptional<z.ZodBoolean>;
        thinking: z.ZodOptional<z.ZodObject<{
            mode: z.ZodOptional<z.ZodString>;
            efforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
            defaultLevel: z.ZodOptional<z.ZodString>;
            effortMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$loose>>;
        contextWindow: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        maxTokens: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        api: z.ZodOptional<z.ZodString>;
        baseUrl: z.ZodOptional<z.ZodString>;
        input: z.ZodOptional<z.ZodArray<z.ZodString>>;
        cost: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        compat: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const OmpCommandsResultSchema: z.ZodObject<{
    commands: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodString>;
        sourceInfo: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        input: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            hint: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const OmpHostToolsResultSchema: z.ZodObject<{
    toolNames: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$loose>;
export declare const OmpBranchResultSchema: z.ZodObject<{
    text: z.ZodOptional<z.ZodString>;
    cancelled: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export declare const OmpBranchMessagesResultSchema: z.ZodObject<{
    messages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        entryId: z.ZodString;
        text: z.ZodString;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export type OmpThinkingLevel = z.infer<typeof OmpThinkingLevelSchema>;
export type OmpImageContent = z.infer<typeof OmpImageContentSchema>;
export type OmpTextContent = z.infer<typeof OmpTextContentSchema>;
export type OmpThinkingContent = z.infer<typeof OmpThinkingContentSchema>;
export type OmpToolCallContent = z.infer<typeof OmpToolCallContentSchema>;
export type OmpAssistantContent = z.infer<typeof OmpAssistantContentSchema>;
export type OmpAgentMessage = z.infer<typeof OmpAgentMessageSchema>;
export type OmpModel = z.infer<typeof OmpModelSchema>;
export type OmpModelThinking = z.infer<typeof OmpModelThinkingSchema>;
export type OmpSessionState = z.infer<typeof OmpSessionStateSchema>;
export type OmpSessionStats = z.infer<typeof OmpSessionStatsSchema>;
export type OmpRpcSlashCommand = z.infer<typeof OmpRpcSlashCommandSchema>;
export type OmpAgentToolResult = z.infer<typeof OmpAgentToolResultSchema>;
export type OmpRpcHostToolDefinition = z.infer<typeof OmpRpcHostToolDefinitionSchema>;
export type OmpRpcHostToolCallRequest = z.infer<typeof OmpRpcHostToolCallRequestSchema>;
export type OmpRpcHostToolUpdate = z.infer<typeof OmpRpcHostToolUpdateSchema>;
export type OmpRpcHostToolResult = z.infer<typeof OmpRpcHostToolResultSchema>;
export type OmpSubagentSubscriptionLevel = z.infer<typeof OmpSubagentSubscriptionLevelSchema>;
export type OmpSubagentStatus = z.infer<typeof OmpSubagentStatusSchema>;
export type OmpSubagentLifecyclePayload = z.infer<typeof OmpSubagentLifecyclePayloadSchema>;
export type OmpSubagentProgressPayload = z.infer<typeof OmpSubagentProgressPayloadSchema>;
export type OmpSubagentEventPayload = z.infer<typeof OmpSubagentEventPayloadSchema>;
export type OmpAssistantMessageEvent = z.infer<typeof OmpAssistantMessageEventSchema>;
export type OmpAgentSessionEvent = z.infer<typeof OmpAgentSessionEventSchema>;
export type OmpRuntimeEvent = z.infer<typeof OmpRuntimeEventSchema>;
export declare function parseOmpRuntimeEvent(message: unknown): OmpRuntimeEvent | null;
export type OmpTodoItem = z.infer<typeof OmpTodoItemSchema>;
export type OmpTodoPhase = z.infer<typeof OmpTodoPhaseSchema>;
export type OmpTodoReminderEvent = z.infer<typeof OmpTodoReminderEventSchema>;
export type OmpNoticeEvent = z.infer<typeof OmpNoticeEventSchema>;
export type OmpGoal = z.infer<typeof OmpGoalSchema>;
export type OmpGoalUpdatedEvent = z.infer<typeof OmpGoalUpdatedEventSchema>;
export type OmpAutoRetryStartEvent = z.infer<typeof OmpAutoRetryStartEventSchema>;
export type OmpAutoRetryEndEvent = z.infer<typeof OmpAutoRetryEndEventSchema>;
export type OmpRetryFallbackAppliedEvent = z.infer<typeof OmpRetryFallbackAppliedEventSchema>;
export type OmpRetryFallbackSucceededEvent = z.infer<typeof OmpRetryFallbackSucceededEventSchema>;
export type OmpAutoCompactionStartEvent = z.infer<typeof OmpAutoCompactionStartEventSchema>;
export type OmpAutoCompactionEndEvent = z.infer<typeof OmpAutoCompactionEndEventSchema>;
export type OmpAvailableCommand = z.infer<typeof OmpAvailableCommandSchema>;
export type OmpAvailableCommandsUpdateEvent = z.infer<typeof OmpAvailableCommandsUpdateEventSchema>;
export type OmpRpcCommand = z.infer<typeof OmpRpcCommandSchema>;
export type OmpPromptAck = z.infer<typeof OmpPromptAckSchema> & {
    requestId?: string;
};
export interface OmpSubagentSnapshot {
    id: string;
    index: number;
    agent: string;
    description?: string;
    status: OmpSubagentStatus;
    task?: string;
    assignment?: string;
    sessionFile?: string;
    parentToolCallId?: string;
    lastUpdate?: number;
}
export interface OmpSubagentMessagesResult {
    sessionFile: string;
    fromByte: number;
    nextByte: number;
    reset: boolean;
    messages: OmpAgentMessage[];
}
export interface OmpSubagentMessagesSelector {
    subagentId?: string;
    sessionFile?: string;
    fromByte?: number;
}
//# sourceMappingURL=rpc-types.d.ts.map