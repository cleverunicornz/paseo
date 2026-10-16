import { OmpTodoPhaseSchema, OmpTodoReminderEventSchema, } from "./rpc-types.js";
export function mapOmpTodoToolResult(result) {
    const details = resultDetails(result);
    const phases = OmpTodoPhaseSchema.array().safeParse(details?.phases);
    return phases.success ? mapOmpTodoPhases(phases.data) : null;
}
export function mapOmpTodoReminderEvent(event) {
    const parsed = OmpTodoReminderEventSchema.safeParse(event);
    return parsed.success ? mapOmpTodoItems(parsed.data.todos) : null;
}
export function mapOmpTodoState(state) {
    const phases = OmpTodoPhaseSchema.array().safeParse(state.todoPhases);
    if (!phases.success) {
        return [];
    }
    const item = mapOmpTodoPhases(phases.data);
    return item ? [item] : [];
}
export function mapOmpTodoPhases(phases) {
    const todos = phases.flatMap((phase) => phase.tasks);
    return mapOmpTodoItems(todos);
}
function mapOmpTodoItems(items) {
    if (items.length === 0) {
        return null;
    }
    return {
        type: "todo",
        items: items
            .filter((item) => item.status !== "abandoned")
            .map((item) => ({
            text: item.status === "blocked"
                ? `${item.content} (${item.blocker ? `blocked: ${item.blocker}` : "blocked"})`
                : item.content,
            status: normalizeOmpTodoStatus(item.status),
            completed: item.status === "completed",
        })),
    };
}
function normalizeOmpTodoStatus(status) {
    if (status === "completed")
        return "completed";
    if (status === "in_progress")
        return "in_progress";
    return "pending";
}
function resultDetails(result) {
    if (typeof result === "string" || result === null) {
        return null;
    }
    return isRecord(result.details) ? result.details : null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=todo-mapper.js.map