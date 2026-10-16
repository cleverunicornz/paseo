import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import type { OmpSessionState } from "./rpc-types.js";
import type { OmpToolResult } from "./tool-call-detail.js";
import { type OmpTodoPhase } from "./rpc-types.js";
export declare function mapOmpTodoToolResult(result: OmpToolResult): AgentTimelineItem | null;
export declare function mapOmpTodoReminderEvent(event: unknown): AgentTimelineItem | null;
export declare function mapOmpTodoState(state: OmpSessionState): AgentTimelineItem[];
export declare function mapOmpTodoPhases(phases: readonly OmpTodoPhase[]): AgentTimelineItem | null;
//# sourceMappingURL=todo-mapper.d.ts.map