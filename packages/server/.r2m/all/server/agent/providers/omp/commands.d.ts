import type { AgentSlashCommand } from "../../agent-sdk-types.js";
import type { OmpRpcSlashCommand } from "./rpc-types.js";
import { type OmpAvailableCommand } from "./rpc-types.js";
export declare const OMP_HANDLED_BUILTIN_SLASH_COMMANDS: readonly AgentSlashCommand[];
export declare function mapOmpSlashCommands(commands: readonly OmpAvailableCommand[]): AgentSlashCommand[];
export declare function mapOmpRuntimeSlashCommands(commands: readonly OmpRpcSlashCommand[]): AgentSlashCommand[];
export declare function mapOmpAvailableCommandsUpdate(event: unknown): AgentSlashCommand[] | null;
//# sourceMappingURL=commands.d.ts.map