import { z } from "zod";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";
declare const TaskNotificationEnvelopeSchema: z.ZodObject<{
    messageId: z.ZodNullable<z.ZodString>;
    taskId: z.ZodNullable<z.ZodString>;
    toolUseId: z.ZodNullable<z.ZodString>;
    status: z.ZodNullable<z.ZodString>;
    summary: z.ZodNullable<z.ZodString>;
    outputFile: z.ZodNullable<z.ZodString>;
    rawText: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
declare const MapTaskNotificationUserContentToToolCallInputSchema: z.ZodObject<{
    content: z.ZodUnknown;
    messageId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export type TaskNotificationEnvelope = z.infer<typeof TaskNotificationEnvelopeSchema>;
export type MapTaskNotificationUserContentToToolCallInput = z.infer<typeof MapTaskNotificationUserContentToToolCallInputSchema>;
export interface TaskNotificationSystemMessageLike {
    type: "system";
    subtype: "task_notification";
    uuid?: string;
    task_id?: string;
    status?: "completed" | "failed" | "stopped";
    summary?: string;
    output_file?: string;
    content?: string;
}
type TaskNotificationToolCallItem = Extract<AgentTimelineItem, {
    type: "tool_call";
}>;
export declare function isTaskNotificationUserContent(content: unknown): boolean;
export declare function mapTaskNotificationUserContentToToolCall(input: MapTaskNotificationUserContentToToolCallInput): TaskNotificationToolCallItem | null;
export declare function mapTaskNotificationSystemRecordToToolCall(record: unknown): TaskNotificationToolCallItem | null;
export declare function readTaskNotificationToolUseIdFromHistoryRecord(record: unknown): string | null;
export declare function coerceTaskNotificationHistoryRecordToSystemMessage(record: unknown): TaskNotificationSystemMessageLike | null;
export {};
//# sourceMappingURL=task-notification-tool-call.d.ts.map