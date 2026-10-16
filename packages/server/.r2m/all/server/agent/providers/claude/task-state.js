function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function string(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function taskStatus(value) {
    if (value === "completed" || value === "deleted" || value === "in_progress")
        return value;
    return "pending";
}
function retainedTaskStatus(task) {
    if (task.status)
        return task.status;
    return task.completed ? "completed" : "pending";
}
function toTaskItem(value) {
    const task = record(value);
    if (!task)
        return null;
    const text = string(task.subject) ?? string(task.content) ?? string(task.text);
    if (!text)
        return null;
    const status = taskStatus(task.status);
    if (status === "deleted")
        return null;
    const id = string(task.id) ?? string(task.taskId);
    const activeForm = string(task.activeForm) ?? string(task.active_form);
    return {
        ...(id ? { id } : {}),
        text,
        status,
        completed: status === "completed",
        ...(activeForm ? { activeForm } : {}),
    };
}
function toolUses(message) {
    const content = record(message.message)?.content;
    return Array.isArray(content)
        ? content.flatMap((block) => {
            const candidate = record(block);
            return candidate?.type === "tool_use" ? [candidate] : [];
        })
        : [];
}
function toolResultId(message) {
    const content = record(message.message)?.content;
    if (!Array.isArray(content))
        return undefined;
    for (const block of content) {
        const candidate = record(block);
        if (candidate?.type === "tool_result")
            return string(candidate.tool_use_id);
    }
    return undefined;
}
function structuredResult(message) {
    return record(message.toolUseResult) ?? record(message.tool_use_result);
}
/** Accumulates Claude's snapshot and ID-based task tools into canonical todo snapshots. */
export class ClaudeTaskState {
    constructor() {
        this.tasks = new Map();
        this.calls = new Map();
        this.appliedResults = new Set();
    }
    observe(value) {
        const message = record(value);
        if (!message)
            return null;
        let snapshot = null;
        for (const block of toolUses(message)) {
            const id = string(block.id);
            const name = string(block.name);
            if (!id || !isTaskToolName(name))
                continue;
            const input = record(block.input) ?? {};
            this.calls.set(id, { name, input });
            if (name === "TodoWrite")
                snapshot = this.replaceLegacyTodos(input.todos);
        }
        const resultId = toolResultId(message);
        if (!resultId || this.appliedResults.has(resultId))
            return snapshot;
        const call = this.calls.get(resultId);
        if (!call)
            return snapshot;
        this.appliedResults.add(resultId);
        this.calls.delete(resultId);
        return this.applyResult(call, structuredResult(message)) ?? snapshot;
    }
    reset() {
        this.tasks.clear();
        this.calls.clear();
        this.appliedResults.clear();
    }
    replaceLegacyTodos(value) {
        this.tasks.clear();
        if (Array.isArray(value)) {
            for (const [index, taskValue] of value.entries()) {
                const item = toTaskItem(taskValue);
                if (!item)
                    continue;
                const id = item.id ?? `legacy:${index}`;
                this.tasks.set(id, { ...item, id });
            }
        }
        return this.snapshot();
    }
    applyResult(call, result) {
        if (result?.success === false)
            return null;
        if (call.name === "TaskCreate")
            return this.applyCreate(call.input, result);
        if (call.name === "TaskUpdate")
            return this.applyUpdate(call.input, result);
        if (call.name === "TaskList")
            return this.applyList(result);
        return null;
    }
    applyCreate(input, result) {
        const resultTask = record(result?.task);
        const id = string(resultTask?.id) ?? string(result?.taskId);
        const text = string(resultTask?.subject) ?? string(input.subject);
        if (!id || !text)
            return null;
        const activeForm = string(input.activeForm);
        this.tasks.set(id, {
            id,
            text,
            status: "pending",
            completed: false,
            ...(activeForm ? { activeForm } : {}),
        });
        return this.snapshot();
    }
    applyUpdate(input, result) {
        const id = string(input.taskId) ?? string(result?.taskId);
        if (!id)
            return null;
        const current = this.tasks.get(id);
        if (!current)
            return null;
        const statusValue = input.status ?? record(result?.statusChange)?.to;
        const status = statusValue === undefined ? retainedTaskStatus(current) : taskStatus(statusValue);
        if (status === "deleted") {
            this.tasks.delete(id);
            return this.snapshot();
        }
        const text = string(input.subject);
        const activeForm = string(input.activeForm);
        this.tasks.set(id, {
            ...current,
            ...(text ? { text } : {}),
            ...(activeForm ? { activeForm } : {}),
            status,
            completed: status === "completed",
        });
        return this.snapshot();
    }
    applyList(result) {
        const tasks = result?.tasks;
        if (!Array.isArray(tasks))
            return null;
        this.tasks.clear();
        for (const taskValue of tasks) {
            const item = toTaskItem(taskValue);
            if (item?.id)
                this.tasks.set(item.id, item);
        }
        return this.snapshot();
    }
    snapshot() {
        return { type: "todo", items: [...this.tasks.values()] };
    }
}
function isTaskToolName(value) {
    return (value === "TodoWrite" ||
        value === "TaskCreate" ||
        value === "TaskUpdate" ||
        value === "TaskList");
}
//# sourceMappingURL=task-state.js.map