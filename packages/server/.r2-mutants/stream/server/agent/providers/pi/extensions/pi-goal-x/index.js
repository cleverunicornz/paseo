import { z } from "zod";
const Task = z.lazy(() => z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["pending", "complete", "skipped"]),
    subtasks: z.array(Task).optional(),
}));
const Details = z.object({
    version: z.literal(3),
    goal: z
        .object({
        currentTaskId: z.string().optional(),
        taskList: z.object({ tasks: z.array(Task) }).optional(),
    })
        .nullable(),
});
const toolNames = new Set([
    "create_goal",
    "get_goal",
    "update_goal",
    "set_goal_tasks",
    "update_goal_task",
]);
function toItems(tasks, currentTaskId) {
    return tasks.flatMap((task) => {
        let status = "pending";
        if (task.status !== "pending")
            status = "completed";
        else if (task.id === currentTaskId)
            status = "in_progress";
        return [
            {
                id: task.id,
                text: task.title,
                status,
                completed: task.status !== "pending",
            },
            ...toItems(task.subtasks ?? [], currentTaskId),
        ];
    });
}
export const piGoalX = {
    id: "pi-goal-x",
    createSession: () => ({
        mapToolCall(call) {
            if (!toolNames.has(call.toolName) ||
                call.status !== "completed" ||
                !call.result ||
                typeof call.result === "string")
                return undefined;
            const parsed = Details.safeParse(call.result.details);
            if (!parsed.success)
                return undefined;
            const goal = parsed.data.goal;
            if (!goal?.taskList)
                return undefined;
            return {
                timeline: [{ type: "todo", items: toItems(goal.taskList.tasks, goal.currentTaskId) }],
            };
        },
    }),
};
//# sourceMappingURL=index.js.map